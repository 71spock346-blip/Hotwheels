/**
 * Rasterises public/icon.svg into the PNGs the manifest and iOS need.
 *
 * Uses the Chromium that Playwright already provides rather than adding an
 * image toolchain. Run with `npm run icons` after editing the SVG.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SVG = readFileSync(join(ROOT, "public", "icon.svg"), "utf8");

const SIZES = [192, 512];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const page = await browser.newPage();

for (const size of SIZES) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><style>
       html,body{margin:0;padding:0;background:#101119}
       svg{display:block;width:${size}px;height:${size}px}
     </style>${SVG}`,
    { waitUntil: "load" },
  );
  const png = await page.screenshot({ omitBackground: false });
  const file = join(ROOT, "public", `icon-${size}.png`);
  writeFileSync(file, png);
  console.log(`wrote ${file}`);
}

await browser.close();
