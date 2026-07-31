"use client";

import { allCars, linkUpc, newId, putCar } from "./db";
import { findMatch, identificationToCar } from "./dedupe";
import type { Car, Identification } from "./types";

export const COLLECTION_CHANGED = "collection:changed";

export function announceChange(): void {
  window.dispatchEvent(new CustomEvent(COLLECTION_CHANGED));
}

export interface CommitResult {
  car: Car;
  /** True when this folded into a car already in the collection. */
  wasDuplicate: boolean;
}

/**
 * Add an identified car to the collection, folding it into an existing entry
 * when it is the same casting. Duplicates are a feature here, not a problem —
 * collectors track them for trading.
 */
export async function commitIdentification(
  identification: Identification,
  extras: { upc?: string; thumbnail?: string; source: Car["source"] },
): Promise<CommitResult> {
  const cars = await allCars();
  const existing = findMatch(cars, identification);

  if (existing) {
    const merged: Car = {
      ...existing,
      quantity: existing.quantity + 1,
      // Backfill anything the earlier scan missed, without overwriting good data.
      series: existing.series ?? identification.series ?? undefined,
      seriesNumber: existing.seriesNumber ?? identification.seriesNumber ?? undefined,
      collectorNumber:
        existing.collectorNumber ?? identification.collectorNumber ?? undefined,
      year: existing.year ?? identification.year ?? undefined,
      toyNumber: existing.toyNumber ?? identification.toyNumber ?? undefined,
      color: existing.color ?? identification.color ?? undefined,
      thumbnail: existing.thumbnail ?? extras.thumbnail,
      upc: existing.upc ?? extras.upc,
    };
    await putCar(merged);
    if (extras.upc) await linkUpc(extras.upc, merged.id);
    announceChange();
    return { car: merged, wasDuplicate: true };
  }

  const car = identificationToCar(newId(), identification, extras);
  await putCar(car);
  if (extras.upc) await linkUpc(extras.upc, car.id);
  announceChange();
  return { car, wasDuplicate: false };
}

/** Bump the count on a car the barcode already resolved to. */
export async function addAnother(car: Car): Promise<Car> {
  const updated = { ...car, quantity: car.quantity + 1 };
  await putCar(updated);
  announceChange();
  return updated;
}

export async function identify(
  images: string[],
  upc?: string,
): Promise<Identification> {
  const response = await fetch("/api/identify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ images, upc }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(payload?.error ?? `Identification failed (${response.status}).`);
  }

  return (await response.json()) as Identification;
}
