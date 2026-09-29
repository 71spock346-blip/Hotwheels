"use client";

import { useCallback, useEffect, useState } from "react";
import { COLLECTION_CHANGED, announceChange, changeDetail } from "@/lib/commit";
import {
  DRIVE_CHANGED,
  connectDrive,
  disconnectDrive,
  driveConfigured,
  driveState,
  hasValidToken,
  isDirty,
  markDirty,
  restoreFromDrive,
  backupToDrive,
  type DriveState,
} from "@/lib/drive";

export default function DriveBackup({
  onMessage,
  onRestored,
}: {
  onMessage: (message: string, tone: "good" | "bad") => void;
  onRestored?: () => Promise<void> | void;
}) {
  const [state, setState] = useState<DriveState>({ enabled: false });
  const [signedIn, setSignedIn] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => {
    const next = driveState();
    setState(next);
    setSignedIn(hasValidToken(next));
    setDirty(isDirty());
  }, []);

  useEffect(() => {
    refresh();
    // Marks dirty here too, so the status is right whichever listener runs first.
    const onChange = (event: Event) => {
      if (driveState().enabled && !changeDetail(event).backedUp) markDirty();
      refresh();
    };
    window.addEventListener(COLLECTION_CHANGED, onChange);
    window.addEventListener(DRIVE_CHANGED, refresh);
    // The token quietly expires with time, so re-read now and then regardless.
    const interval = setInterval(refresh, 30_000);
    return () => {
      window.removeEventListener(COLLECTION_CHANGED, onChange);
      window.removeEventListener(DRIVE_CHANGED, refresh);
      clearInterval(interval);
    };
  }, [refresh]);

  async function restore() {
    const result = await restoreFromDrive();
    // Only local-only cars leave the backup behind; a clean restore is in sync.
    announceChange({ backedUp: result.localOnly === 0 });
    await onRestored?.();
    return `Restored ${result.cars} cars from Google Drive`;
  }

  async function run(label: string, work: () => Promise<string>) {
    setBusy(label);
    try {
      onMessage(await work(), "good");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Something went wrong.", "bad");
    } finally {
      setBusy(null);
      refresh();
    }
  }

  if (!driveConfigured) {
    return (
      <>
        <h2 className="section-title">Google Drive backup</h2>
        <p className="muted small" style={{ marginTop: 0, lineHeight: 1.55 }}>
          Not set up on this deployment yet. It needs a Google OAuth client id —
          the README has the five-minute walkthrough.
        </p>
      </>
    );
  }

  const last =
    state.lastBackupAt ? new Date(state.lastBackupAt).toLocaleString() : "never";

  return (
    <>
      <h2 className="section-title">Google Drive backup</h2>
      <div className="card">
        {!state.enabled ?
          <>
            <p className="small" style={{ margin: 0, lineHeight: 1.55 }}>
              Keep a copy of the collection in <b>your own</b> Google Drive, in
              a hidden folder only this app can see. It updates itself after
              every change, and a new phone gets everything back with one tap.
            </p>
            <button
              type="button"
              className="btn btn-primary btn-block"
              style={{ marginTop: 12 }}
              disabled={busy !== null}
              onClick={() =>
                void run("connect", async () => {
                  const result = await connectDrive();
                  return `Backed up ${result.cars} cars to Google Drive`;
                })
              }
            >
              {busy === "connect" ? "Connecting…" : "Connect Google Drive"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-block"
              style={{ marginTop: 8 }}
              disabled={busy !== null}
              onClick={() => void run("restore", restore)}
            >
              {busy === "restore" ? "Restoring…" : "Restore from Google Drive"}
            </button>
          </>
        : <>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <b style={{ fontSize: 15 }}>
                {dirty ? "Changes waiting" : "Up to date"}
              </b>
              <span className="muted small">Last backup {last}</span>
            </div>

            {dirty && !signedIn && (
              <p className="notice notice-bad" style={{ marginBottom: 0 }}>
                Google sign-in has lapsed, so recent changes are not backed up
                yet. Tap <b>Back up now</b> to sign in and catch up.
              </p>
            )}
            {!dirty && (
              <p className="muted small" style={{ margin: "8px 0 0", lineHeight: 1.5 }}>
                {signedIn ?
                  "Signed in — changes back up automatically about twenty seconds after you stop scanning."
                : "Automatic backups resume the next time you sign in."}
              </p>
            )}

            <div className="sheet-actions" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy !== null}
                onClick={() =>
                  void run("backup", async () => {
                    const result = await backupToDrive(true);
                    return `Backed up ${result.cars} cars`;
                  })
                }
              >
                {busy === "backup" ? "Backing up…" : "Back up now"}
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy !== null}
                onClick={() => void run("restore", restore)}
              >
                {busy === "restore" ? "Restoring…" : "Restore"}
              </button>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-block"
              style={{ marginTop: 8 }}
              disabled={busy !== null}
              onClick={() => {
                disconnectDrive();
                refresh();
                onMessage("Google Drive backup turned off", "good");
              }}
            >
              Turn off
            </button>
          </>
        }
      </div>
    </>
  );
}
