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
import { findMatch } from "@/lib/dedupe";
import { allCars, carsForUpc, enqueue, linkUpc, newId, putCar } from "@/lib/db";
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
  errorCode?: string;
  /** Set when a save attempt was rejected, shown next to the save button. */
  saveError?: string;
  /** A car already in the garage that this identification appears to be. */
  matched?: Car;
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
  const [scannerKind, setScannerKind] = useState<"native" | "zxing" | null>(null);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("confirm");
  const [liveBarcode, setLiveBarcode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [picker, setPicker] = useState<{ upc: string; cars: Car[] } | null>(null);
  const [torch, setTorch] = useState<{ available: boolean; on: boolean }>({
    available: false,
    on: false,
  });
  const [typedBarcode, setTypedBarcode] = useState<string | null>(null);
  /**
   * A new barcode that is waiting for its front photo. The barcode is printed
   * on the BACK of the card, so capturing at the moment of detection used to
   * photograph the back — useless for identification and an ugly thumbnail.
   * Instead the barcode is held here and attached to the next shutter press.
   */
  const [armedUpc, setArmedUpc] = useState<string | null>(null);

  const { toast, show } = useToast();

  // A sheet is open, or we are mid-identify: stop reading frames.
  pausedRef.current = Boolean(pending || picker || busy || typedBarcode !== null);

  /** Hold a barcode off the auto-capture path for a while. */
  const cooldown = useCallback((upc: string | undefined, ms: number) => {
    if (!upc) return;
    recentBarcodes.current.set(upc, Date.now() + ms - BARCODE_COOLDOWN_MS);
  }, []);

  /**
   * The width/height the viewfinder actually shows. The preview is
   * object-fit: cover, so this is what the user composed — capturing anything
   * wider would shrink the card in the photo and lose the fine print.
   */
  const viewAspect = useCallback((): number | undefined => {
    const video = videoRef.current;
    if (!video?.clientHeight) return undefined;
    return video.clientWidth / video.clientHeight;
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
            // Ask high; `ideal` degrades gracefully on cameras that cannot.
            // More pixels help both barcode decoding and the fine print the
            // identifier reads.
            width: { ideal: 2560 },
            height: { ideal: 1440 },
            // Unsupported entries in `advanced` are ignored rather than
            // failing the request. Autofocus is what makes a barcode and the
            // fine print on a card readable at arm's length.
            advanced: [
              { focusMode: "continuous" },
            ] as unknown as MediaTrackConstraintSet[],
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

        // The camera is live, so the shutter must work from this moment.
        if (!cancelled) setStatus("ready");

        // Load the barcode decoder in the background. On a browser without a
        // native one this pulls a sizeable chunk over the network; if that is
        // slow or fails, it must degrade to "no barcode reading" rather than
        // leaving the whole screen stuck behind a disabled shutter.
        createScanner()
          .then((scanner) => {
            if (cancelled) return;
            scannerRef.current = scanner;
            setScannerKind(scanner.kind);
          })
          .catch((error: unknown) => {
            if (cancelled) return;
            setScannerError(
              error instanceof Error ? error.message : "Barcode reader failed to load",
            );
          });
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

        // The card may already be in the garage under a barcode that was
        // never linked — most of a collection logged before barcode links
        // existed looks exactly like this. Recognise it rather than growing
        // a duplicate row.
        const matched =
          identification.name ?
            findMatch(await allCars(), identification)
          : undefined;

        if (!identification.isHotWheels && !identification.name) {
          // Previously this showed a brief toast and returned, opening no
          // sheet — from the user's side the shutter simply did nothing and
          // the photo was thrown away. A capture must never vanish: offer the
          // form so the car can be entered by hand instead.
          cooldown(upc, SUPPRESS_MS);
          setPending({
            draft: { ...BLANK_DRAFT, upc },
            thumbnail,
            upc,
            error:
              "Could not read that card. Fill it in by hand below, or discard and try again with the card filling more of the frame.",
          });
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
            upc,
          },
          thumbnail,
          upc,
          confidence: identification.confidence,
          matched,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Identification failed.";
        const code = (error as { code?: string })?.code;
        // Do not let this barcode re-trigger a failing call on the next pass.
        cooldown(upc, SUPPRESS_MS);
        // Still let them log it — a blank form beats losing the car entirely.
        const thumbnail = await makeThumbnail(imageDataUrl).catch(() => undefined);
        setPending({
          draft: { ...BLANK_DRAFT, upc },
          thumbnail,
          upc,
          error: message,
          errorCode: code,
        });
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

      // A barcode we have never seen. Do NOT photograph now — the barcode is
      // on the back of the card, and a photo of the back identifies nothing.
      // Arm it and let the user flip to the front and press the shutter.
      vibrate([20, 40, 20]);
      setArmedUpc(upc);
    },
    [show],
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
    if (!video || !video.videoWidth) {
      // Used to return silently, which is indistinguishable from a dead button.
      show("The camera has not produced a frame yet. Give it a second.", "bad");
      return;
    }
    // An armed barcode (scanned off the back moments ago) wins over whatever
    // is in frame now — the user has flipped the card, so the live frame
    // usually has no barcode at all.
    const upc = armedUpc ?? liveBarcode ?? undefined;
    setArmedUpc(null);
    void handleCapture(captureFrame(video, { aspect: viewAspect() }), upc);
  }, [handleCapture, armedUpc, liveBarcode, viewAspect, show]);

  const onPickFile = useCallback(
    async (file: File) => {
      try {
        const dataUrl = await fileToDataUrl(file);
        const upc = armedUpc ?? undefined;
        setArmedUpc(null);
        await handleCapture(dataUrl, upc);
      } catch (error) {
        show(error instanceof Error ? error.message : "Could not read that photo.", "bad");
      }
    },
    [handleCapture, armedUpc, show],
  );

  /**
   * Look a barcode up without the camera: worn or curved barcodes defeat every
   * reader, and the number underneath the bars is always printed.
   */
  const submitTypedBarcode = useCallback(async () => {
    const upc = normaliseBarcode(typedBarcode ?? "");
    if (!upc) {
      show("Enter the digits printed under the barcode.", "bad");
      return;
    }
    setTypedBarcode(null);

    const known = await carsForUpc(upc);
    if (known.length === 1) {
      const updated = await addAnother(known[0]);
      show(`${updated.name} — now ×${updated.quantity}`, "good");
      return;
    }
    if (known.length > 1) {
      setPicker({ upc, cars: known });
      return;
    }
    // Unknown barcode with no photo to work from: open the form so it can be
    // filled in by hand, and remember the barcode against whatever is saved.
    setPending({ draft: { ...BLANK_DRAFT, upc }, upc });
  }, [typedBarcode, show]);

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
    const { draft, thumbnail, confidence } = pending;
    if (!draft.name.trim()) {
      // Inline, not a toast: this message sits inside the sheet the user is
      // looking at, so it cannot be missed.
      setPending({ ...pending, saveError: "Give it a name before saving." });
      return;
    }
    const upc = draft.upc ?? pending.upc;
    const now = Date.now();

    // Fold into an existing car when this is the same casting — recomputed
    // from the draft, since edits in the form can make or break the match.
    const existing = findMatch(await allCars(), {
      toyNumber: draft.toyNumber,
      name: draft.name.trim(),
      year: draft.year,
      color: draft.color,
    });

    if (existing) {
      const merged: Car = {
        ...existing,
        quantity: existing.quantity + draft.quantity,
        // Backfill gaps from the fresh read without clobbering saved data.
        series: existing.series ?? draft.series,
        seriesNumber: existing.seriesNumber ?? draft.seriesNumber,
        collectorNumber: existing.collectorNumber ?? draft.collectorNumber,
        year: existing.year ?? draft.year,
        toyNumber: existing.toyNumber ?? draft.toyNumber,
        color: existing.color ?? draft.color,
        thumbnail: existing.thumbnail ?? thumbnail,
        upc: existing.upc ?? upc,
      };
      try {
        await putCar(merged);
        // Teach this barcode the car it belongs to, so the NEXT scan of it
        // adds instantly with no photo and no identification cost.
        if (upc) await linkUpc(upc, merged.id);
      } catch (error) {
        setPending({
          ...pending,
          saveError:
            error instanceof Error ?
              `Could not save: ${error.message}`
            : "Could not save to this device's storage.",
        });
        return;
      }
      announceChange();
      setPending(null);
      vibrate(30);
      show(`${merged.name} — already in the garage, now ×${merged.quantity}`, "good");
      return;
    }

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
    try {
      await putCar(car);
      if (upc) await linkUpc(upc, car.id);
    } catch (error) {
      // A failed write used to reject silently, leaving the sheet open with no
      // explanation — indistinguishable from the button not working.
      setPending({
        ...pending,
        saveError:
          error instanceof Error ?
            `Could not save: ${error.message}`
          : "Could not save to this device's storage.",
      });
      return;
    }
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
              : armedUpc ?
                `Got barcode ${armedUpc} — flip to the FRONT and press the shutter`
              : liveBarcode ? `Barcode ${liveBarcode}`
              : status === "starting" ? "Starting camera…"
              : "Scan the barcode on the back, or just press the shutter"}
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
            : <span className="side-action" style={{ visibility: "hidden" }} />}
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button
              type="button"
              className="btn btn-block btn-ghost"
              onClick={() => setTypedBarcode("")}
            >
              Type a barcode
            </button>
            <button
              type="button"
              className="btn btn-block btn-ghost"
              onClick={() => setPending({ draft: { ...BLANK_DRAFT } })}
            >
              Add by hand
            </button>
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
            across a whole assortment. If a barcode will not read, the shutter
            works on its own — the photo alone is enough to identify a car.
          </p>

          <p className="muted tiny" style={{ marginTop: 8 }}>
            Barcode reader:{" "}
            {scannerError ? `unavailable — ${scannerError}`
            : scannerKind === "native" ? "built into this browser"
            : scannerKind === "zxing" ? "ZXing"
            : "loading…"}
            {" · "}
            <Link href="/diagnostics" style={{ textDecoration: "underline" }}>
              Diagnostics
            </Link>
          </p>
        </>
      }

      {typedBarcode !== null && (
        <div className="sheet-backdrop" onClick={() => setTypedBarcode(null)}>
          <div className="sheet" onClick={(event) => event.stopPropagation()}>
            <h2>Type a barcode</h2>
            <p className="muted small" style={{ marginTop: 2, marginBottom: 14 }}>
              The digits printed under the bars. If you already own this car it
              is added straight away.
            </p>
            <label className="field">
              <span>Barcode</span>
              <input
                autoFocus
                inputMode="numeric"
                value={typedBarcode}
                onChange={(event) =>
                  setTypedBarcode(event.target.value.replace(/[^0-9]/g, ""))
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submitTypedBarcode();
                }}
                placeholder="027084123456"
              />
            </label>
            <div className="sheet-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void submitTypedBarcode()}
              >
                Look it up
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setTypedBarcode(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

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
                  if (video) void handleCapture(captureFrame(video, { aspect: viewAspect() }), upc);
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
              <p className="notice notice-bad" role="alert">
                {pending.errorCode === "quota_exhausted" ?
                  <>
                    {pending.error} You can still add cars by hand, and barcodes
                    you have scanned before keep working.{" "}
                    <Link href="/stats" style={{ textDecoration: "underline" }}>
                      Get more identifications
                    </Link>
                    .
                  </>
                : <>Could not identify the photo: {pending.error}</>}
              </p>
            )}

            {pending.matched && (
              <p className="notice notice-good">
                Looks like <b>{pending.matched.name}</b>, already in your garage
                (×{pending.matched.quantity}). Saving adds another instead of
                creating a duplicate entry.
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
              onChange={(draft) =>
                setPending({ ...pending, draft, saveError: undefined })
              }
            />

            {pending.saveError && (
              <p className="notice notice-bad" style={{ margin: "4px 0 0" }} role="alert">
                {pending.saveError}
              </p>
            )}

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
