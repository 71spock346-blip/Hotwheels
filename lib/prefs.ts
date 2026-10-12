"use client";

/** Small per-device preferences, kept in localStorage. */

const PREFER_OWN_KEY = "garage:prefer-own-photos";

/** True when the collector would rather see their own scans than catalogue photos. */
export function prefersOwnPhotos(): boolean {
  try {
    return window.localStorage.getItem(PREFER_OWN_KEY) === "1";
  } catch {
    return false;
  }
}

export function setPrefersOwnPhotos(value: boolean): void {
  try {
    if (value) window.localStorage.setItem(PREFER_OWN_KEY, "1");
    else window.localStorage.removeItem(PREFER_OWN_KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(PREFS_CHANGED));
}

export const PREFS_CHANGED = "prefs:changed";
