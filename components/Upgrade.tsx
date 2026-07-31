"use client";

import { useCallback, useEffect, useState } from "react";
import {
  billingAvailable,
  fetchEntitlement,
  purchasePro,
  restorePurchases,
  type EntitlementStatus,
} from "@/lib/billing";

/**
 * Free-tier meter and the Play purchase button.
 *
 * Renders nothing at all when metering is off, so a private deployment for one
 * person never sees a paywall it does not need.
 */
export default function Upgrade({
  onMessage,
}: {
  onMessage: (message: string, tone: "good" | "bad") => void;
}) {
  const [status, setStatus] = useState<EntitlementStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setStatus(await fetchEntitlement());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const buy = useCallback(async () => {
    if (!status?.productId) return;
    setBusy(true);
    const result = await purchasePro(status.productId);
    onMessage(result.message, result.ok ? "good" : "bad");
    if (result.ok) await refresh();
    setBusy(false);
  }, [status?.productId, onMessage, refresh]);

  const restore = useCallback(async () => {
    setBusy(true);
    const result = await restorePurchases();
    onMessage(result.message, result.ok ? "good" : "bad");
    if (result.ok) await refresh();
    setBusy(false);
  }, [onMessage, refresh]);

  if (!status || !status.metered) return null;

  if (status.pro) {
    return (
      <>
        <h2 className="section-title">Identifications</h2>
        <div className="card">
          <b style={{ fontSize: 15 }}>Unlimited — unlocked</b>
          <p className="muted small" style={{ margin: "6px 0 0", lineHeight: 1.5 }}>
            Thanks. Identify as many cars as you like.
          </p>
        </div>
      </>
    );
  }

  const remaining = status.remaining ?? 0;
  const used = Math.min(status.used, status.limit);
  const spent = status.limit ? (used / status.limit) * 100 : 0;

  return (
    <>
      <h2 className="section-title">Identifications</h2>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <b style={{ fontSize: 15 }}>
            {remaining} of {status.limit} left
          </b>
          <span className="muted small">{used} used</span>
        </div>
        <div className="bar-track" style={{ marginTop: 10 }}>
          <div
            className="bar-fill"
            style={{
              width: `${Math.min(100, spent)}%`,
              background: remaining === 0 ? "var(--danger)" : undefined,
            }}
          />
        </div>
        <p className="muted small" style={{ margin: "10px 0 0", lineHeight: 1.5 }}>
          {remaining === 0 ?
            "You have used every free identification. Barcodes you have already scanned still add cars instantly, and you can always type one in by hand."
          : "Reading a new card uses one. Barcodes you have scanned before, and cars you type in yourself, are always free."}
        </p>

        {status.purchasable && (
          <div className="sheet-actions" style={{ marginTop: 14 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void buy()}
            >
              {busy ? "Working…" : "Unlock unlimited"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => void restore()}
            >
              Restore purchase
            </button>
          </div>
        )}

        {status.purchasable && !billingAvailable() && (
          <p className="muted tiny" style={{ margin: "10px 0 0", lineHeight: 1.5 }}>
            Purchases are only available in the Play Store version of the app.
          </p>
        )}
      </div>
    </>
  );
}
