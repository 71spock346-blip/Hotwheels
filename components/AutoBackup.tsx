"use client";

import { useEffect, useRef } from "react";
import { COLLECTION_CHANGED, changeDetail } from "@/lib/commit";
import {
  backupToDrive,
  driveConfigured,
  driveState,
  hasValidToken,
  isDirty,
  markDirty,
} from "@/lib/drive";

/** Wait for a lull after the last change: a scanning session is many writes. */
const SETTLE_MS = 20_000;

/**
 * Keeps the Drive backup current without being asked.
 *
 * Runs only while a Google sign-in is still fresh — it never pops a sign-in
 * on its own, since a surprise popup mid-scan is worse than a stale backup.
 * When the sign-in has lapsed, changes are remembered as "dirty" so the app
 * can nudge for a tap, and the next backup covers everything at once.
 */
export default function AutoBackup() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef(false);

  useEffect(() => {
    if (!driveConfigured) return;

    async function flush() {
      if (running.current) return;
      const state = driveState();
      if (!state.enabled || !isDirty() || !hasValidToken(state)) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      running.current = true;
      try {
        await backupToDrive(false);
      } catch {
        // Stays dirty; the next change or sign-in retries it.
      } finally {
        running.current = false;
      }
    }

    const onChange = (event: Event) => {
      if (!driveState().enabled || changeDetail(event).backedUp) return;
      markDirty();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SETTLE_MS);
    };

    // Leaving the app is the moment a backup matters most.
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };

    window.addEventListener(COLLECTION_CHANGED, onChange);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("online", () => void flush());
    void flush(); // anything left over from last time

    return () => {
      window.removeEventListener(COLLECTION_CHANGED, onChange);
      document.removeEventListener("visibilitychange", onHide);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return null;
}
