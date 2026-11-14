"use client";

import {
  loadCatalogue,
  normaliseCollectorNumber,
  normaliseName,
  normaliseToyNumber,
  seriesMatches,
  type Catalogue,
  type Release,
} from "./catalogue";
import type { Identification } from "./types";

/**
 * The "which one is it?" list after a photo of a card's front.
 *
 * A front photo can't show the toy number (it is on the back), so a single
 * answer is often a guess between colour variants, years or premium lines the
 * catalogue does not hold. Instead every release that fits what was read is
 * scored, and the best few are offered with their pictures for the collector
 * to pick from. Signals, strongest first:
 *
 * - the casting name printed on the card, and the castings the identifier
 *   recognised from the car's shape (its "alternatives");
 * - the collector number ("112/250") or the set position ("2/5");
 * - the series name, the year and the body colour;
 * - the Treasure Hunt marker.
 *
 * The shipped catalogue is searched first (free, offline). When it has no
 * strong answer, or the card is a premium line it does not cover, the
 * casting's wiki page is read live through /api/versions, which also brings
 * the body colour of every release. Neither costs an identification.
 */

export interface Match {
  release: Release;
  score: number;
  /** Came from a live wiki casting page rather than the shipped catalogue. */
  live?: boolean;
}

export type Reading = Pick<
  Identification,
  "name" | "series" | "seriesNumber" | "collectorNumber" | "year" | "color" | "treasureHunt"
> &
  Partial<Pick<Identification, "alternatives" | "line" | "toyNumber">>;

export const MAX_MATCHES = 5;
/** Below this a release fits too little of what was read to be worth showing. */
const MIN_SCORE = 3.5;
/** A read this good (name, number and year all agree) needs no live lookup. */
const STRONG_SCORE = 10;

/* ------------------------------------------------------------- names --- */

function bigrams(value: string): string[] {
  const text = value.replace(/\s+/g, "");
  const out: string[] = [];
  for (let i = 0; i < text.length - 1; i++) out.push(text.slice(i, i + 2));
  return out;
}

/** 0..1: how alike two normalised casting names are, forgiving misreads. */
export function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = a.split(" ");
  const tb = b.split(" ");
  const shared = ta.filter((token) => tb.includes(token)).length;
  const tokens = shared / Math.max(ta.length, tb.length);
  const ba = bigrams(a);
  const bb = bigrams(b);
  if (!ba.length || !bb.length) return tokens;
  const pool = [...bb];
  let common = 0;
  for (const gram of ba) {
    const at = pool.indexOf(gram);
    if (at >= 0) {
      common++;
      pool.splice(at, 1);
    }
  }
  const dice = (2 * common) / (ba.length + bb.length);
  return Math.max(tokens, dice * 0.95);
}

function queries(read: Reading): Array<{ text: string; weight: number }> {
  const out: Array<{ text: string; weight: number }> = [];
  const add = (raw: string | undefined | null, weight: number) => {
    const text = raw ? normaliseName(raw) : "";
    if (text && !out.some((query) => query.text === text)) out.push({ text, weight });
  };
  add(read.name, 1);
  (read.alternatives ?? []).forEach((name, index) => add(name, [0.8, 0.65, 0.5][index] ?? 0.5));
  return out;
}

function nameScore(release: Release, read: Reading, normalised?: string): number {
  const name = normalised ?? normaliseName(release.name);
  let best = 0;
  for (const query of queries(read)) {
    best = Math.max(best, nameSimilarity(name, query.text) * query.weight);
  }
  return best;
}

/* ------------------------------------------------------------ colour --- */

const COLOURS = [
  "red", "orange", "yellow", "gold", "green", "teal", "aqua", "blue", "purple", "violet",
  "pink", "magenta", "white", "black", "grey", "gray", "silver", "brown", "tan", "beige",
  "bronze", "copper", "maroon", "turquoise", "lime", "olive", "navy", "cream",
];
const SAME: Record<string, string> = { gray: "grey", violet: "purple", aqua: "teal", turquoise: "teal", beige: "tan", cream: "white", navy: "blue", maroon: "red", lime: "green", olive: "green", magenta: "pink" };

function colourWords(text: string | null | undefined): Set<string> {
  const words = new Set<string>();
  for (const word of (text ?? "").toLowerCase().split(/[^a-z]+/)) {
    if (COLOURS.includes(word)) words.add(SAME[word] ?? word);
  }
  return words;
}

/* ------------------------------------------------------------- score --- */

function fraction(raw: string | null | undefined): string | null {
  const match = /(\d+)\s*\/\s*(\d+)/.exec(raw ?? "");
  return match ? `${Number(match[1])}/${Number(match[2])}` : null;
}

/** How well one release fits what was read off the card. */
export function scoreRelease(release: Release, read: Reading, normalisedName?: string): number {
  let score = 6 * nameScore(release, read, normalisedName);

  // A big denominator is the mainline collector number; a small one is the
  // position in a set ("2/5" on a premium card), which the catalogue keeps as
  // the series number.
  const readCollector = normaliseCollectorNumber(read.collectorNumber);
  const collectorFraction = fraction(read.collectorNumber);
  const isSetPosition = collectorFraction ? Number(collectorFraction.split("/")[1]) <= 30 : false;
  if (readCollector && !isSetPosition && release.collectorNumber === readCollector) score += 4;
  const setPosition = fraction(read.seriesNumber) ?? (isSetPosition ? collectorFraction : null);
  if (setPosition && release.seriesNumber && fraction(release.seriesNumber) === setPosition) {
    score += 1.5;
  }

  if (seriesMatches(release.series, read.series)) score += 2.5;

  if (read.year) {
    if (release.year === read.year) score += 2;
    else if (Math.abs(release.year - read.year) === 1) score += 0.5;
  }

  const want = colourWords(read.color);
  const have = colourWords(release.color);
  if (want.size && have.size) {
    const shared = [...want].some((colour) => have.has(colour));
    score += shared ? 1.5 : -0.5;
  }

  if (read.treasureHunt && read.treasureHunt !== "none") {
    score += release.treasureHunt === read.treasureHunt ? 2 : -1;
  } else if (release.treasureHunt) {
    score -= 1;
  }

  if (read.toyNumber && release.toyNumber && normaliseToyNumber(read.toyNumber) === release.toyNumber) {
    score += 8;
  }
  return score;
}

const normalisedNames = new WeakMap<Catalogue, string[]>();

function catalogueNames(catalogue: Catalogue): string[] {
  let names = normalisedNames.get(catalogue);
  if (!names) {
    names = catalogue.releases.map((release) => normaliseName(release.name));
    normalisedNames.set(catalogue, names);
  }
  return names;
}

/** Catalogue releases that fit the reading, best first. */
export function rankCatalogue(catalogue: Catalogue, read: Reading): Match[] {
  const names = catalogueNames(catalogue);
  const readCollector = normaliseCollectorNumber(read.collectorNumber);
  const out: Match[] = [];
  catalogue.releases.forEach((release, index) => {
    const nameFit = nameScore(release, read, names[index]);
    const numberFit = Boolean(readCollector) && release.collectorNumber === readCollector;
    const seriesFit =
      Boolean(read.year) && release.year === read.year && seriesMatches(release.series, read.series);
    if (nameFit < 0.5 && !numberFit && !seriesFit) return;
    out.push({ release, score: scoreRelease(release, read, names[index]) });
  });
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Combine catalogue and live wiki releases into one list. A wiki row with a
 * toy number the catalogue knows is the same release: the catalogue's row is
 * kept and gains the colour (and picture, if it had none).
 */
export function mergeMatches(fromCatalogue: Match[], live: Release[], read: Reading): Match[] {
  const byToy = new Map<string, Match>();
  const merged: Match[] = fromCatalogue.map((match) => ({ ...match }));
  for (const match of merged) {
    if (match.release.toyNumber) byToy.set(match.release.toyNumber, match);
  }
  for (const release of live) {
    const known = release.toyNumber ? byToy.get(release.toyNumber) : undefined;
    if (known) {
      known.release = {
        ...known.release,
        color: known.release.color ?? release.color,
        photo: known.release.photo ?? release.photo,
      };
      known.score = scoreRelease(known.release, read);
      continue;
    }
    const match: Match = { release, score: scoreRelease(release, read), live: true };
    merged.push(match);
    if (release.toyNumber) byToy.set(release.toyNumber, match);
  }
  return merged.sort((a, b) => b.score - a.score);
}

/** The few worth showing: good enough, and not far behind the best. */
export function shortlist(matches: Match[], limit = MAX_MATCHES): Match[] {
  const best = matches[0]?.score ?? 0;
  return matches
    .filter((match) => match.score >= MIN_SCORE && match.score >= best - 9)
    .slice(0, limit);
}

/* -------------------------------------------------------------- live --- */

interface LiveVersion {
  name: string;
  year: number;
  series?: string;
  seriesNumber?: string;
  collectorNumber?: string;
  toyNumber?: string;
  color?: string;
  photo?: string;
}

async function liveVersions(read: Reading): Promise<Release[]> {
  // The spelling as read matches wiki page titles better than a normalised one.
  const names = [read.name, ...(read.alternatives ?? [])]
    .map((name) => name?.trim())
    .filter((name): name is string => Boolean(name))
    .slice(0, 3);
  if (!names.length) return [];
  const params = new URLSearchParams();
  for (const name of names) params.append("name", name);
  try {
    const response = await fetch(`/api/versions?${params}`, { signal: AbortSignal.timeout(9000) });
    if (!response.ok) return [];
    const json = (await response.json()) as { versions?: LiveVersion[] };
    return (json.versions ?? []).map((version) => ({ ...version }));
  } catch {
    return []; // offline or the wiki is down: the catalogue's answer stands
  }
}

/**
 * The shortlist for a reading. Uses the catalogue alone when it is sure;
 * otherwise also asks the wiki for every release of the castings named.
 */
export async function findMatches(read: Reading): Promise<Match[]> {
  if (!read.name && !read.alternatives?.length && !read.collectorNumber) return [];
  let catalogue: Catalogue | null = null;
  try {
    catalogue = await loadCatalogue();
  } catch {
    catalogue = null;
  }
  const fromCatalogue = catalogue ? rankCatalogue(catalogue, read) : [];
  const best = fromCatalogue[0]?.score ?? 0;
  const needLive = read.line !== "mainline" || best < STRONG_SCORE;
  if (!needLive || (!read.name && !read.alternatives?.length)) return shortlist(fromCatalogue);
  const live = await liveVersions(read);
  return shortlist(mergeMatches(fromCatalogue.slice(0, 40), live, read));
}
