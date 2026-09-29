"use client";

import { normaliseToyNumber } from "./catalogue";
import type { Car } from "./types";

/**
 * Client side of the shared barcode database (see app/api/upc/route.ts).
 * Everything here is best-effort: a lookup that fails offers nothing, a vote
 * that fails is simply dropped. The scan flow must never wait on it or break
 * because of it.
 */

export interface SharedCandidate {
  toyNumber: string;
  name: string;
  year?: number;
  /** How many collectors confirmed this barcode was on this car. */
  count: number;
}

const LOOKUP_TIMEOUT_MS = 4000;
const VOTED_KEY = "garage:upc-voted";

export async function sharedCandidates(upc: string): Promise<SharedCandidate[]> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(`/api/upc?upc=${encodeURIComponent(upc)}`, {
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { candidates?: SharedCandidate[] };
    return payload.candidates ?? [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function votedSet(): Set<string> {
  try {
    const raw = window.localStorage.getItem(VOTED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/**
 * Tell the shared database which car this barcode was on. Once per barcode
 * and car per install, so re-scanning your own duplicates does not stuff the
 * ballot. Only cars with a toy number are worth reporting — without one there
 * is nothing for the next collector's catalogue lookup to hang on.
 */
export function voteUpc(upc: string | undefined, car: Pick<Car, "toyNumber" | "name" | "year">): void {
  if (!upc || typeof window === "undefined") return;
  const toyNumber = normaliseToyNumber(car.toyNumber);
  if (!toyNumber || !car.name.trim()) return;

  const voted = votedSet();
  const ballot = `${upc}:${toyNumber}`;
  if (voted.has(ballot)) return;
  voted.add(ballot);
  try {
    window.localStorage.setItem(VOTED_KEY, JSON.stringify([...voted].slice(-2000)));
  } catch {
    /* ignore */
  }

  void fetch("/api/upc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ upc, toyNumber, name: car.name.trim(), year: car.year }),
    keepalive: true,
  }).catch(() => undefined);
}
