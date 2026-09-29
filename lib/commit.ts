"use client";

import { allCars, linkUpc, newId, putCar } from "./db";
import { findMatch, identificationToCar } from "./dedupe";
import { installId } from "./install";
import type { Car, Identification } from "./types";

export const COLLECTION_CHANGED = "collection:changed";

export interface ChangeDetail {
  /** The change came *from* the backup, so there is nothing new to back up. */
  backedUp?: boolean;
}

export function announceChange(detail: ChangeDetail = {}): void {
  window.dispatchEvent(new CustomEvent<ChangeDetail>(COLLECTION_CHANGED, { detail }));
}

export function changeDetail(event: Event): ChangeDetail {
  return (event as CustomEvent<ChangeDetail>).detail ?? {};
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
      // A wishlist match becomes owned; an owned match becomes one more.
      wanted: false,
      addedAt: existing.wanted ? Date.now() : existing.addedAt,
      quantity: existing.wanted ? Math.max(1, existing.quantity) : existing.quantity + 1,
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

export interface TakeResult {
  car: Car;
  /** True when this scan crossed a car off the wishlist. */
  fromWishlist: boolean;
}

/**
 * The scan resolved to a car we know. Owned: one more of it. On the wishlist:
 * the hunt is over — it becomes owned, which is the whole point of scanning a
 * peg in a store.
 */
export async function addAnother(car: Car): Promise<TakeResult> {
  const updated: Car =
    car.wanted ?
      { ...car, wanted: false, quantity: Math.max(1, car.quantity), addedAt: Date.now() }
    : { ...car, quantity: car.quantity + 1 };
  await putCar(updated);
  announceChange();
  return { car: updated, fromWishlist: Boolean(car.wanted) };
}

export async function identify(
  images: string[],
  upc?: string,
): Promise<Identification> {
  const response = await fetch("/api/identify", {
    method: "POST",
    headers: { "content-type": "application/json", "x-install-id": installId() },
    body: JSON.stringify({ images, upc }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      code?: string;
    } | null;
    const error = new Error(
      payload?.error ?? `Identification failed (${response.status}).`,
    ) as Error & { code?: string };
    error.code = payload?.code;
    throw error;
  }

  return (await response.json()) as Identification;
}
