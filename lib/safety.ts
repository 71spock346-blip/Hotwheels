"use client";

import { useCallback, useEffect, useState } from "react";
import { COLLECTION_CHANGED } from "./commit";
import { DRIVE_CHANGED, driveState } from "./drive";
import type { Car } from "./types";

/**
 * Keeping the collection from disappearing.
 *
 * The collection lives in this browser's IndexedDB. By default that storage is
 * "best effort": when the phone runs low on space, Android may clear it without
 * asking. Persistent storage tells the browser to keep it unless the owner
 * clears it themselves. Chrome decides silently (no prompt): it says yes for an
 * app added to the home screen or used often, so it is worth asking again later
 * if the first answer was no.
 *
 * Even kept storage dies with the phone, so this also tracks the last backup
 * (Drive or a downloaded file) and says when one is overdue.
 */

/** "kept": the browser promised to keep it. "at-risk": it may be cleared. */
export type StorageStatus = "kept" | "at-risk" | "unsupported";

/** Fired when the storage answer or the last file backup changes. */
export const SAFETY_CHANGED = "safety:changed";

const FILE_BACKUP_KEY = "garage:file-backup-at";

/** How long unbacked-up changes may sit before the app says something. */
export const BACKUP_REMIND_DAYS = 7;
const DAY_MS = 86_400_000;

function supported(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.storage?.persisted === "function";
}

export async function storageStatus(): Promise<StorageStatus> {
  if (!supported()) return "unsupported";
  try {
    return (await navigator.storage.persisted()) ? "kept" : "at-risk";
  } catch {
    return "unsupported";
  }
}

/** Ask the browser to keep the collection. Safe to call often. */
export async function requestPersistentStorage(): Promise<StorageStatus> {
  const current = await storageStatus();
  if (current !== "at-risk" || typeof navigator.storage.persist !== "function") return current;
  let next: StorageStatus = current;
  try {
    next = (await navigator.storage.persist()) ? "kept" : "at-risk";
  } catch {
    /* keep the old answer */
  }
  window.dispatchEvent(new Event(SAFETY_CHANGED));
  return next;
}

/** Remember that a backup file was just downloaded. */
export function markFileBackup(at = Date.now()): void {
  try {
    window.localStorage.setItem(FILE_BACKUP_KEY, String(at));
  } catch {
    /* private mode; the reminder just stays on */
  }
  window.dispatchEvent(new Event(SAFETY_CHANGED));
}

/** The newest backup of any kind, or undefined when there has never been one. */
export function lastBackupAt(): number | undefined {
  let file: number | undefined;
  try {
    const raw = window.localStorage.getItem(FILE_BACKUP_KEY);
    if (raw) file = Number(raw) || undefined;
  } catch {
    /* ignore */
  }
  const drive = driveState().lastBackupAt;
  if (file && drive) return Math.max(file, drive);
  return file ?? drive;
}

export interface BackupReminder {
  /** Undefined when there has never been a backup. */
  lastAt?: number;
  /** Whole days since the last backup, or since the first car went unbacked-up. */
  days: number;
}

/**
 * A reminder is due when cars have changed since the last backup and those
 * changes are more than a week old. Nothing new since the last backup means
 * nothing to nag about, however long ago it was.
 */
export function backupReminder(cars: Car[], now = Date.now()): BackupReminder | null {
  if (!cars.length) return null;
  const lastAt = lastBackupAt();
  const changedSince = cars.filter((car) => !lastAt || car.updatedAt > lastAt);
  if (!changedSince.length) return null;
  const since = lastAt ?? Math.min(...changedSince.map((car) => car.addedAt || car.updatedAt));
  const days = Math.floor((now - since) / DAY_MS);
  return days >= BACKUP_REMIND_DAYS ? { lastAt, days } : null;
}

/** Live view of storage status, last backup and the reminder, for screens. */
export function useCollectionSafety(cars: Car[]) {
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [lastAt, setLastAt] = useState<number | undefined>(undefined);
  const [reminder, setReminder] = useState<BackupReminder | null>(null);

  const recheck = useCallback(async () => {
    setLastAt(lastBackupAt());
    setReminder(backupReminder(cars));
    setStorage(await storageStatus());
  }, [cars]);

  useEffect(() => {
    void recheck();
    const onChange = () => void recheck();
    window.addEventListener(SAFETY_CHANGED, onChange);
    window.addEventListener(DRIVE_CHANGED, onChange);
    window.addEventListener(COLLECTION_CHANGED, onChange);
    return () => {
      window.removeEventListener(SAFETY_CHANGED, onChange);
      window.removeEventListener(DRIVE_CHANGED, onChange);
      window.removeEventListener(COLLECTION_CHANGED, onChange);
    };
  }, [recheck]);

  const askAgain = useCallback(async () => {
    const next = await requestPersistentStorage();
    setStorage(next);
    return next;
  }, []);

  return { storage, lastAt, reminder, askAgain };
}

/** "today", "yesterday", "5 days ago". */
export function daysAgo(at: number, now = Date.now()): string {
  const days = Math.floor((now - at) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}
