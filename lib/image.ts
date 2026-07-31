"use client";

/**
 * Capture a frame from the live camera at a resolution worth sending to a
 * vision model. Hot Wheels cards carry the toy number in ~2mm type, so
 * downscaling too aggressively is what makes identification go wrong.
 *
 * `aspect` is the width/height the viewfinder actually shows. The preview uses
 * object-fit: cover, so a wide camera stream in a tall frame hides most of its
 * width — capturing the raw frame would return a photo far wider than the user
 * composed, leaving the card small and its fine print unreadable.
 */
export function captureFrame(
  video: HTMLVideoElement,
  options: { aspect?: number; maxEdge?: number } = {},
): string {
  const { aspect, maxEdge = 1800 } = options;
  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;

  let sourceWidth = videoWidth;
  let sourceHeight = videoHeight;
  if (aspect && aspect > 0) {
    if (videoWidth / videoHeight > aspect) {
      sourceWidth = videoHeight * aspect; // stream is wider — trim the sides
    } else {
      sourceHeight = videoWidth / aspect; // stream is taller — trim top/bottom
    }
  }
  const sourceX = (videoWidth - sourceWidth) / 2;
  const sourceY = (videoHeight - sourceHeight) / 2;

  const canvas = document.createElement("canvas");
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  canvas.width = Math.round(sourceWidth * scale);
  canvas.height = Math.round(sourceHeight * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not get a 2D canvas context");
  context.drawImage(
    video,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas.toDataURL("image/jpeg", 0.9);
}

/** Shrink an existing data URL — used to make grid thumbnails. */
export function makeThumbnail(dataUrl: string, maxEdge = 320): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      const context = canvas.getContext("2d");
      if (!context) return reject(new Error("Could not get a 2D canvas context"));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.7));
    };
    image.onerror = () => reject(new Error("Could not decode the captured image"));
    image.src = dataUrl;
  });
}

/** Read a file the user picked from their camera roll into a sized data URL. */
export function fileToDataUrl(file: File, maxEdge = 1800): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const context = canvas.getContext("2d");
        if (!context) return reject(new Error("Could not get a 2D canvas context"));
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.9));
      };
      image.onerror = () => reject(new Error("Could not read that image"));
      image.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.readAsDataURL(file);
  });
}

export function dataUrlParts(dataUrl: string): { mediaType: string; base64: string } {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error("Expected a base64 data URL");
  return { mediaType: match[1], base64: match[2] };
}
