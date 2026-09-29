/**
 * Builds the PWA icons from public/icon-source.png.
 *
 * The source render has a dark margin around its gold frame. Launchers add
 * their own rounded mask, so shipping that margin would show a frame inside
 * a frame: this finds the gold frame's extent and crops to it, then resizes.
 * Uses the Chromium that Playwright already provides rather than adding an
 * image toolchain. Run with `npm run icons`.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "public", "icon-source.png");
const SIZES = [192, 512];

const dataUrl = `data:image/png;base64,${readFileSync(SOURCE).toString("base64")}`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
await page.setContent("<!doctype html><body style='margin:0;background:#000'></body>");

const crop = await page.evaluate(async (src) => {
  const img = new Image();
  img.src = src;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  // The frame is the outermost strongly-gold thing in the picture, so the
  // bounding box of gold pixels is the bounding box of the frame.
  let minX = c.width, minY = c.height, maxX = 0, maxY = 0;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r > 170 && g > 120 && b < 110 && r - b > 100) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  // Square it up around the centre and trim a hair inside the glow.
  const side = Math.max(maxX - minX, maxY - minY) + 1;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  return { x: Math.round(cx - side / 2) + 4, y: Math.round(cy - side / 2) + 4, side: side - 8, w: img.width, h: img.height };
}, dataUrl);

console.log(`source ${crop.w}x${crop.h}, frame crop ${crop.side}px at (${crop.x},${crop.y})`);

for (const size of SIZES) {
  const png = await page.evaluate(async ({ src, crop, size }) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = size; c.height = size;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, crop.x, crop.y, crop.side, crop.side, 0, 0, size, size);
    return c.toDataURL("image/png").split(",")[1];
  }, { src: dataUrl, crop, size });
  const file = join(ROOT, "public", `icon-${size}.png`);
  writeFileSync(file, Buffer.from(png, "base64"));
  console.log(`wrote ${file}`);
}

await browser.close();
