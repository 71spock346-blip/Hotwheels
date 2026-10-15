"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, FlameMark } from "@/components/icons";
import { Toast, useToast } from "@/components/Toast";
import CarPhoto from "@/components/CarPhoto";
import Upgrade from "@/components/Upgrade";
import { announceChange } from "@/lib/commit";
import DriveBackup from "@/components/DriveBackup";
import { allUpcLinks, dequeue, updateQueueItem } from "@/lib/db";
import { download, mergeBackup, parseBackupJson, toBackupJson, toCsv } from "@/lib/export";
import { computeSeriesProgress } from "@/lib/series";
import { computeStats } from "@/lib/stats";
import { fitDisplay, wholeUsd } from "@/lib/display";
import { prefersOwnPhotos, setPrefersOwnPhotos } from "@/lib/prefs";
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
  const [ownPhotos, setOwnPhotos] = useState(false);
  useEffect(() => setOwnPhotos(prefersOwnPhotos()), []);

  const owned = useMemo(() => cars.filter((car) => !car.wanted), [cars]);
  const stats = useMemo(() => computeStats(owned), [owned]);
  const value = useMemo(() => collectionValue(cars), [cars]);
  const seriesProgress = useMemo(() => computeSeriesProgress(owned), [owned]);
  const [estimating, setEstimating] = useState<EstimateProgress | null>(null);
  const stuck = queue.filter((item) => item.status === "failed" && item.attempts >= 3);

  const stamp = () => new Date().toISOString().slice(0, 10);

  async function runEstimate(force: boolean) {
    setEstimating({ done: 0, total: force ? cars.length : value.unvalued });
    const result = await estimateMissing({ force, onProgress: setEstimating });
    setEstimating(null);
    await refresh();
    if (result.error) show(result.error, "bad");
    else if (force) show(`Re-estimated ${result.estimated} cars`, "good");
    else if (result.estimated > 0) show(`Estimated ${result.estimated} cars`, "good");
    else show("Everything already has a value", "good");
  }

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

      {cars.length > 0 ?
        (() => {
          const valued = value.low > 0 || value.high > 0;
          const big = valued ? wholeUsd(value.low) : stats.totalCars.toLocaleString();
          const unitValue = (car: (typeof owned)[number]) => car.value ?? car.estimate?.high ?? 0;
          const top =
            [...owned].sort((a, b) => unitValue(b) - unitValue(a)).find((car) => unitValue(car) > 0) ??
            owned[0];
          return (
            <>
              <section className="stage stage-side" aria-label="Collection value">
                <div className="stage-back">
                  <span className="label">
                    {valued ?
                      value.high > value.low ?
                        `Collection value · up to ${wholeUsd(value.high)}`
                      : "Collection value"
                    : `${stats.totalCars === 1 ? "Car" : "Cars"} · value not estimated yet`}
                  </span>
                  <span className="display" style={{ fontSize: fitDisplay(big, 236) }}>
                    {big}
                  </span>
                </div>
                {top && (
                  <Link href={`/car/${top.id}`} className="stage-subject">
                    <CarPhoto car={top} className="stage-photo" width={640} />
                    <span className="label stage-caption">
                      {unitValue(top) > 0 ? "Most valuable" : "Latest"} · {top.name}
                    </span>
                  </Link>
                )}
                {value.unvalued > 0 && (
                  <button
                    type="button"
                    className="fab"
                    disabled={estimating !== null}
                    onClick={() => void runEstimate(false)}
                  >
                    {estimating ?
                      `Estimating ${estimating.done}/${estimating.total}…`
                    : valued ?
                      `Value ${value.unvalued} more`
                    : "Estimate value"}
                  </button>
                )}
              </section>

              <span className="label stage-facts">
                {stats.uniqueCastings} unique · {stats.duplicates} dupes ·{" "}
                {stats.superTreasureHunts} super TH
              </span>

              <p className="muted tiny" style={{ margin: "0 0 10px", lineHeight: 1.6 }}>
                Ballpark from general market knowledge, not an appraisal — real
                prices swing with condition and variant. Check recent eBay sold
                listings before selling anything that looks valuable. Your own
                value on a car always overrides the estimate.
              </p>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ paddingLeft: 0 }}
                disabled={estimating !== null}
                onClick={() => void runEstimate(true)}
              >
                Re-estimate every car
              </button>
            </>
          );
        })()
      : <div className="empty">
          <span className="display" aria-hidden="true">0</span>
          <span className="label" style={{ display: "block", marginTop: 10 }}>
            Cars to count yet
          </span>
        </div>
      }

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
                <b>
                  {series.name}
                  {series.year ? ` · ${series.year}` : ""}
                </b>
                <b style={{ color: series.complete ? "var(--green)" : "var(--ink)" }}>
                  {series.ownedPositions.length}/{series.total}
                  {series.complete && (
                    <CheckIcon style={{ width: 14, height: 14, verticalAlign: "-2px", marginLeft: 4 }} />
                  )}
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

      <h2 className="section-title">Photos</h2>
      <div className="card">
        <label className="switch">
          <input
            type="checkbox"
            checked={ownPhotos}
            onChange={(event) => {
              setOwnPhotos(event.target.checked);
              setPrefersOwnPhotos(event.target.checked);
            }}
          />
          <span>
            <b>Prefer my own scans</b>
            <span className="muted small">
              Off: cars matched to the catalogue show the Hot Wheels Wiki&rsquo;s
              photo of that exact release. A photo you take yourself on a
              car&rsquo;s page always shows either way.
            </span>
          </span>
        </label>
      </div>

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
              `moneyhole-backup-${stamp()}.json`,
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
            download(`moneyhole-${stamp()}.csv`, toCsv(cars), "text/csv;charset=utf-8")
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
