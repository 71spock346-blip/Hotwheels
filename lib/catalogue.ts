"use client";

import type { Identification, TreasureHunt } from "./types";

/**
 * The release catalogue: every mainline Hot Wheels since 1995, keyed by the
 * Mattel toy number printed on the card. Built by scripts/build-catalogue.mjs
 * from the Hot Wheels Wiki and shipped as a static file, so a lookup costs
 * nothing and works offline once cached.
 *
 * This is what turns a partial read — a toy number off the back, or a
 * collector number off the front — into the complete record: casting name,
 * series, position in series, collector number, year, treasure hunt status.
 */

export interface Release {
  toyNumber?: string;
  collectorNumber?: string;
  name: string;
  series?: string;
  seriesNumber?: string;
  year: number;
  treasureHunt?: Exclude<TreasureHunt, "none">;
  /** Store exclusive, e.g. "Walmart", "Dollar General". */
  exclusive?: string;
}

interface RawRelease {
  t?: string;
  c?: string;
  n: string;
  s?: string;
  sn?: string;
  y: number;
  th?: "th" | "sth";
  x?: string;
}

interface RawCatalogue {
  source: string;
  builtAt: string;
  years: Record<string, number>;
  releases: RawRelease[];
}

export interface Catalogue {
  builtAt: string;
  count: number;
  years: number[];
  releases: Release[];
  byToy: Map<string, Release[]>;
  byCollector: Map<string, Release[]>;
}

let loading: Promise<Catalogue> | null = null;

export function loadCatalogue(): Promise<Catalogue> {
  if (!loading) {
    loading = fetch("/catalogue.json")
      .then(async (response) => {
        if (!response.ok) throw new Error(`Catalogue unavailable (${response.status}).`);
        return build((await response.json()) as RawCatalogue);
      })
      .catch((error: unknown) => {
        loading = null; // let a later call retry after a network blip
        throw error;
      });
  }
  return loading;
}

function build(raw: RawCatalogue): Catalogue {
  const releases = raw.releases.map(fromRaw);
  const byToy = new Map<string, Release[]>();
  const byCollector = new Map<string, Release[]>();
  for (const release of releases) {
    if (release.toyNumber) push(byToy, release.toyNumber, release);
    if (release.collectorNumber) {
      push(byCollector, collectorKey(release.collectorNumber, release.year), release);
    }
  }
  return {
    builtAt: raw.builtAt,
    count: releases.length,
    years: Object.keys(raw.years).map(Number).sort(),
    releases,
    byToy,
    byCollector,
  };
}

function push(map: Map<string, Release[]>, key: string, release: Release) {
  const list = map.get(key);
  if (list) list.push(release);
  else map.set(key, [release]);
}

function fromRaw(raw: RawRelease): Release {
  const release: Release = { name: raw.n, year: raw.y };
  if (raw.t) release.toyNumber = raw.t;
  if (raw.c) release.collectorNumber = raw.c;
  if (raw.s) release.series = raw.s;
  if (raw.sn) release.seriesNumber = raw.sn;
  if (raw.th) release.treasureHunt = raw.th;
  if (raw.x) release.exclusive = raw.x;
  return release;
}

/* ------------------------------------------------------------- keys --- */

/**
 * The toy number as the catalogue keys it. Cards print it with a suffix
 * ("HTB29-0910", "HTB29 9B0") that varies by factory batch and means nothing
 * to a collector; the five characters before it are the identity.
 */
export function normaliseToyNumber(raw: string | null | undefined): string {
  if (!raw) return "";
  const cleaned = raw.toUpperCase().trim().split(/[\s/-]/)[0].replace(/[^A-Z0-9]/g, "");
  // Modern codes are two or three letters then digits, five characters in
  // all; older ones are purely numeric and vary in length.
  const modern = /^([A-Z]{2,3}\d{2,3})/.exec(cleaned);
  return modern ? modern[1] : cleaned;
}

/** "223/250" -> "223", "#7" -> "7", padded the way the catalogue stores it. */
export function normaliseCollectorNumber(raw: string | null | undefined): string {
  if (!raw) return "";
  const first = raw.split("/")[0].replace(/\D/g, "");
  return first ? String(Number(first)).padStart(3, "0") : "";
}

function collectorKey(collectorNumber: string, year: number): string {
  return `${year}:${normaliseCollectorNumber(collectorNumber)}`;
}

/** Looks like a toy number rather than a barcode: has letters, or is short. */
export function looksLikeToyNumber(raw: string): boolean {
  const cleaned = raw.replace(/[\s-]/g, "");
  return /[A-Za-z]/.test(cleaned) ? cleaned.length >= 4 : cleaned.length >= 4 && cleaned.length <= 6;
}

function normaliseName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/* ---------------------------------------------------------- lookups --- */

export function lookupToyNumber(catalogue: Catalogue, raw: string): Release[] {
  const key = normaliseToyNumber(raw);
  return key ? (catalogue.byToy.get(key) ?? []) : [];
}

export function lookupCollectorNumber(
  catalogue: Catalogue,
  raw: string,
  year?: number | null,
): Release[] {
  const number = normaliseCollectorNumber(raw);
  if (!number) return [];
  if (year) return catalogue.byCollector.get(`${year}:${number}`) ?? [];
  return catalogue.releases.filter((release) => release.collectorNumber === number);
}

/** Name search for the manual paths: exact normalised match first, then contains. */
export function searchCatalogue(catalogue: Catalogue, query: string, limit = 12): Release[] {
  const needle = normaliseName(query);
  if (needle.length < 2) return [];
  const exact: Release[] = [];
  const partial: Release[] = [];
  for (const release of catalogue.releases) {
    const name = normaliseName(release.name);
    if (name === needle) exact.push(release);
    else if (name.includes(needle)) partial.push(release);
    if (exact.length >= limit) break;
  }
  return [...exact, ...partial].slice(0, limit);
}

/* ---------------------------------------------------------- resolve --- */

export type MatchedBy = "toy" | "collector" | "name";

export interface Resolution {
  release: Release;
  by: MatchedBy;
}

function seriesMatches(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const x = normaliseName(a).replace(/^hw /, "");
  const y = normaliseName(b).replace(/^hw /, "");
  return x === y || x.includes(y) || y.includes(x);
}

/**
 * Pin a partial identification to one catalogue release.
 *
 * The toy number alone settles it. Without one, the collector number narrows
 * to a handful across years and the series name or year picks between them;
 * the casting name is the weakest signal and only counts when it lands on a
 * single release in the year. Anything ambiguous returns nothing rather than
 * a guess — a wrong series number would silently corrupt series completion.
 */
export function resolveIdentification(
  catalogue: Catalogue,
  partial: Partial<Pick<Identification, "treasureHunt">> &
    Pick<
      Identification,
      "toyNumber" | "collectorNumber" | "name" | "year" | "series" | "seriesNumber"
    >,
): Resolution | undefined {
  const byToy = partial.toyNumber ? lookupToyNumber(catalogue, partial.toyNumber) : [];
  if (byToy.length === 1) return { release: byToy[0], by: "toy" };
  if (byToy.length > 1) {
    const narrowed = byToy.filter(
      (release) =>
        (partial.year && release.year === partial.year) ||
        seriesMatches(release.series, partial.series) ||
        normaliseName(release.name) === normaliseName(partial.name),
    );
    if (narrowed.length === 1) return { release: narrowed[0], by: "toy" };
    // Same code reused across years: prefer the newest, they are the same casting.
    return { release: byToy[0], by: "toy" };
  }

  if (partial.collectorNumber) {
    const inYear = lookupCollectorNumber(catalogue, partial.collectorNumber, partial.year);
    const pool = inYear.length ? inYear : lookupCollectorNumber(catalogue, partial.collectorNumber);
    const pick = disambiguate(pool, partial);
    if (pick) return { release: pick, by: "collector" };
  }

  if (partial.name) {
    const needle = normaliseName(partial.name);
    const sameName = catalogue.releases.filter(
      (release) => normaliseName(release.name) === needle,
    );
    const pick = disambiguate(sameName, partial);
    if (pick) return { release: pick, by: "name" };
  }

  return undefined;
}

function disambiguate(
  pool: Release[],
  partial: {
    name: string;
    year: number | null;
    series: string | null;
    seriesNumber: string | null;
    treasureHunt?: TreasureHunt;
  },
): Release | undefined {
  if (pool.length === 0) return undefined;
  if (pool.length === 1) return pool[0];
  const needle = normaliseName(partial.name);
  const scored = pool
    .map((release) => {
      let score = 0;
      if (partial.year && release.year === partial.year) score += 2;
      if (seriesMatches(release.series, partial.series)) score += 2;
      if (partial.seriesNumber && release.seriesNumber === partial.seriesNumber) score += 1;
      if (needle && normaliseName(release.name) === needle) score += 2;
      // The same collector number covers the regular car, its Super Treasure
      // Hunt and colour variants; a hunt marker in the photo tells them apart.
      if (partial.treasureHunt && partial.treasureHunt !== "none") {
        score += release.treasureHunt === partial.treasureHunt ? 3 : -3;
      } else if (partial.treasureHunt === "none" && release.treasureHunt) {
        score -= 1;
      }
      return { release, score };
    })
    .sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  if (best.score === 0) return undefined;
  // A tie means we cannot tell colour variants or years apart: say nothing.
  if (second && second.score === best.score) return undefined;
  return best.release;
}

/** A full identification from a catalogue row, keeping what the photo added. */
export function identificationFromRelease(
  release: Release,
  base?: Partial<Identification>,
): Identification {
  return {
    name: release.name,
    series: release.series ?? base?.series ?? null,
    seriesNumber: release.seriesNumber ?? base?.seriesNumber ?? null,
    collectorNumber:
      release.collectorNumber ? `${Number(release.collectorNumber)}` : (base?.collectorNumber ?? null),
    year: release.year,
    toyNumber: release.toyNumber ?? base?.toyNumber ?? null,
    color: base?.color ?? null,
    treasureHunt: release.treasureHunt ?? base?.treasureHunt ?? "none",
    isHotWheels: true,
    confidence: 1,
    notes: [base?.notes, release.exclusive && `${release.exclusive} exclusive`]
      .filter(Boolean)
      .join(" · ") || null,
    catalogue: "toy",
  };
}

/**
 * Enrich what the identifier read with the catalogue row it points at. Fields
 * the catalogue knows win, because they are typed from the card by people
 * with the card in hand rather than read through blister glare.
 */
export async function enrichIdentification(
  identification: Identification,
): Promise<Identification> {
  let catalogue: Catalogue;
  try {
    catalogue = await loadCatalogue();
  } catch {
    return identification; // offline before the first load: no enrichment
  }
  const resolved = resolveIdentification(catalogue, identification);
  if (!resolved) return { ...identification, catalogue: null };
  const { release, by } = resolved;
  return {
    ...identification,
    name: release.name,
    series: release.series ?? identification.series,
    seriesNumber: release.seriesNumber ?? identification.seriesNumber,
    collectorNumber:
      release.collectorNumber ? `${Number(release.collectorNumber)}` : identification.collectorNumber,
    year: release.year,
    toyNumber: release.toyNumber ?? identification.toyNumber,
    // The catalogue knows which releases are hunts; the photo only knows if it saw the logo.
    treasureHunt: release.treasureHunt ?? identification.treasureHunt,
    isHotWheels: true,
    confidence: by === "toy" ? Math.max(identification.confidence, 0.95) : identification.confidence,
    notes:
      release.exclusive && !identification.notes?.includes(release.exclusive) ?
        [identification.notes, `${release.exclusive} exclusive`].filter(Boolean).join(" · ")
      : identification.notes,
    catalogue: by,
  };
}

/** One line for a pick list: "HW Dirt 7/10 · #223 · 2024 · HTB29". */
export function releaseSubtitle(release: Release): string {
  return [
    release.series && `${release.series}${release.seriesNumber ? ` ${release.seriesNumber}` : ""}`,
    release.collectorNumber && `#${Number(release.collectorNumber)}`,
    release.year,
    release.toyNumber,
    release.treasureHunt === "sth" ? "Super Treasure Hunt"
    : release.treasureHunt === "th" ? "Treasure Hunt"
    : undefined,
    release.exclusive && `${release.exclusive} exclusive`,
  ]
    .filter(Boolean)
    .join(" · ");
}
