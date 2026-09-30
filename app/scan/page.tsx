"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import CarFields, {
  BLANK_DRAFT,
  type CarDraft,
} from "@/components/CarFields";
import CatalogueHint, { applyRelease } from "@/components/CatalogueHint";
import {
  CarIcon,
  CheckIcon,
  FlameMark,
  GalleryIcon,
  KeyboardIcon,
  PencilIcon,
  TorchIcon,
} from "@/components/icons";
import { Toast, useToast } from "@/components/Toast";
import { carSubtitle } from "@/components/CarRow";
import { createScanner, normaliseBarcode, type Scanner } from "@/lib/barcode";
import {
  identificationFromRelease,
  loadCatalogue,
  looksLikeToyNumber,
  lookupToyNumber,
  releaseSubtitle,
  type Release,
} from "@/lib/catalogue";
import {
  addAnother,
  announceChange,
  commitIdentification,
  identify,
  learnUpc,
} from "@/lib/commit";
import { findMatch } from "@/lib/dedupe";
import { allCars, carsForUpc, enqueue, newId, putCar } from "@/lib/db";
import { captureFrame, fileToDataUrl, makeThumbnail } from "@/lib/image";
import { EMPTY_IDENTIFICATION, type Car, type Identification } from "@/lib/types";
import { sharedCandidates } from "@/lib/upcdb";

type Mode = "confirm" | "rapid";
type CameraStatus = "starting" | "ready" | "error";

/** A car offered without a photo: from the shared barcode database or the catalogue. */
interface Candidate {
  release?: Release;
  toyNumber?: string;
  name: string;
  year?: number;
  /** Collectors who confirmed this barcode was on this car. */
  count?: number;
}

interface CandidateSheet {
  upc?: string;
  title: string;
  intro: string;
  items: Candidate[];
}

interface Pending {
  draft: CarDraft;
  thumbnail?: string;
  upc?: string;
  confidence?: number;
  /** How the catalogue confirmed the identification, if it did. */
  catalogue?: Identification["catalogue"];
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
  const [candidates, setCandidates] = useState<CandidateSheet | null>(null);
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
  const armedRef = useRef<string | null>(null);
  armedRef.current = armedUpc;

  const { toast, show } = useToast();

  // A sheet is open, or we are mid-identify: stop reading frames.
  pausedRef.current = Boolean(
    pending || picker || candidates || busy || typedBarcode !== null,
  );

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
          catalogue: identification.catalogue,
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

  /* --------------------------------------------------------- database --- */

  /**
   * Ask the shared barcode database who else has scanned this barcode, and
   * offer their cars. Runs while the user is flipping the card over; if they
   * press the shutter first, the photo wins and this result is dropped.
   */
  const offerShared = useCallback(async (upc: string) => {
    const found = await sharedCandidates(upc);
    if (!found.length || armedRef.current !== upc) return;
    const catalogue = await loadCatalogue().catch(() => null);
    const items: Candidate[] = found.map((candidate) => {
      const releases = catalogue ? lookupToyNumber(catalogue, candidate.toyNumber) : [];
      const release =
        releases.find((entry) => entry.year === candidate.year) ?? releases[0];
      return { ...candidate, release };
    });
    if (armedRef.current !== upc) return;
    vibrate(30);
    setCandidates({
      upc,
      title: "Seen this barcode before",
      intro:
        "Other collectors confirmed these cars behind this barcode. Tap yours to add it — no photo needed.",
      items,
    });
  }, []);

  /** Save a candidate as-is: complete from the catalogue, no identification cost. */
  const pickCandidate = useCallback(
    async (sheet: CandidateSheet, item: Candidate) => {
      const identification: Identification =
        item.release ?
          identificationFromRelease(item.release)
        : {
            ...EMPTY_IDENTIFICATION,
            name: item.name,
            toyNumber: item.toyNumber ?? null,
            year: item.year ?? null,
            isHotWheels: true,
            confidence: 0.8,
          };
      try {
        const result = await commitIdentification(identification, {
          upc: sheet.upc,
          source: sheet.upc ? "barcode" : "manual",
        });
        setCandidates(null);
        setArmedUpc(null);
        cooldown(sheet.upc, QUEUED_COOLDOWN_MS);
        vibrate(30);
        show(
          result.wasDuplicate ?
            `${result.car.name} — now ×${result.car.quantity}`
          : `Added ${result.car.name}`,
          "good",
        );
      } catch (error) {
        show(error instanceof Error ? `Could not save: ${error.message}` : "Could not save.", "bad");
      }
    },
    [cooldown, show],
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
        const taken = await addAnother(known[0]);
        vibrate(taken.fromWishlist ? [40, 60, 40] : 30);
        show(
          taken.fromWishlist ?
            `${taken.car.name} — off the wishlist, it's yours!`
          : `${taken.car.name} — now ×${taken.car.quantity}`,
          "good",
        );
        return;
      }

      if (known.length > 1) {
        vibrate(30);
        setPicker({ upc, cars: known });
        return;
      }

      // A barcode we have never seen. Do NOT photograph now — the barcode is
      // on the back of the card, and a photo of the back identifies nothing.
      // Arm it and let the user flip to the front and press the shutter —
      // unless the shared database knows it, in which case no photo is needed.
      vibrate([20, 40, 20]);
      setArmedUpc(upc);
      armedRef.current = upc;
      void offerShared(upc);
    },
    [show, offerShared],
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
   * Look a code up without the camera. A toy number (the "HTB29" printed next
   * to the barcode) goes straight to the catalogue and comes back complete.
   * A barcode is for worn or curved ones that defeat every reader — the
   * digits under the bars are always printed.
   */
  const submitTypedCode = useCallback(async () => {
    const raw = (typedBarcode ?? "").trim();
    if (!raw) {
      show("Type the toy number, or the digits under the barcode.", "bad");
      return;
    }

    if (/[A-Za-z]/.test(raw) || (looksLikeToyNumber(raw) && raw.replace(/\D/g, "").length < 8)) {
      let releases: Release[] = [];
      try {
        releases = lookupToyNumber(await loadCatalogue(), raw);
      } catch {
        show("The catalogue could not be loaded. Check your connection and try again.", "bad");
        return;
      }
      setTypedBarcode(null);
      if (releases.length === 1) {
        const draft = applyRelease({ ...BLANK_DRAFT }, releases[0]);
        setPending({
          draft,
          confidence: 1,
          catalogue: "toy",
          matched: findMatch(await allCars(), {
            toyNumber: draft.toyNumber,
            name: draft.name,
            year: draft.year,
          }),
        });
        return;
      }
      if (releases.length > 1) {
        setCandidates({
          title: "Which release?",
          intro: `Toy number ${raw.toUpperCase()} appears more than once in the catalogue.`,
          items: releases.map((release) => ({ release, name: release.name, year: release.year })),
        });
        return;
      }
      setPending({
        draft: { ...BLANK_DRAFT, toyNumber: raw.toUpperCase() },
        error: `Toy number ${raw.toUpperCase()} is not in the catalogue yet. Fill it in by hand — it will be remembered.`,
        errorCode: "not_in_catalogue",
      });
      return;
    }

    const upc = normaliseBarcode(raw);
    if (!upc) {
      show("Enter the digits printed under the barcode.", "bad");
      return;
    }
    setTypedBarcode(null);

    const known = await carsForUpc(upc);
    if (known.length === 1) {
      const taken = await addAnother(known[0]);
      show(
        taken.fromWishlist ?
          `${taken.car.name} — off the wishlist, it's yours!`
        : `${taken.car.name} — now ×${taken.car.quantity}`,
        "good",
      );
      return;
    }
    if (known.length > 1) {
      setPicker({ upc, cars: known });
      return;
    }
    // Unknown here; the shared database may still know it.
    setArmedUpc(upc);
    armedRef.current = upc;
    const found = await sharedCandidates(upc);
    if (found.length && armedRef.current === upc) {
      await offerShared(upc);
      return;
    }
    // Nobody knows it and there is no photo to work from: open the form so it
    // can be filled in by hand, and remember the barcode against the result.
    setArmedUpc(null);
    setPending({ draft: { ...BLANK_DRAFT, upc }, upc });
  }, [typedBarcode, show, offerShared]);

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

  const savePending = useCallback(async (asWishlist = false) => {
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

    // Wishing for a car already on the wishlist just freshens its details;
    // wishing for one already owned is caught before the button is shown.
    if (asWishlist && !existing) {
      const wish: Car = {
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
        quantity: 1,
        notes: draft.notes,
        thumbnail,
        upc,
        confidence,
        wanted: true,
        source: upc ? "barcode" : "photo",
        addedAt: now,
        updatedAt: now,
      };
      try {
        await putCar(wish);
        await learnUpc(upc, wish);
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
      show(`${wish.name} added to the wishlist`, "good");
      return;
    }

    if (asWishlist && existing?.wanted) {
      setPending(null);
      show(`${existing.name} is already on your wishlist`, "good");
      return;
    }

    if (existing) {
      const fromWishlist = Boolean(existing.wanted);
      const merged: Car = {
        ...existing,
        wanted: false,
        addedAt: fromWishlist ? now : existing.addedAt,
        quantity:
          fromWishlist ?
            Math.max(1, draft.quantity)
          : existing.quantity + draft.quantity,
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
        await learnUpc(upc, merged);
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
      show(
        fromWishlist ?
          `${merged.name} — off the wishlist, it's yours!`
        : `${merged.name} — already in the garage, now ×${merged.quantity}`,
        "good",
      );
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
      source:
        upc ? "barcode"
        : thumbnail ? "photo"
        : "manual",
      addedAt: now,
      updatedAt: now,
    };
    try {
      await putCar(car);
      await learnUpc(upc, car);
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
            <div className={`reticle${armedUpc ? " is-armed" : ""}`}>
              <span />
              <span />
              <span />
              <span />
              <div className="scanline" />
            </div>
            <div className={`scan-hint${armedUpc ? " is-armed" : ""}`}>
              {busy ? "Reading the card…"
              : armedUpc ?
                `Barcode ${armedUpc} — now the front, then the shutter`
              : liveBarcode ? `Barcode ${liveBarcode}`
              : status === "starting" ? "Starting camera…"
              : "Barcode on the back, or the shutter on the front"}
            </div>
          </div>

          <div className="shutter-row">
            <label className="side-action" title="Pick from library" aria-label="Pick from library">
              <GalleryIcon />
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
              {busy ? <span className="spinner" /> : <span className="shutter-core" />}
            </button>

            {torch.available ?
              <button
                type="button"
                className="side-action"
                onClick={() => void toggleTorch()}
                aria-pressed={torch.on}
                title="Torch"
                aria-label="Torch"
              >
                <TorchIcon on={torch.on} />
              </button>
            : <span className="side-action" style={{ visibility: "hidden" }} />}
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button
              type="button"
              className="btn btn-block btn-ghost"
              onClick={() => setTypedBarcode("")}
            >
              <KeyboardIcon />
              Type a code
            </button>
            <button
              type="button"
              className="btn btn-block btn-ghost"
              onClick={() => setPending({ draft: { ...BLANK_DRAFT } })}
            >
              <PencilIcon />
              Add by hand
            </button>
          </div>

          <div className="card" style={{ marginTop: 4 }}>
            <div className="segmented" style={{ marginBottom: 10 }}>
              <button
                type="button"
                aria-pressed={mode === "confirm"}
                onClick={() => setMode("confirm")}
              >
                Confirm each
              </button>
              <button
                type="button"
                aria-pressed={mode === "rapid"}
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
            A barcode you have scanned before adds instantly, and one other
            collectors have scanned offers their cars without a photo. Mattel
            prints one barcode per assortment, not per car, so a brand-new
            barcode still needs a photo of the front — or the toy number
            printed next to the barcode, typed in: the catalogue fills in the
            rest.
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
            <h2>Type a code</h2>
            <p className="muted small" style={{ marginTop: 2, marginBottom: 14 }}>
              The <b>toy number</b> printed beside the barcode (like HTB29)
              looks the car up in the catalogue — name, series, number, year,
              all filled in. Or type the digits under a barcode that will not
              scan.
            </p>
            <label className="field">
              <span>Toy number or barcode</span>
              <input
                autoFocus
                autoCapitalize="characters"
                autoComplete="off"
                value={typedBarcode}
                onChange={(event) =>
                  setTypedBarcode(event.target.value.replace(/[^0-9A-Za-z -]/g, ""))
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submitTypedCode();
                }}
                placeholder="HTB29"
              />
            </label>
            <div className="sheet-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void submitTypedCode()}
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
                    const taken = await addAnother(car);
                    setPicker(null);
                    show(
                      taken.fromWishlist ?
                        `${taken.car.name} — off the wishlist, it's yours!`
                      : `${taken.car.name} — now ×${taken.car.quantity}`,
                      "good",
                    );
                  }}
                >
                  {car.thumbnail ?
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="car-thumb" src={car.thumbnail} alt="" />
                  : <div className="car-thumb is-empty">
                      <CarIcon />
                    </div>
                  }
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

      {candidates && (
        <div className="sheet-backdrop" onClick={() => setCandidates(null)}>
          <div className="sheet" onClick={(event) => event.stopPropagation()}>
            <h2>{candidates.title}</h2>
            <p className="muted small" style={{ marginTop: 0 }}>
              {candidates.intro}
            </p>
            <div className="cars">
              {candidates.items.map((item, index) => (
                <button
                  key={`${item.toyNumber ?? item.release?.toyNumber ?? index}-${index}`}
                  type="button"
                  className="car"
                  style={{ textAlign: "left", width: "100%" }}
                  onClick={() => void pickCandidate(candidates, item)}
                >
                  <div className="car-thumb is-empty">
                    <CarIcon />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="car-name">{item.release?.name ?? item.name}</div>
                    <div className="car-meta">
                      {item.release ?
                        releaseSubtitle(item.release)
                      : [item.year, item.toyNumber].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  {item.count !== undefined && (
                    <div className="qty" title="Collectors who confirmed this">
                      {item.count}
                    </div>
                  )}
                </button>
              ))}
            </div>
            <div className="sheet-actions">
              {candidates.upc && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    // Keep the barcode armed: the next shutter press attaches it.
                    setCandidates(null);
                  }}
                >
                  None — photograph the front
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setCandidates(null);
                  setArmedUpc(null);
                  cooldown(candidates.upc, SUPPRESS_MS);
                }}
              >
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
                : pending.errorCode === "not_in_catalogue" ?
                  pending.error
                : <>Could not identify the photo: {pending.error}</>}
              </p>
            )}

            {pending.matched && (
              <p className="notice notice-good">
                {pending.matched.wanted ?
                  <>
                    <b>{pending.matched.name}</b> is on your wishlist! Saving
                    marks it found and moves it into the garage.
                  </>
                : <>
                    Looks like <b>{pending.matched.name}</b>, already in your
                    garage (×{pending.matched.quantity}). Saving adds another
                    instead of creating a duplicate entry.
                  </>
                }
              </p>
            )}

            <p className="muted small" style={{ marginTop: 2, marginBottom: 14 }}>
              {pending.catalogue ?
                <span className="confidence">
                  <CheckIcon />
                  Confirmed by the catalogue
                  {pending.catalogue === "toy" ? " (toy number)"
                  : pending.catalogue === "collector" ? " (collector number)"
                  : ""}
                </span>
              : pending.confidence !== undefined ?
                <span
                  className={`confidence${pending.confidence < 0.6 ? " is-low" : ""}`}
                >
                  {Math.round(pending.confidence * 100)}% sure
                </span>
              : "Type the toy number and the catalogue fills in the rest — only the name is required."
              }
              {pending.upc && (
                <span style={{ marginLeft: 8 }}>Barcode {pending.upc}</span>
              )}
            </p>

            <CatalogueHint
              draft={pending.draft}
              onApply={(draft) =>
                setPending({ ...pending, draft, catalogue: "toy", saveError: undefined })
              }
            />

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
            {!pending.matched && (
              <button
                type="button"
                className="btn btn-ghost btn-block"
                style={{ marginTop: 10 }}
                onClick={() => void savePending(true)}
              >
                Don&rsquo;t own it yet — add to wishlist
              </button>
            )}
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
