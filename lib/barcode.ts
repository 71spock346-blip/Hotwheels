"use client";

/**
 * Continuous barcode scanning off a <video> element.
 *
 * Chrome/Android has a native BarcodeDetector, which is fast and free. Safari
 * (i.e. every iPhone) does not, so we lazily pull in ZXing only when needed —
 * that keeps the ~300kB decoder out of the bundle for everyone else.
 */

const FORMATS = ["upc_a", "upc_e", "ean_13", "ean_8", "code_128"] as const;

/**
 * Enough resolution that a barcode filling a third of the frame still has
 * several pixels per module, while keeping the pure-JS decoder responsive.
 */
const DECODE_MAX_EDGE = 1280;

/** Which decoder is running — surfaced in the UI, because "nothing happens" is
 * otherwise impossible to tell apart from "the decoder never loaded". */
export type ScannerKind = "native" | "zxing";

type NativeDetector = {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
};

export type Scanner = {
  kind: ScannerKind;
  /** Read one frame. Returns a barcode string, or null if nothing was found. */
  scan(video: HTMLVideoElement): Promise<string | null>;
  stop(): void;
};

export async function createScanner(): Promise<Scanner> {
  const native = await createNativeScanner();
  if (native) return native;
  return createZxingScanner();
}

async function createNativeScanner(): Promise<Scanner | null> {
  const ctor = (globalThis as Record<string, unknown>).BarcodeDetector as
    | (new (options: { formats: string[] }) => NativeDetector)
    | undefined;
  if (!ctor) return null;

  let supported: string[] = [...FORMATS];
  try {
    const getSupported = (
      ctor as unknown as { getSupportedFormats?: () => Promise<string[]> }
    ).getSupportedFormats;
    if (getSupported) {
      const available = await getSupported.call(ctor);
      supported = FORMATS.filter((format) => available.includes(format));
    }
  } catch {
    // Feature detection failed; fall through with the full list and let the
    // constructor throw if it truly cannot handle these formats.
  }
  if (!supported.length) return null;

  let detector: NativeDetector;
  try {
    detector = new ctor({ formats: supported });
  } catch {
    return null;
  }

  return {
    kind: "native",
    async scan(video) {
      if (!video.videoWidth) return null;
      try {
        const results = await detector.detect(video);
        return results[0]?.rawValue ?? null;
      } catch {
        return null;
      }
    },
    stop() {},
  };
}

async function createZxingScanner(): Promise<Scanner> {
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] =
    await Promise.all([import("@zxing/browser"), import("@zxing/library")]);

  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.CODE_128,
  ]);
  hints.set(DecodeHintType.TRY_HARDER, true);

  const reader = new BrowserMultiFormatReader(hints);
  const canvas = document.createElement("canvas");

  return {
    kind: "zxing",
    async scan(video) {
      if (!video.videoWidth) return null;
      // Decode the whole frame, downscaled for speed rather than cropped.
      // A Hot Wheels barcode sits at the very bottom of the card, so any
      // centre crop misses it exactly when the user has framed the card well.
      const scale = Math.min(
        1,
        DECODE_MAX_EDGE / Math.max(video.videoWidth, video.videoHeight),
      );
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return null;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      try {
        return reader.decodeFromCanvas(canvas).getText();
      } catch {
        return null; // No barcode in this frame — completely normal.
      }
    },
    stop() {
      // BrowserMultiFormatReader holds no stream of its own here; we only ever
      // hand it a canvas. Nothing to release.
    },
  };
}

/**
 * UPC-E is a zero-suppressed UPC-A. Expanding it means the same physical
 * barcode always produces the same key regardless of which decoder read it.
 */
export function normaliseBarcode(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 8) return expandUpcE(digits);
  // A 13-digit EAN with a leading zero is a UPC-A in disguise.
  if (digits.length === 13 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

function expandUpcE(upcE: string): string {
  const body = upcE.length === 8 ? upcE.slice(1, 7) : upcE;
  const numberSystem = upcE.length === 8 ? upcE[0] : "0";
  const check = upcE.length === 8 ? upcE[7] : "";
  const [d1, d2, d3, d4, d5, last] = body.split("");

  let middle: string;
  switch (last) {
    case "0":
    case "1":
    case "2":
      middle = `${d1}${d2}${last}0000${d3}${d4}${d5}`;
      break;
    case "3":
      middle = `${d1}${d2}${d3}00000${d4}${d5}`;
      break;
    case "4":
      middle = `${d1}${d2}${d3}${d4}00000${d5}`;
      break;
    default:
      middle = `${d1}${d2}${d3}${d4}${d5}0000${last}`;
      break;
  }
  return `${numberSystem}${middle}${check}`;
}
