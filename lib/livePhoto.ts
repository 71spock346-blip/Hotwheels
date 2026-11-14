"use client";

import { useEffect, useState } from "react";
import { normaliseCollectorNumber, normaliseToyNumber } from "./catalogue";

/**
 * Asks /api/photo for the wiki picture of a car the shipped catalogue has no
 * picture of yet. Only the wiki's file path is remembered on the phone (a
 * short piece of text); the picture itself is loaded from the wiki each time,
 * like every catalogue photo.
 */

export interface LookupCar {
  name?: string;
  year?: number | null;
  toyNumber?: string | null;
  collectorNumber?: string | null;
}

const STORE_KEY = "photo-lookup:v1";
const FOUND_FOR_MS = 30 * 24 * 60 * 60 * 1000;
/** The wiki fills in new cars over days: ask again after this long. */
const MISSING_FOR_MS = 2 * 24 * 60 * 60 * 1000;
const MAX_IN_FLIGHT = 3;

type Entry = { p: string | null; at: number };

let store: Record<string, Entry> | null = null;
const inFlight = new Map<string, Promise<string | null>>();
/** Lookups that failed this session (offline, wiki down): don't retry until reload. */
const failed = new Set<string>();
let running = 0;
const waiting: Array<() => void> = [];

function readStore(): Record<string, Entry> {
  if (store) return store;
  if (typeof window === "undefined") return {};
  try {
    store = JSON.parse(window.localStorage.getItem(STORE_KEY) ?? "{}") as Record<string, Entry>;
  } catch {
    store = {};
  }
  return store;
}

function writeStore() {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(store ?? {}));
  } catch {
    /* full or blocked: lookups just happen again next time */
  }
}

export function lookupKey(car: LookupCar): string | null {
  if (!car.year) return null;
  const toy = normaliseToyNumber(car.toyNumber);
  const col = normaliseCollectorNumber(car.collectorNumber);
  const name = (car.name ?? "").trim();
  if (!toy && !col && !name) return null;
  return [car.year, toy, col, toy ? "" : name.toLowerCase()].join("|");
}

/** What the phone already knows, without asking: a path, null (none yet), or undefined (ask). */
function remembered(key: string): string | null | undefined {
  const entry = readStore()[key];
  if (!entry) return undefined;
  const age = Date.now() - entry.at;
  if (entry.p && age < FOUND_FOR_MS) return entry.p;
  if (!entry.p && age < MISSING_FOR_MS) return null;
  return undefined;
}

async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (running >= MAX_IN_FLIGHT) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await work();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

function ask(key: string, car: LookupCar): Promise<string | null> {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const params = new URLSearchParams({ year: String(car.year) });
  const toy = normaliseToyNumber(car.toyNumber);
  const col = normaliseCollectorNumber(car.collectorNumber);
  if (toy) params.set("toy", toy);
  if (col) params.set("col", col);
  if (car.name) params.set("name", car.name.trim());
  const promise = slot(async () => {
    const response = await fetch(`/api/photo?${params}`);
    if (!response.ok) throw new Error(String(response.status));
    const body = (await response.json()) as { photo?: string | null };
    return typeof body.photo === "string" && body.photo ? body.photo : null;
  })
    .then((photo) => {
      readStore()[key] = { p: photo, at: Date.now() };
      writeStore();
      return photo;
    })
    .catch(() => {
      failed.add(key);
      return null;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

/**
 * The wiki photo path for a car, looked up live. Pass `enabled: false` when
 * the catalogue already has a picture or the owner's own photo wins anyway.
 */
export function useLivePhoto(car: LookupCar, enabled: boolean): string | null {
  const key = enabled ? lookupKey(car) : null;
  const [photo, setPhoto] = useState<string | null>(null);

  useEffect(() => {
    if (!key) {
      setPhoto(null);
      return;
    }
    const known = remembered(key);
    if (known !== undefined) {
      setPhoto(known);
      return;
    }
    setPhoto(null);
    if (failed.has(key) || (typeof navigator !== "undefined" && navigator.onLine === false)) return;
    let cancelled = false;
    void ask(key, car).then((found) => {
      if (!cancelled) setPhoto(found);
    });
    return () => {
      cancelled = true;
    };
    // `car` is captured by key; its other fields only matter through it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return photo;
}
