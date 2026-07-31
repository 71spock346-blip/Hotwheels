"use client";

import { useCallback, useEffect, useState } from "react";
import {
  billingAvailable,
  buyPack,
  fetchBalance,
  pricePacks,
  restorePurchases,
  type Balance,
  type PricedPack,
} from "@/lib/billing";

/**
 * Identification balance and the credit packs.
 *
 * Renders nothing when metering is off, so a private deployment for one person
 * never sees a paywall it does not need.
 */
export default function Upgrade({
  onMessage,
}: {
  onMessage: (message: string, tone: "good" | "bad") => void;
}) {
  const [balance, setBalance] = useState<Balance | null>(null);
  const [packs, setPacks] = useState<PricedPack[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await fetchBalance();
    setBalance(next);
    if (next?.packs?.length) setPacks(await pricePacks(next.packs));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const buy = useCallback(
    async (productId: string) => {
      setBusy(productId);
      const result = await buyPack(productId);
      onMessage(result.message, result.ok ? "good" : "bad");
      if (result.ok) await refresh();
      setBusy(null);
    },
    [onMessage, refresh],
  );

  const restore = useCallback(async () => {
    setBusy("restore");
    const result = await restorePurchases();
    onMessage(result.message, result.ok ? "good" : "bad");
    if (result.ok) await refresh();
    setBusy(null);
  }, [onMessage, refresh]);

  if (!balance || !balance.metered) return null;

  const remaining = balance.remaining ?? 0;
  const empty = remaining <= 0;
  const usingFree = balance.freeRemaining > 0;
  const meterMax = usingFree ? balance.freeLimit : balance.credits + 1;
  const meterValue = usingFree ? balance.freeRemaining : balance.credits;

  return (
    <>
      <h2 className="section-title">Identifications</h2>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <b style={{ fontSize: 15 }}>
            {remaining} left
          </b>
          <span className="muted small">
            {usingFree ?
              `${balance.freeRemaining} free of ${balance.freeLimit}`
            : `${balance.credits} bought`}
          </span>
        </div>

        <div className="bar-track" style={{ marginTop: 10 }}>
          <div
            className="bar-fill"
            style={{
              width: `${Math.min(100, meterMax ? (meterValue / meterMax) * 100 : 0)}%`,
              background: empty ? "var(--danger)" : undefined,
            }}
          />
        </div>

        <p className="muted small" style={{ margin: "10px 0 0", lineHeight: 1.5 }}>
          {empty ?
            "You have none left. Barcodes you have already scanned still add cars instantly, and you can always type one in by hand."
          : "Reading a new card uses one. Barcodes you have scanned before, and cars you type in yourself, are always free."}
        </p>

        {balance.purchasable && (
          <>
            <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
              {packs.map((pack) => (
                <button
                  key={pack.id}
                  type="button"
                  className={`btn btn-block${empty ? " btn-primary" : ""}`}
                  disabled={busy !== null}
                  onClick={() => void buy(pack.id)}
                  style={{ justifyContent: "space-between" }}
                >
                  <span>{busy === pack.id ? "Working…" : `${pack.credits} more`}</span>
                  <span>{pack.price ?? ""}</span>
                </button>
              ))}
            </div>

            <button
              type="button"
              className="btn btn-ghost btn-block"
              style={{ marginTop: 8 }}
              disabled={busy !== null}
              onClick={() => void restore()}
            >
              {busy === "restore" ? "Checking…" : "Restore a purchase"}
            </button>

            {!billingAvailable() && (
              <p className="muted tiny" style={{ margin: "10px 0 0", lineHeight: 1.5 }}>
                Purchases are only available in the Play Store version of the app.
              </p>
            )}
          </>
        )}
      </div>
    </>
  );
}
