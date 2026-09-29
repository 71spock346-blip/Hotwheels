import type { Car } from "./types";

/**
 * Series completion, computed entirely from the collection itself.
 *
 * Every mainline card prints its position in the series ("3/10"), and the
 * scanner already captures it — so the app can know you own 7 of 10 Muscle
 * Mania without any external catalogue. The denominator tells us how big the
 * series is; the numerators tell us which slots are filled.
 */

export interface SeriesProgress {
  key: string;
  name: string;
  year?: number;
  /** Series size, from the largest denominator seen on its cards. */
  total: number;
  ownedPositions: number[];
  missing: number[];
  /** Cars in this series whose position could not be read. */
  unplaced: number;
  complete: boolean;
}

const POSITION = /(\d+)\s*\/\s*(\d+)/;

export function parseSeriesNumber(
  value: string | undefined,
): { position: number; total: number } | null {
  if (!value) return null;
  const match = POSITION.exec(value);
  if (!match) return null;
  const position = Number(match[1]);
  const total = Number(match[2]);
  if (!position || !total || position > total) return null;
  return { position, total };
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Series run per calendar year, so 2024 and 2025 Muscle Mania stay apart. */
function groupKey(car: Car): string {
  return `${normalise(car.series ?? "")}|${car.year ?? "?"}`;
}

const MAX_SANE_SERIES = 50;

export function computeSeriesProgress(cars: Car[]): SeriesProgress[] {
  const groups = new Map<
    string,
    { name: string; year?: number; total: number; positions: Set<number>; unplaced: number }
  >();

  for (const car of cars) {
    if (!car.series) continue;
    const key = groupKey(car);
    let group = groups.get(key);
    if (!group) {
      group = { name: car.series, year: car.year, total: 0, positions: new Set(), unplaced: 0 };
      groups.set(key, group);
    }
    const parsed = parseSeriesNumber(car.seriesNumber);
    if (parsed && parsed.total <= MAX_SANE_SERIES) {
      group.total = Math.max(group.total, parsed.total);
      group.positions.add(parsed.position);
    } else {
      group.unplaced += 1;
    }
  }

  const progress: SeriesProgress[] = [];
  for (const [key, group] of groups) {
    // Without a single readable "n/N" there is nothing to complete against.
    if (!group.total) continue;
    const ownedPositions = [...group.positions].sort((a, b) => a - b);
    const missing: number[] = [];
    for (let position = 1; position <= group.total; position += 1) {
      if (!group.positions.has(position)) missing.push(position);
    }
    progress.push({
      key,
      name: group.name,
      year: group.year,
      total: group.total,
      ownedPositions,
      missing,
      unplaced: group.unplaced,
      complete: missing.length === 0,
    });
  }

  // The chase order: nearly-done sets first, finished trophies at the end.
  return progress.sort((a, b) => {
    if (a.complete !== b.complete) return a.complete ? 1 : -1;
    const ratio =
      b.ownedPositions.length / b.total - a.ownedPositions.length / a.total;
    if (ratio !== 0) return ratio;
    return a.missing.length - b.missing.length;
  });
}
