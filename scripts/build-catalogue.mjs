/**
 * Builds public/catalogue.json from the Hot Wheels Wiki's yearly mainline
 * lists (hotwheels.fandom.com, CC BY-SA). One row per release: toy number,
 * collector number, casting name, series, series position, year, and whether
 * it is a Treasure Hunt or a store exclusive.
 *
 *   node scripts/build-catalogue.mjs            # all years
 *   node scripts/build-catalogue.mjs 2024 2025  # just these
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const FIRST_YEAR = 1995;
const LAST_YEAR = new Date().getFullYear() + 1;
const API = "https://hotwheels.fandom.com/api.php";

const years =
  process.argv.slice(2).length ?
    process.argv.slice(2).map(Number)
  : Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);

async function wikitext(page) {
  const url = `${API}?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json`;
  const response = await fetch(url, { headers: { "user-agent": "garage-catalogue-builder" } });
  if (!response.ok) throw new Error(`${page}: HTTP ${response.status}`);
  const json = await response.json();
  return json.parse?.wikitext?.["*"] ?? null;
}

/** [[Target|Label]] -> Label, [[Target]] -> Target, then strip markup. */
function plain(cell) {
  return cell
    .replace(/\[\[File:[^\]]*\]\]/gi, "")
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/<br\s*\/?>/gi, " · ")
    .replace(/<[^>]+>/g, "")
    .replace(/'''|''/g, "")
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/[​‌‍﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cell text with the style prefix ("bgcolor=... |") removed. */
function cellBody(raw) {
  const text = raw.trim();
  // A leading attribute run ends at the first single "|" that is not "||".
  const match = /^([^|[{]*?\|)(?!\|)/.exec(text);
  return match && /=/.test(match[1]) ? text.slice(match[1].length) : text;
}

function parseTables(text) {
  const rows = [];
  const lines = text.split("\n");
  let headers = null;
  let cells = null;
  let inTable = false;

  const flush = () => {
    if (cells && cells.length) rows.push({ headers, cells });
    cells = null;
  };

  for (const line of lines) {
    if (line.startsWith("{|")) {
      inTable = true;
      headers = [];
      cells = null;
      continue;
    }
    if (!inTable) continue;
    if (line.startsWith("|}")) {
      flush();
      inTable = false;
      continue;
    }
    if (line.startsWith("|-")) {
      flush();
      cells = [];
      continue;
    }
    if (line.startsWith("!")) {
      for (const part of line.slice(1).split("!!")) headers.push(plain(cellBody(part)).toLowerCase());
      continue;
    }
    if (line.startsWith("|")) {
      if (!cells) cells = [];
      for (const part of line.slice(1).split("||")) cells.push(cellBody(part));
      continue;
    }
    // Continuation of a multi-line cell.
    if (cells && cells.length) cells[cells.length - 1] += "\n" + line;
  }
  flush();
  return rows;
}

function columnIndex(headers, ...names) {
  return headers.findIndex((header) => names.some((name) => header.replace(/[.\s]/g, "") === name));
}

function toRelease(year, headers, cells) {
  const toyAt = columnIndex(headers, "toy#", "toy#:", "toynumber", "toy");
  const colAt = columnIndex(headers, "col#", "col", "collector#", "#");
  const nameAt = columnIndex(headers, "modelname", "model", "name", "casting");
  const seriesAt = columnIndex(headers, "series");
  const seriesNoAt = columnIndex(headers, "series#", "seriesnumber", "#inseries");
  if (nameAt < 0 || (toyAt < 0 && colAt < 0)) return null;

  const get = (at) => (at >= 0 && at < cells.length ? cells[at] : "");
  const name = plain(get(nameAt));
  if (!name) return null;

  const rawSeries = get(seriesAt);
  const seriesText = plain(rawSeries);
  const seriesParts = seriesText.split(" · ").map((part) => part.trim()).filter(Boolean);
  const isFlag = (part) => /treasure hunt|new for|exclusive|new model|new casting/i.test(part);
  const series = seriesParts.find((part) => !isFlag(part)) ?? seriesParts[0] ?? "";

  // A cell occasionally lists two codes ("14908 / 2015"); the first is the one on the card.
  const toy = plain(get(toyAt)).split(/[·/,]/)[0].replace(/\s+/g, "").toUpperCase();
  const col = plain(get(colAt)).replace(/[^\d]/g, "");
  const seriesNumber = plain(get(seriesNoAt)).replace(/\s+/g, "");
  const th =
    /super treasure hunt/i.test(seriesText) ? "sth"
    : /treasure hunt/i.test(seriesText) ? "th"
    : undefined;
  const exclusive = /exclusive/i.test(seriesText) ? seriesParts.find((part) => /exclusive/i.test(part)) : undefined;

  const release = { t: toy || undefined, c: col || undefined, n: name, s: series || undefined, sn: /^\d+\/\d+$/.test(seriesNumber) ? seriesNumber : undefined, y: year };
  if (th) release.th = th;
  if (exclusive) release.x = exclusive.replace(/\s*exclusive\s*/i, "").trim() || "store";
  return release;
}

const releases = [];
const perYear = {};
for (const year of years) {
  let text;
  try {
    text = await wikitext(`List of ${year} Hot Wheels`);
  } catch (error) {
    console.error(`${year}: ${error.message}`);
    continue;
  }
  if (!text) {
    console.error(`${year}: no page`);
    continue;
  }
  let count = 0;
  const seen = new Set();
  for (const { headers, cells } of parseTables(text)) {
    const release = toRelease(year, headers, cells);
    if (!release) continue;
    // Some years list the same car under two headings; a template that did
    // not expand is not a car at all.
    if (/[{}]/.test(release.n + (release.s ?? ""))) continue;
    const key = `${release.t}|${release.c}|${release.n}`;
    if (seen.has(key)) continue;
    seen.add(key);
    releases.push(release);
    count++;
  }
  perYear[year] = count;
  console.error(`${year}: ${count}`);
}

// Sort so the newest release of a toy number wins nothing — it is unique — but
// name searches read nicely from newest to oldest.
releases.sort((a, b) => b.y - a.y || Number(a.c ?? 0) - Number(b.c ?? 0));

const out = path.join(process.cwd(), "public", "catalogue.json");
await mkdir(path.dirname(out), { recursive: true });
await writeFile(
  out,
  JSON.stringify({
    source: "Hot Wheels Wiki (hotwheels.fandom.com), CC BY-SA 3.0",
    builtAt: new Date().toISOString().slice(0, 10),
    years: perYear,
    releases,
  }),
);
console.error(`wrote ${releases.length} releases to ${out}`);
