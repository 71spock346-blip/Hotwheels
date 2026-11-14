import "server-only";
import { API, columnIndex, imagePath, parseTables, plain } from "./wiki";

/**
 * Every release of one casting, read live from that casting's page on the Hot
 * Wheels Wiki. The shipped catalogue only covers the mainline yearly lists, so
 * premium cards (Car Culture, Pop Culture, Boulevard, Team Transport...) were
 * invisible to it; the casting page lists all of them, with the body colour
 * of each, which is also what tells colour variants of a mainline car apart.
 *
 * Only text and picture paths come back; pictures are still loaded from the
 * wiki by the phone and never stored.
 */

export interface WikiVersion {
  name: string;
  year: number;
  series?: string;
  seriesNumber?: string;
  collectorNumber?: string;
  toyNumber?: string;
  color?: string;
  photo?: string;
}

const TTL_MS = 12 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; versions: Promise<WikiVersion[]> }>();

/** All versions of the casting the wiki files under this name. Cached for half a day. */
export function versionsForCasting(name: string): Promise<WikiVersion[]> {
  const key = name.toLowerCase().trim();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.versions;
  const versions = fetchCasting(name).catch((error: unknown) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, { at: Date.now(), versions });
  if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return versions;
}

async function wiki(params: Record<string, string>): Promise<unknown> {
  const url = `${API}?${new URLSearchParams({ ...params, format: "json" })}`;
  const response = await fetch(url, {
    headers: { "user-agent": "moneyhole-match-lookup" },
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Wiki answered ${response.status}`);
  return response.json();
}

async function pageText(title: string): Promise<{ title: string; text: string } | null> {
  const json = (await wiki({
    action: "parse",
    page: title,
    prop: "wikitext",
    redirects: "1",
  })) as { parse?: { title?: string; wikitext?: { "*"?: string } }; error?: unknown };
  const text = json.parse?.wikitext?.["*"];
  return text ? { title: json.parse?.title ?? title, text } : null;
}

async function searchTitle(name: string): Promise<string | null> {
  const json = (await wiki({
    action: "query",
    list: "search",
    srsearch: name,
    srnamespace: "0",
    srlimit: "5",
  })) as { query?: { search?: Array<{ title: string }> } };
  const titles = (json.query?.search ?? []).map((hit) => hit.title);
  // Year lists and series pages mention every car; the casting page is what we want.
  return titles.find((title) => !/^list of|^\d{4} /i.test(title)) ?? null;
}

async function fetchCasting(name: string): Promise<WikiVersion[]> {
  let page = await pageText(name);
  if (!page || !hasVersions(page.text)) {
    const title = await searchTitle(name);
    page = title ? await pageText(title) : null;
  }
  if (!page) return [];
  return parseVersions(page.title, page.text);
}

function hasVersions(text: string): boolean {
  return /\{\|/.test(text) && /toy\s*#|toy number/i.test(text);
}

/** The casting page's version tables, one row per release. */
export function parseVersions(casting: string, text: string): WikiVersion[] {
  const out: WikiVersion[] = [];
  const seen = new Set<string>();
  for (const { headers, cells } of parseTables(text)) {
    const yearAt = columnIndex(headers, "year");
    const toyAt = columnIndex(headers, "toy#", "toy#:", "toynumber", "toy");
    if (yearAt < 0 || toyAt < 0) continue;
    const get = (at: number) => (at >= 0 && at < cells.length ? cells[at] : "");
    const year = Number(/\b(19|20)\d{2}\b/.exec(plain(get(yearAt)))?.[0]);
    if (!year) continue;

    const colAt = columnIndex(headers, "col#", "col", "collector#", "#");
    const seriesAt = columnIndex(headers, "series");
    const colorAt = columnIndex(headers, "color", "colour", "bodycolor", "bodycolour");
    const photoAt = columnIndex(headers, "photo", "image", "picture");

    const photoMatch = /\[\[(?:File|Image):([^\]|]+)/i.exec(
      photoAt >= 0 ? get(photoAt) : cells.join("\n"),
    );
    const photo =
      photoMatch && !/not[\s_]*available/i.test(photoMatch[1]) ?
        imagePath(photoMatch[1])
      : undefined;

    const toy = plain(get(toyAt)).split(/[·/,\s]/)[0].toUpperCase().replace(/[^A-Z0-9]/g, "");
    // The Col # column holds the mainline number ("69/250" or "69"); the set
    // position ("2/5", "#16") is written into the series cell after a dot.
    const colText = plain(get(colAt));
    const colFraction = /(\d+)\s*\/\s*(\d+)/.exec(colText);
    let setPosition =
      colFraction && Number(colFraction[2]) <= 30 ?
        `${Number(colFraction[1])}/${Number(colFraction[2])}`
      : undefined;
    const plainCol =
      colFraction ?
        Number(colFraction[2]) > 30 ? colFraction[1] : ""
      : colText.replace(/[^\d]/g, "");
    const seriesParts: string[] = [];
    for (const raw of plain(get(seriesAt)).split(" · ")) {
      const part = raw.trim();
      if (!part || /treasure hunt|new for|new model|new casting/i.test(part)) continue;
      const position = /^#?\s*(\d+)\s*(?:\/\s*(\d+))?$/.exec(part);
      if (position) {
        setPosition ??= position[2] ? `${Number(position[1])}/${Number(position[2])}` : undefined;
        continue;
      }
      seriesParts.push(part);
    }
    const seriesText = seriesParts.join(" · ");
    const color = plain(get(colorAt)).split(" · ")[0];

    const version: WikiVersion = { name: casting, year };
    if (seriesText) version.series = seriesText.slice(0, 80);
    if (setPosition) version.seriesNumber = setPosition;
    if (plainCol) version.collectorNumber = String(Number(plainCol)).padStart(3, "0");
    if (toy && /^[A-Z0-9]{4,8}$/.test(toy)) version.toyNumber = toy;
    if (color) version.color = color.slice(0, 60);
    if (photo) version.photo = photo;

    const key = `${version.toyNumber ?? ""}|${year}|${version.color ?? ""}|${version.series ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(version);
  }
  // Newest first: what a collector photographs today is usually recent.
  return out.sort((a, b) => b.year - a.year);
}
