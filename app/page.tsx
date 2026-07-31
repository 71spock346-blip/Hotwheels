"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import CarRow from "@/components/CarRow";
import { FlameMark } from "@/components/icons";
import { useCollection } from "@/lib/useCollection";
import { computeStats, searchCars } from "@/lib/stats";

type Filter = "all" | "dupes" | "hunts";

export default function CollectionPage() {
  const { cars, queue, loading } = useCollection();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const stats = useMemo(() => computeStats(cars), [cars]);

  const visible = useMemo(() => {
    let list = searchCars(cars, query);
    if (filter === "dupes") list = list.filter((car) => car.quantity > 1);
    if (filter === "hunts") list = list.filter((car) => car.treasureHunt !== "none");
    return list;
  }, [cars, query, filter]);

  const working = queue.filter((item) => item.status !== "failed").length;
  const failed = queue.filter(
    (item) => item.status === "failed" && item.attempts >= 3,
  ).length;

  return (
    <main className="shell">
      <header className="topbar">
        <div className="wordmark">
          <FlameMark className="flame" />
          Garage
        </div>
        <Link href="/scan" className="btn btn-primary">
          Scan
        </Link>
      </header>

      {working > 0 && (
        <div className="queue">
          <span className="spinner" aria-hidden="true" />
          Identifying {working} photo{working === 1 ? "" : "s"} in the background…
        </div>
      )}

      {failed > 0 && (
        <Link href="/stats" className="queue" style={{ display: "flex" }}>
          {failed} photo{failed === 1 ? "" : "s"} could not be identified. Tap to
          review.
        </Link>
      )}

      {cars.length > 0 && (
        <>
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
              <b>{stats.treasureHunts + stats.superTreasureHunts}</b>
              <span>Hunts</span>
            </div>
          </div>

          <input
            className="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, series, toy number…"
            type="search"
            autoComplete="off"
          />

          <div style={{ display: "flex", gap: 8, margin: "12px 0 14px" }}>
            {(
              [
                ["all", "All"],
                ["dupes", "Duplicates"],
                ["hunts", "Hunts"],
              ] as Array<[Filter, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`btn${filter === value ? " btn-primary" : " btn-ghost"}`}
                style={{ padding: "7px 13px", fontSize: 13.5 }}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}

      {loading ?
        <p className="muted small">Opening the garage…</p>
      : cars.length === 0 ?
        <div className="empty">
          <h2>Nothing logged yet</h2>
          <p>
            Point the camera at a card. If it has a barcode you have scanned before
            it lands instantly; otherwise a photo of the card is enough to identify
            it.
          </p>
          <Link href="/scan" className="btn btn-primary">
            Scan your first car
          </Link>
        </div>
      : visible.length === 0 ?
        <p className="muted small">Nothing matches that.</p>
      : <div className="cars">
          {visible.map((car) => (
            <CarRow key={car.id} car={car} />
          ))}
        </div>
      }
    </main>
  );
}
