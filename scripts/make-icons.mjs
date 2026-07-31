/**
 * Generates the PWA icons as real PNGs, with no image dependencies.
 *
 * The mark is three swept speed lines — gold, orange, deep red — on the app's
 * near-black. Run with `npm run icons` after changing anything here.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

const BACKGROUND = [0x0e, 0x0f, 0x12];
const STRIPES = [
  { offset: -0.2, shorten: 0.1, color: [0xff, 0xb7, 0x03] },
  { offset: 0.0, shorten: 0.0, color: [0xff, 0x5a, 0x1f] },
  { offset: 0.2, shorten: 0.1, color: [0xe0, 0x3a, 0x10] },
];

const HALF_LENGTH = 0.3;
const RADIUS = 0.075;
const SAMPLES = 3; // supersampling factor, for smooth edges

function unit(x, y) {
  const length = Math.hypot(x, y);
  return [x / length, y / length];
}

const [dirX, dirY] = unit(1, -0.6);
const [perpX, perpY] = unit(0.6, 1);

/** Shortest distance from a point to a line segment. */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSquared = abx * abx + aby * aby;
  const t =
    lengthSquared === 0 ?
      0
    : Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lengthSquared));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

/** Colour of the mark at a normalised point, or null for background. */
function sample(nx, ny) {
  for (const stripe of STRIPES) {
    const cx = 0.5 + perpX * stripe.offset;
    const cy = 0.5 + perpY * stripe.offset;
    const half = HALF_LENGTH - stripe.shorten;
    if (
      distanceToSegment(
        nx,
        ny,
        cx - dirX * half,
        cy - dirY * half,
        cx + dirX * half,
        cy + dirY * half,
      ) <= RADIUS
    ) {
      return stripe.color;
    }
  }
  return null;
}

function render(size) {
  // One filter byte (0 = None) per row, then RGB triples.
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (1 + size * 3);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const nx = (x + (sx + 0.5) / SAMPLES) / size;
          const ny = (y + (sy + 0.5) / SAMPLES) / size;
          const colour = sample(nx, ny) ?? BACKGROUND;
          r += colour[0];
          g += colour[1];
          b += colour[2];
        }
      }
      const total = SAMPLES * SAMPLES;
      const offset = rowStart + 1 + x * 3;
      raw[offset] = Math.round(r / total);
      raw[offset + 1] = Math.round(g / total);
      raw[offset + 2] = Math.round(b / total);
    }
  }
  return raw;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, raw) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [192, 512]) {
  const file = join(OUT_DIR, `icon-${size}.png`);
  writeFileSync(file, encodePng(size, render(size)));
  console.log(`wrote ${file}`);
}
