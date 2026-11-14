import "server-only";
import { createHash } from "node:crypto";

/**
 * A live look at the Hot Wheels Wiki's yearly list, for releases the shipped
 * catalogue has no picture of yet. New cars appear on the wiki before anyone
 * has photographed them, so the catalogue built a few weeks ago is blank for
 * exactly the cars a collector is buying now; the wiki usually catches up
 * within days. Only the picture's file path comes back: the image itself is
 * still loaded from the wiki by the phone and never stored.
 *
 * The parsing mirrors scripts/build-catalogue.mjs, cut down to what finding a
 * photo needs.
 */

export const API = process.env.WIKI_API_URL || "https://hotwheels.fandom.com/api.php";
const TTL_MS = 12 * 60 * 60 * 1000;

export interface WikiRow {
  toyNumber?: string;
  collectorNumber?: string;
  name: string;
  photo?: string;
}

const cache = new Map<number, { at: number; rows: Promise<WikiRow[]> }>();

/** Every row of a year's list that has a real picture. Cached for half a day. */
export function wikiRowsForYear(year: number): Promise<WikiRow[]> {
  const hit = cache.get(year);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rows;
  const rows = fetchYear(year).catch((error: unknown) => {
    cache.delete(year); // a failed fetch must not stick for twelve hours
    throw error;
  });
  cache.set(year, { at: Date.now(), rows });
  return rows;
}

async function fetchYear(year: number): Promise<WikiRow[]> {
  const page = `List of ${year} Hot Wheels`;
  const url = `${API}?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json`;
  const response = await fetch(url, {
    headers: { "user-agent": "moneyhole-photo-lookup" },
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Wiki answered ${response.status}`);
  const json = (await response.json()) as { parse?: { wikitext?: { "*"?: string } } };
  const text = json.parse?.wikitext?.["*"];
  if (!text) return [];
  const rows: WikiRow[] = [];
  for (const { headers, cells } of parseTables(text)) {
    const row = toRow(headers, cells);
    if (row?.photo) rows.push(row);
  }
  return rows;
}

function normaliseName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The row for one release: toy number first, then collector number, then a unique name. */
export function findRow(
  rows: WikiRow[],
  want: { toyNumber?: string; collectorNumber?: string; name?: string },
): WikiRow | undefined {
  if (want.toyNumber) {
    const byToy = rows.find((row) => row.toyNumber === want.toyNumber);
    if (byToy) return byToy;
  }
  if (want.collectorNumber) {
    const byCol = rows.filter((row) => row.collectorNumber === want.collectorNumber);
    if (byCol.length === 1) return byCol[0];
    if (want.name) {
      const needle = normaliseName(want.name);
      const named = byCol.filter((row) => normaliseName(row.name) === needle);
      if (named.length === 1) return named[0];
    }
  }
  if (want.name) {
    const needle = normaliseName(want.name);
    const named = rows.filter((row) => normaliseName(row.name) === needle);
    if (named.length === 1) return named[0];
  }
  return undefined;
}

/* --------------------------------------------------------------- parse --- */

export function plain(cell: string): string {
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

function cellBody(raw: string): string {
  const text = raw.trim();
  const match = /^([^|[{]*?\|)(?!\|)/.exec(text);
  return match && /=/.test(match[1]) ? text.slice(match[1].length) : text;
}

export function parseTables(text: string): Array<{ headers: string[]; cells: string[] }> {
  const rows: Array<{ headers: string[]; cells: string[] }> = [];
  let headers: string[] = [];
  let cells: string[] | null = null;
  let inTable = false;
  const flush = () => {
    if (cells && cells.length) rows.push({ headers, cells });
    cells = null;
  };
  for (const line of text.split("\n")) {
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
    if (cells && cells.length) cells[cells.length - 1] += "\n" + line;
  }
  flush();
  return rows;
}

export function columnIndex(headers: string[], ...names: string[]): number {
  return headers.findIndex((header) => names.some((name) => header.replace(/[.\s]/g, "") === name));
}

/** Same upload path the catalogue stores: <a>/<ab>/<Name>, from the MD5 of the name. */
export function imagePath(rawTitle: string): string | undefined {
  let title = rawTitle.trim().replace(/\s+/g, "_").replace(/[​‌‍﻿]/g, "");
  if (!title) return undefined;
  title = title[0].toUpperCase() + title.slice(1);
  const hash = createHash("md5").update(title, "utf8").digest("hex");
  return `${hash[0]}/${hash.slice(0, 2)}/${title}`;
}

function toRow(headers: string[], cells: string[]): WikiRow | null {
  const toyAt = columnIndex(headers, "toy#", "toy#:", "toynumber", "toy");
  const colAt = columnIndex(headers, "col#", "col", "collector#", "#");
  const nameAt = columnIndex(headers, "modelname", "model", "name", "casting");
  if (nameAt < 0 || (toyAt < 0 && colAt < 0)) return null;
  const get = (at: number) => (at >= 0 && at < cells.length ? cells[at] : "");
  const name = plain(get(nameAt));
  if (!name) return null;

  const photoAt = columnIndex(headers, "photo", "image", "picture");
  const photoMatch = /\[\[(?:File|Image):([^\]|]+)/i.exec(
    photoAt >= 0 ? get(photoAt) : cells.join("\n"),
  );
  const photo =
    photoMatch && !/not[\s_]*available/i.test(photoMatch[1]) ? imagePath(photoMatch[1]) : undefined;

  const toy = plain(get(toyAt)).split(/[·/,]/)[0].replace(/\s+/g, "").toUpperCase();
  const col = plain(get(colAt)).replace(/[^\d]/g, "");
  return {
    name,
    toyNumber: toy || undefined,
    collectorNumber: col ? String(Number(col)).padStart(3, "0") : undefined,
    photo,
  };
}
