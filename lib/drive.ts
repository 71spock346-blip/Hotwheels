"use client";

import { allCars, allUpcLinks } from "./db";
import { mergeBackup, parseBackupJson, toBackupJson, type MergeResult } from "./export";

/**
 * Backup to the user's own Google Drive.
 *
 * The file lives in Drive's hidden per-app folder (appDataFolder): invisible
 * in their Drive view, impossible to collide with their files, and covered by
 * a non-sensitive scope, so no Google verification review is needed to ship.
 * The user signs in with Google in the browser; nothing about their account
 * ever touches our server — the token stays on the device and the upload goes
 * straight to Google.
 */

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
export const driveConfigured = Boolean(CLIENT_ID);

const SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const FILE_NAME = "garage-backup.json";
const STATE_KEY = "garage:drive";
const DIRTY_KEY = "garage:drive:dirty";
const GIS_SRC = "https://accounts.google.com/gsi/client";

export interface DriveState {
  enabled: boolean;
  lastBackupAt?: number;
  fileId?: string;
  token?: string;
  /** Google access tokens live about an hour. */
  tokenExpiresAt?: number;
  email?: string;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}

interface TokenClient {
  requestAccessToken(options?: { prompt?: string }): void;
  callback?: (response: TokenResponse) => void;
  error_callback?: (error: { type?: string; message?: string }) => void;
}

interface GoogleIdentity {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        callback: (response: TokenResponse) => void;
        error_callback?: (error: { type?: string; message?: string }) => void;
      }): TokenClient;
      revoke(token: string, done?: () => void): void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

/* --------------------------------------------------------------- state --- */

/** Fired whenever backup state or the dirty flag changes, for the status UI. */
export const DRIVE_CHANGED = "drive:changed";

function announceDrive(): void {
  window.dispatchEvent(new Event(DRIVE_CHANGED));
}

export function driveState(): DriveState {
  if (typeof window === "undefined") return { enabled: false };
  try {
    const raw = window.localStorage.getItem(STATE_KEY);
    return raw ? (JSON.parse(raw) as DriveState) : { enabled: false };
  } catch {
    return { enabled: false };
  }
}

function saveState(patch: Partial<DriveState>): DriveState {
  const next = { ...driveState(), ...patch };
  try {
    window.localStorage.setItem(STATE_KEY, JSON.stringify(next));
  } catch {
    // Private mode can refuse storage; the session still works, just unsaved.
  }
  announceDrive();
  return next;
}

export function hasValidToken(state = driveState()): boolean {
  return Boolean(
    state.token && state.tokenExpiresAt && state.tokenExpiresAt - Date.now() > 60_000,
  );
}

export function markDirty(): void {
  try {
    window.localStorage.setItem(DIRTY_KEY, "1");
  } catch {
    /* ignore */
  }
  announceDrive();
}

export function isDirty(): boolean {
  try {
    return window.localStorage.getItem(DIRTY_KEY) === "1";
  } catch {
    return false;
  }
}

function clearDirty(): void {
  try {
    window.localStorage.removeItem(DIRTY_KEY);
  } catch {
    /* ignore */
  }
  announceDrive();
}

/* --------------------------------------------------------------- auth --- */

let gisLoading: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisLoading) {
    gisLoading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = GIS_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        gisLoading = null;
        reject(new Error("Could not load Google sign-in. Check your connection."));
      };
      document.head.appendChild(script);
    });
  }
  return gisLoading;
}

export class NeedsSignIn extends Error {
  constructor() {
    super("Sign in to Google to continue backups.");
    this.name = "NeedsSignIn";
  }
}

/**
 * An access token: the cached one while it is fresh, otherwise a Google
 * sign-in — which only makes sense from a tap, so callers say whether one
 * happened. Background work gets NeedsSignIn instead of a surprise popup.
 */
async function getToken(interactive: boolean): Promise<string> {
  const state = driveState();
  if (hasValidToken(state)) return state.token as string;
  if (!interactive) throw new NeedsSignIn();
  if (!CLIENT_ID) throw new Error("Google Drive backup is not configured on this deployment.");

  await loadGis();
  const google = window.google;
  if (!google) throw new Error("Google sign-in did not initialise.");

  return new Promise<string>((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error ?? "Google did not return a token."));
          return;
        }
        saveState({
          token: response.access_token,
          tokenExpiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
        });
        resolve(response.access_token);
      },
      error_callback: (error) => {
        reject(
          new Error(
            error?.type === "popup_closed" ?
              "Sign-in was closed before finishing."
            : (error?.message ?? "Google sign-in failed."),
          ),
        );
      },
    });
    client.requestAccessToken();
  });
}

/* --------------------------------------------------------------- drive --- */

async function driveFetch(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` },
  });
  if (response.status === 401) {
    // Token revoked or expired early: forget it so the next call signs in.
    saveState({ token: undefined, tokenExpiresAt: undefined });
    throw new NeedsSignIn();
  }
  if (!response.ok) {
    throw new Error(`Google Drive replied ${response.status}.`);
  }
  return response;
}

async function findBackupFile(token: string): Promise<string | null> {
  const query = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
  const response = await driveFetch(
    token,
    `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${query}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`,
  );
  const payload = (await response.json()) as { files?: Array<{ id: string }> };
  return payload.files?.[0]?.id ?? null;
}

async function uploadBackup(token: string, body: string): Promise<string> {
  const state = driveState();
  const existing = state.fileId ?? (await findBackupFile(token));

  if (existing) {
    try {
      await driveFetch(
        token,
        `https://www.googleapis.com/upload/drive/v3/files/${existing}?uploadType=media`,
        { method: "PATCH", headers: { "content-type": "application/json" }, body },
      );
      return existing;
    } catch (error) {
      // A stale id (file deleted) falls through to creating a fresh one.
      if (error instanceof NeedsSignIn) throw error;
    }
  }

  const boundary = `garage-${Date.now()}`;
  const multipart =
    `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({ name: FILE_NAME, parents: ["appDataFolder"] }) +
    `\r\n--${boundary}\r\ncontent-type: application/json\r\n\r\n` +
    body +
    `\r\n--${boundary}--`;
  const response = await driveFetch(
    token,
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: { "content-type": `multipart/related; boundary=${boundary}` },
      body: multipart,
    },
  );
  const created = (await response.json()) as { id: string };
  return created.id;
}

/* ---------------------------------------------------------------- api --- */

export interface BackupResult {
  bytes: number;
  cars: number;
  at: number;
}

/** Upload the whole collection. `interactive` allows a sign-in popup. */
export async function backupToDrive(interactive: boolean): Promise<BackupResult> {
  const token = await getToken(interactive);
  const [cars, upcs] = await Promise.all([allCars(), allUpcLinks()]);
  const body = toBackupJson(cars, upcs);
  const fileId = await uploadBackup(token, body);
  const at = Date.now();
  saveState({ enabled: true, fileId, lastBackupAt: at });
  clearDirty();
  return { bytes: body.length, cars: cars.length, at };
}

export async function connectDrive(): Promise<BackupResult> {
  return backupToDrive(true);
}

/** Merge the Drive backup into this device — nothing here is deleted. */
export async function restoreFromDrive(): Promise<MergeResult> {
  const token = await getToken(true);
  const fileId = driveState().fileId ?? (await findBackupFile(token));
  if (!fileId) throw new Error("No backup found in your Google Drive yet.");
  const response = await driveFetch(
    token,
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
  );
  const restored = await mergeBackup(parseBackupJson(await response.text()));
  saveState({ enabled: true, fileId });
  return restored;
}

export function disconnectDrive(): void {
  const { token } = driveState();
  if (token && window.google?.accounts?.oauth2) {
    try {
      window.google.accounts.oauth2.revoke(token);
    } catch {
      /* best effort */
    }
  }
  saveState({
    enabled: false,
    token: undefined,
    tokenExpiresAt: undefined,
    fileId: undefined,
  });
  clearDirty();
}
