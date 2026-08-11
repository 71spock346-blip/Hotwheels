"use client";

import { announceChange } from "./commit";
import { allCars, putCar } from "./db";
import { installId } from "./install";
import type { Car } from "./types";

const BATCH = 25;

export interface ValueTotals {
  low: number;
  high: number;
  /** Cars (rows, not quantity) with neither an estimate nor an owner value. */
  unvalued: number;
}

/** Per-unit value used in totals: the owner's number wins over the estimate. */
export function carValueRange(car: Car): { low: number; high: number } | null {
  if (car.value !== undefined) return { low: car.value, high: car.value };
  if (car.estimate) return { low: car.estimate.low, high: car.estimate.high };
  return null;
}

export function collectionValue(cars: Car[]): ValueTotals {
  let low = 0;
  let high = 0;
  let unvalued = 0;
  for (const car of cars) {
    const range = carValueRange(car);
    if (!range) {
      unvalued += 1;
      continue;
    }
    low += range.low * car.quantity;
    high += range.high * car.quantity;
  }
  return { low, high, unvalued };
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}

export interface EstimateProgress {
  done: number;
  total: number;
}

/**
 * Fetch estimates for every car that has none (or all of them, with `force`),
 * in batches. Each batch is one API call — and one identification credit when
 * metering is on — so a 100-car collection costs four calls, not a hundred.
 */
export async function estimateMissing(
  options: { force?: boolean; onProgress?: (progress: EstimateProgress) => void } = {},
): Promise<{ estimated: number; error?: string }> {
  const cars = await allCars();
  const targets = cars.filter(
    (car) => (options.force || !car.estimate) && car.value === undefined,
  );
  if (!targets.length) return { estimated: 0 };

  let estimated = 0;
  for (let start = 0; start < targets.length; start += BATCH) {
    const batch = targets.slice(start, start + BATCH);
    options.onProgress?.({ done: start, total: targets.length });

    const response = await fetch("/api/estimate", {
      method: "POST",
      headers: { "content-type": "application/json", "x-install-id": installId() },
      body: JSON.stringify({
        cars: batch.map((car) => ({
          id: car.id,
          name: car.name,
          series: car.series,
          seriesNumber: car.seriesNumber,
          year: car.year,
          toyNumber: car.toyNumber,
          color: car.color,
          treasureHunt: car.treasureHunt,
          condition: car.condition,
        })),
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      // Partial progress is still progress — report what stopped it.
      return {
        estimated,
        error: payload?.error ?? `Estimation failed (${response.status}).`,
      };
    }

    const { items } = (await response.json()) as {
      items: Array<{ id: string; low: number; high: number }>;
    };
    const byId = new Map(batch.map((car) => [car.id, car]));
    const now = Date.now();
    for (const item of items) {
      const car = byId.get(item.id);
      if (!car) continue;
      await putCar({ ...car, estimate: { low: item.low, high: item.high, at: now } });
      estimated += 1;
    }
    announceChange();
  }

  options.onProgress?.({ done: targets.length, total: targets.length });
  return { estimated };
}
