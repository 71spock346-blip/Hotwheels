"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { FlameMark } from "@/components/icons";
import { Toast, useToast } from "@/components/Toast";
import Upgrade from "@/components/Upgrade";
import { announceChange } from "@/lib/commit";
import DriveBackup from "@/components/DriveBackup";
import { allUpcLinks, dequeue, updateQueueItem } from "@/lib/db";
import { download, mergeBackup, parseBackupJson, toBackupJson, toCsv } from "@/lib/export";
import { computeSeriesProgress } from "@/lib/series";
import { computeStats } from "@/lib/stats";
import { useCollection } from "@/lib/useCollection";
import {
  collectionValue,
  estimateMissing,
  formatUsd,
  type EstimateProgress,
} from "@/lib/value";

export default function StatsPage() {
  const { cars, queue, refresh } = useCollection();
  const { toast, show } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const owned = useMemo(() => cars.filter((car) => !car.wanted), [cars]);
  const stats = useMemo(() => computeStats(owned), [owned]);
  const value = useMemo(() => collectionValue(cars), [cars]);
  const seriesProgress = useMemo(() => computeSeriesProgress(owned), [owned]);
  const [estimating, setEstimating] = useState<EstimateProgress | null>(null);
  const stuck = queue.filter((item) => item.status === "failed" && item.attempts >= 3);

  const stamp = () => new Date().toISOString().slice(0, 10);

  async function onImport(file: File) {
    setImporting(true);
    try {
      const restored = await mergeBackup(parseBackupJson(await file.text()));
      announceChange();
      await refresh();
      show(`Restored ${restored.cars} car${restored.cars === 1 ? "" : "s"}`, "good");
    } catch (error) {
      show(error instanceof Error ? error.message : "Could not read that file.", "bad");
    } finally {
      setImporting(false);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="wordmark">
          <FlameMark className="flame" />
          Stats
        </div>
      </header>

      <div className="stats">
        <div className="stat">
          <b>{stats.totalCars}</b>
          <span>Cars</span>
        </div>
        <div className="stat">
          <b>{stats.uniqueCastings}</b>
          <span>Unique</span>
        </div>
        <div className="stat">
          <b>{stats.duplicates}</b>
          <span>Dupes</span>
        </div>
        <div className="stat is-gold">
          <b>{stats.superTreasureHunts}</b>
          <span>Super TH</span>
        </div>
      </div>

      {cars.length > 0 && (
        <>
          <h2 className="section-title">Collection value</h2>
          <div className="card" style={{ marginBottom: 14 }}>
            {value.low > 0 || value.high > 0 ?
              <b style={{ fontSize: 22 }}>
                {formatUsd(value.low)}
                {value.high > value.low && ` – ${formatUsd(value.high)}`}
              </b>
            : <b style={{ fontSize: 16 }}>Not estimated yet</b>}

            {value.unvalued > 0 && (
              <p className="muted small" style={{ margin: "8px 0 0", lineHeight: 1.5 }}>
                {value.unvalued} car{value.unvalued === 1 ? " has" : "s have"} no
                value yet.
              </p>
            )}

            <p className="muted tiny" style={{ margin: "8px 0 0", lineHeight: 1.5 }}>
              Ballpark from general market knowledge, not an appraisal — real
              prices swing with condition and variant. For anything that looks
              valuable, check recent eBay sold listings before selling. Your own
              value on a car always overrides the estimate.
            </p>

            <div className="sheet-actions" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={estimating !== null || value.unvalued === 0}
                onClick={async () => {
                  setEstimating({ done: 0, total: value.unvalued });
                  const result = await estimateMissing({
                    onProgress: setEstimating,
                  });
                  setEstimating(null);
                  await refresh();
                  if (result.error) show(result.error, "bad");
                  else if (result.estimated > 0)
                    show(`Estimated ${result.estimated} cars`, "good");
                  else show("Everything already has a value", "good");
                }}
              >
                {estimating ?
                  `Estimating ${estimating.done}/${estimating.total}…`
                : "Estimate missing values"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={estimating !== null || cars.length === 0}
                onClick={async () => {
                  setEstimating({ done: 0, total: cars.length });
                  const result = await estimateMissing({
                    force: true,
                    onProgress: setEstimating,
                  });
                  setEstimating(null);
                  await refresh();
                  if (result.error) show(result.error, "bad");
                  else show(`Re-estimated ${result.estimated} cars`, "good");
                }}
              >
                Re-estimate all
              </button>
            </div>
          </div>
        </>
      )}

      <Upgrade onMessage={show} />

      {seriesProgress.length > 0 && (
        <>
          <h2 className="section-title">Series completion</h2>
          <p className="muted small" style={{ marginTop: 0, lineHeight: 1.5 }}>
            Worked out from the &ldquo;3/10&rdquo; printed on each card — no
            catalogue needed. Nearly-finished series first.
          </p>
          {seriesProgress.map((series) => (
            <div key={series.key} className="card" style={{ marginBottom: 10 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                  alignItems: "baseline",
                }}
              >
                <b style={{ fontSize: 15 }}>
                  {series.name}
                  {series.year ? ` · ${series.year}` : ""}
                </b>
                <b style={{ color: series.complete ? "var(--green)" : "var(--ink)" }}>
                  {series.ownedPositions.length}/{series.total}
                  {series.complete && " ✓"}
                </b>
              </div>
              <div className="bar-track" style={{ marginTop: 8 }}>
                <div
                  className="bar-fill"
                  style={{
                    width: `${(series.ownedPositions.length / series.total) * 100}%`,
                    background: series.complete ? "var(--green)" : undefined,
                  }}
                />
              </div>
              {!series.complete && (
                <p className="muted small" style={{ margin: "8px 0 0", lineHeight: 1.5 }}>
                  Still hunting: {series.missing.map((n) => `${n}/${series.total}`).join(", ")}
                </p>
              )}
              {series.unplaced > 0 && (
                <p className="muted tiny" style={{ margin: "6px 0 0" }}>
                  Plus {series.unplaced} in this series without a readable
                  series number — fill it in on the car to place them.
                </p>
              )}
            </div>
          ))}
        </>
      )}

      {stats.byYear.length > 0 && (
        <>
          <h2 className="section-title">By year</h2>
          {stats.byYear.map((entry) => (
            <div key={entry.label} className="bar">
              <div>{entry.label}</div>
              <b>{entry.count}</b>
            </div>
          ))}
        </>
      )}

      {stuck.length > 0 && (
        <>
          <h2 className="section-title">Photos that failed to identify</h2>
          {stuck.map((item) => (
            <div key={item.id} className="card" style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.imageDataUrl}
                  alt=""
                  style={{
                    width: 56,
                    height: 56,
                    objectFit: "cover",
                    borderRadius: 9,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="small">{item.error ?? "Identification failed."}</div>
                </div>
              </div>
              <div className="sheet-actions" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    await updateQueueItem({ ...item, status: "pending", attempts: 0 });
                    await refresh();
                    show("Queued for another try", "good");
                  }}
                >
                  Retry
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={async () => {
                    await dequeue(item.id);
                    await refresh();
                  }}
                >
                  Discard
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      <DriveBackup onMessage={show} onRestored={refresh} />

      <h2 className="section-title">Your data</h2>
      <p className="muted small" style={{ marginTop: 0, lineHeight: 1.55 }}>
        The collection lives on this device, in this browser. It works offline and
        nothing is uploaded except the photos sent for identification. That also
        means clearing site data wipes it — keep a backup, on Drive or as a file.
      </p>

      <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
        <button
          type="button"
          className="btn btn-block"
          disabled={!cars.length}
          onClick={async () =>
            download(
              `hotwheels-backup-${stamp()}.json`,
              toBackupJson(cars, await allUpcLinks()),
              "application/json",
            )
          }
        >
          Download backup (JSON, with photos)
        </button>

        <button
          type="button"
          className="btn btn-block"
          disabled={!cars.length}
          onClick={() =>
            download(`hotwheels-${stamp()}.csv`, toCsv(cars), "text/csv;charset=utf-8")
          }
        >
          Export spreadsheet (CSV)
        </button>

        <button
          type="button"
          className="btn btn-block"
          disabled={importing}
          onClick={() => fileInput.current?.click()}
        >
          {importing ? "Restoring…" : "Restore from a backup"}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onImport(file);
            event.target.value = "";
          }}
        />
      </div>

      <p className="muted tiny" style={{ marginTop: 20, textAlign: "center", lineHeight: 1.6 }}>
        <Link href="/privacy" style={{ textDecoration: "underline" }}>
          Privacy policy
        </Link>
        <br />
        Release catalogue from the{" "}
        <a
          href="https://hotwheels.fandom.com/"
          target="_blank"
          rel="noreferrer"
          style={{ textDecoration: "underline" }}
        >
          Hot Wheels Wiki
        </a>{" "}
        (CC BY-SA). Not affiliated with Mattel.
      </p>

      <Toast toast={toast} />
    </main>
  );
}
