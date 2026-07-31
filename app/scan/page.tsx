"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import CarFields, {
  BLANK_DRAFT,
  type CarDraft,
} from "@/components/CarFields";
import { FlameMark } from "@/components/icons";
import { Toast, useToast } from "@/components/Toast";
import { carSubtitle } from "@/components/CarRow";
import { createScanner, normaliseBarcode, type Scanner } from "@/lib/barcode";
import { addAnother, announceChange, identify } from "@/lib/commit";
import { carsForUpc, enqueue, linkUpc, newId, putCar } from "@/lib/db";
import { captureFrame, fileToDataUrl, makeThumbnail } from "@/lib/image";
import type { Car } from "@/lib/types";

type Mode = "confirm" | "rapid";
type CameraStatus = "starting" | "ready" | "error";

interface Pending {
  draft: CarDraft;
  thumbnail?: string;
  upc?: string;
  confidence?: number;
  /** Set when identification failed, so the sheet can explain itself. */
  error?: string;
}

const BARCODE_COOLDOWN_MS = 3000;
/** After queueing, give the user time to move the next card into frame. */
const QUEUED_COOLDOWN_MS = 10_000;
/**
 * A barcode we failed to identify, or that the user dismissed, must not retry
 * on the next pass — that would loop the camera against a failing card forever.
 */
const SUPPRESS_MS = 15 * 60 * 1000;
const SCAN_INTERVAL_MS = 220;

export default function ScanPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scannerRef = useRef<Scanner | null>(null);
  const pausedRef = useRef(false);
  const recentBarcodes = useRef<Map<string, number>>(new Map());

  const [status, setStatus] = useState<CameraStatus>("starting");
  const [cameraError, setCameraError] = useState("");
  const [mode, setMode] = useState<Mode>("confirm");
  const [liveBarcode, setLiveBarcode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [picker, setPicker] = useState<{ upc: string; cars: Car[] } | null>(null);
  const [torch, setTorch] = useState<{ available: boolean; on: boolean }>({
    available: false,
    on: false,
  });

  const { toast, show } = useToast();

  // A sheet is open, or we are mid-identify: stop reading frames.
  pausedRef.current = Boolean(pending || picker || busy);

  /** Hold a barcode off the auto-capture path for a while. */
  const cooldown = useCallback((upc: string | undefined, ms: number) => {
    if (!upc) return;
    recentBarcodes.current.set(upc, Date.now() + ms - BARCODE_COOLDOWN_MS);
  }, []);

  /* ------------------------------------------------------------ camera --- */

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setStatus("error");
        setCameraError(
          "This browser cannot open a camera. Note that camera access needs HTTPS — it works on your deployed Vercel URL, but not over plain http.",
        );
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }

        const track = stream.getVideoTracks()[0];
        // `torch` is real on Android Chrome but absent from the DOM typings.
        const capabilities = track.getCapabilities?.() as unknown as
          | { torch?: boolean }
          | undefined;
        if (capabilities?.torch) setTorch({ available: true, on: false });

        scannerRef.current = await createScanner();
        if (!cancelled) setStatus("ready");
      } catch (error) {
        if (cancelled) return;
        setStatus("error");
        setCameraError(
          error instanceof DOMException && error.name === "NotAllowedError" ?
            "Camera access was denied. Allow it in your browser settings, then reload."
          : "Could not open the camera. You can still add a photo from your library.",
        );
      }
    }

    void start();

    return () => {
      cancelled = true;
      scannerRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  /* ----------------------------------------------------------- capture --- */

  const handleCapture = useCallback(
    async (imageDataUrl: string, upc?: string) => {
      if (mode === "rapid") {
        await enqueue({
          id: newId(),
          imageDataUrl,
          upc,
          status: "pending",
          attempts: 0,
          createdAt: Date.now(),
        });
        vibrate(20);
        cooldown(upc, QUEUED_COOLDOWN_MS);
        show("Queued — keep scanning", "good");
        return;
      }

      setBusy(true);
      try {
        const identification = await identify([imageDataUrl], upc);
        const thumbnail = await makeThumbnail(imageDataUrl).catch(() => undefined);

        if (!identification.isHotWheels && !identification.name) {
          cooldown(upc, SUPPRESS_MS);
          show("No car found in that photo. Try again, closer.", "bad");
          return;
        }

        setPending({
          draft: {
            ...BLANK_DRAFT,
            name: identification.name,
            series: identification.series ?? undefined,
            seriesNumber: identification.seriesNumber ?? undefined,
            collectorNumber: identification.collectorNumber ?? undefined,
            year: identification.year ?? undefined,
            toyNumber: identification.toyNumber ?? undefined,
            color: identification.color ?? undefined,
            treasureHunt: identification.treasureHunt,
            notes: identification.notes ?? undefined,
          },
          thumbnail,
          upc,
          confidence: identification.confidence,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Identification failed.";
        // Do not let this barcode re-trigger a failing call on the next pass.
        cooldown(upc, SUPPRESS_MS);
        // Still let them log it — a blank form beats losing the car entirely.
        const thumbnail = await makeThumbnail(imageDataUrl).catch(() => undefined);
        setPending({ draft: { ...BLANK_DRAFT }, thumbnail, upc, error: message });
      } finally {
        setBusy(false);
      }
    },
    [mode, show, cooldown],
  );

  /* ------------------------------------------------------ barcode loop --- */

  const handleBarcode = useCallback(
    async (raw: string) => {
      const upc = normaliseBarcode(raw);
      if (!upc) return;

      const now = Date.now();
      const seenAt = recentBarcodes.current.get(upc);
      if (seenAt && now - seenAt < BARCODE_COOLDOWN_MS) return;
      recentBarcodes.current.set(upc, now);

      const known = await carsForUpc(upc);

      if (known.length === 1) {
        const updated = await addAnother(known[0]);
        vibrate(30);
        show(`${updated.name} — now ×${updated.quantity}`, "good");
        return;
      }

      if (known.length > 1) {
        vibrate(30);
        setPicker({ upc, cars: known });
        return;
      }

      // A barcode we have never seen. Photograph the card and identify it.
      vibrate([20, 40, 20]);
      const video = videoRef.current;
      if (!video) return;
      await handleCapture(captureFrame(video), upc);
    },
    [handleCapture, show],
  );

  useEffect(() => {
    if (status !== "ready") return;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    async function tick() {
      if (cancelled) return;
      const video = videoRef.current;
      const scanner = scannerRef.current;
      if (video && scanner && !pausedRef.current) {
        const found = await scanner.scan(video);
        setLiveBarcode(found ? normaliseBarcode(found) : null);
        if (found && !cancelled) await handleBarcode(found);
      }
      if (!cancelled) timer = setTimeout(tick, SCAN_INTERVAL_MS);
    }

    timer = setTimeout(tick, SCAN_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [status, handleBarcode]);

  const onShutter = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    void handleCapture(captureFrame(video), liveBarcode ?? undefined);
  }, [handleCapture, liveBarcode]);

  const onPickFile = useCallback(
    async (file: File) => {
      try {
        const dataUrl = await fileToDataUrl(file);
        await handleCapture(dataUrl);
      } catch (error) {
        show(error instanceof Error ? error.message : "Could not read that photo.", "bad");
      }
    },
    [handleCapture, show],
  );

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torch.on;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as unknown as MediaTrackConstraintSet],
      });
      setTorch({ available: true, on: next });
    } catch {
      show("This camera will not let the torch be controlled.", "bad");
    }
  }, [torch.on, show]);

  /* -------------------------------------------------------------- save --- */

  const savePending = useCallback(async () => {
    if (!pending) return;
    const { draft, thumbnail, upc, confidence } = pending;
    if (!draft.name.trim()) {
      show("Give it a name first.", "bad");
      return;
    }
    const now = Date.now();
    const car: Car = {
      id: newId(),
      name: draft.name.trim(),
      series: draft.series,
      seriesNumber: draft.seriesNumber,
      collectorNumber: draft.collectorNumber,
      year: draft.year,
      toyNumber: draft.toyNumber,
      color: draft.color,
      treasureHunt: draft.treasureHunt,
      condition: draft.condition,
      quantity: draft.quantity,
      notes: draft.notes,
      thumbnail,
      upc,
      confidence,
      source: upc ? "barcode" : "photo",
      addedAt: now,
      updatedAt: now,
    };
    await putCar(car);
    if (upc) await linkUpc(upc, car.id);
    announceChange();
    setPending(null);
    vibrate(30);
    show(`Added ${car.name}`, "good");
  }, [pending, show]);

  /* -------------------------------------------------------------- view --- */

  return (
    <main className="shell">
      <header className="topbar">
        <div className="wordmark">
          <FlameMark className="flame" />
          Scan
        </div>
        <Link href="/" className="btn btn-ghost">
          Done
        </Link>
      </header>

      {status === "error" ?
        <div className="empty">
          <h2>Camera unavailable</h2>
          <p>{cameraError}</p>
          <label className="btn btn-primary">
            Choose a photo
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onPickFile(file);
                event.target.value = "";
              }}
            />
          </label>
        </div>
      : <>
          <div className="viewfinder">
            <video ref={videoRef} playsInline muted autoPlay />
            <div className="reticle" />
            <div className="scan-hint">
              {busy ? "Reading the card…"
              : liveBarcode ? `Barcode ${liveBarcode}`
              : status === "starting" ? "Starting camera…"
              : "Fill the frame with the card, or press the shutter"}
            </div>
          </div>

          <div className="shutter-row">
            <label className="side-action" title="Pick from library">
              🖼
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void onPickFile(file);
                  event.target.value = "";
                }}
              />
            </label>

            <button
              type="button"
              className="shutter"
              onClick={onShutter}
              disabled={status !== "ready" || busy}
              aria-label="Capture card"
            >
              {busy ? <span className="spinner" /> : "◉"}
            </button>

            {torch.available ?
              <button
                type="button"
                className="side-action"
                onClick={() => void toggleTorch()}
                aria-pressed={torch.on}
                title="Torch"
              >
                {torch.on ? "🔦" : "💡"}
              </button>
            : <button
                type="button"
                className="side-action"
                onClick={() => setPending({ draft: { ...BLANK_DRAFT } })}
                title="Add by hand"
              >
                ✎
              </button>
            }
          </div>

          <div className="card" style={{ marginTop: 4 }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <button
                type="button"
                className={`btn btn-block${mode === "confirm" ? " btn-primary" : " btn-ghost"}`}
                onClick={() => setMode("confirm")}
              >
                Confirm each
              </button>
              <button
                type="button"
                className={`btn btn-block${mode === "rapid" ? " btn-primary" : " btn-ghost"}`}
                onClick={() => setMode("rapid")}
              >
                Rapid fire
              </button>
            </div>
            <p className="muted small" style={{ margin: 0, lineHeight: 1.45 }}>
              {mode === "confirm" ?
                "Each card is identified and shown to you before it is saved."
              : "Photos are stashed and identified in the background so you can shoot a whole case without waiting. Check the garage when you are done."
              }
            </p>
          </div>

          <p className="muted tiny" style={{ marginTop: 14, lineHeight: 1.5 }}>
            A barcode you have scanned before adds instantly. A new one triggers a
            photo, because Hot Wheels mainline cars often share a single barcode
            across a whole assortment.
          </p>
        </>
      }

      {picker && (
        <div className="sheet-backdrop" onClick={() => setPicker(null)}>
          <div className="sheet" onClick={(event) => event.stopPropagation()}>
            <h2>Which one is it?</h2>
            <p className="muted small" style={{ marginTop: 0 }}>
              Barcode {picker.upc} matches more than one car you own.
            </p>
            <div className="cars">
              {picker.cars.map((car) => (
                <button
                  key={car.id}
                  type="button"
                  className="car"
                  style={{ textAlign: "left", width: "100%" }}
                  onClick={async () => {
                    const updated = await addAnother(car);
                    setPicker(null);
                    show(`${updated.name} — now ×${updated.quantity}`, "good");
                  }}
                >
                  {car.thumbnail ?
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="car-thumb" src={car.thumbnail} alt="" />
                  : <div className="car-thumb is-empty">⚙</div>}
                  <div>
                    <div className="car-name">{car.name}</div>
                    <div className="car-meta">{carSubtitle(car)}</div>
                  </div>
                  <div className="qty">×{car.quantity}</div>
                </button>
              ))}
            </div>
            <div className="sheet-actions">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const video = videoRef.current;
                  const upc = picker.upc;
                  setPicker(null);
                  if (video) void handleCapture(captureFrame(video), upc);
                }}
              >
                None — identify it
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setPicker(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {pending && (
        <div className="sheet-backdrop">
          <div className="sheet">
            <h2>
              {pending.draft.name ||
                (pending.error ? "Add it by hand" : "Add by hand")}
            </h2>

            {pending.error && (
              <p
                className="small"
                style={{
                  margin: "8px 0 12px",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #5a2320",
                  background: "#20100f",
                  lineHeight: 1.45,
                }}
                role="alert"
              >
                Could not identify the photo: {pending.error}
              </p>
            )}

            <p className="muted small" style={{ marginTop: 2, marginBottom: 14 }}>
              {pending.confidence !== undefined ?
                <span
                  className={`confidence${pending.confidence < 0.6 ? " is-low" : ""}`}
                >
                  {Math.round(pending.confidence * 100)}% sure
                </span>
              : "Fill in what you know — only the name is required."}
              {pending.upc && (
                <span style={{ marginLeft: 8 }}>Barcode {pending.upc}</span>
              )}
            </p>

            <CarFields
              draft={pending.draft}
              onChange={(draft) => setPending({ ...pending, draft })}
            />

            <div className="sheet-actions">
              <button type="button" className="btn btn-primary" onClick={() => void savePending()}>
                Save to garage
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  cooldown(pending.upc, SUPPRESS_MS);
                  setPending(null);
                }}
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast toast={toast} />
    </main>
  );
}

function vibrate(pattern: number | number[]) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(pattern);
  }
}
