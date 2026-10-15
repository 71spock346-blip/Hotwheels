"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import CarPhoto from "@/components/CarPhoto";
import CarRow from "@/components/CarRow";
import { FlameMark, ScanIcon } from "@/components/icons";
import { fitDisplay } from "@/lib/display";
import { useCollection } from "@/lib/useCollection";
import { computeStats, searchCars } from "@/lib/stats";

type Filter = "all" | "dupes" | "hunts" | "wishlist";

export default function CollectionPage() {
  const { cars, queue, loading } = useCollection();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const owned = useMemo(() => cars.filter((car) => !car.wanted), [cars]);
  const wishlist = useMemo(() => cars.filter((car) => car.wanted), [cars]);
  const stats = useMemo(() => computeStats(owned), [owned]);
  // The car on the stage: the newest one that has something to look at.
  const latest = useMemo(
    () => owned.find((car) => car.thumbnail || car.toyNumber) ?? owned[0],
    [owned],
  );

  const visible = useMemo(() => {
    let list = searchCars(filter === "wishlist" ? wishlist : owned, query);
    if (filter === "dupes") list = list.filter((car) => car.quantity > 1);
    if (filter === "hunts") list = list.filter((car) => car.treasureHunt !== "none");
    return list;
  }, [owned, wishlist, query, filter]);

  const working = queue.filter((item) => item.status !== "failed").length;
  const failed = queue.filter(
    (item) => item.status === "failed" && item.attempts >= 3,
  ).length;

  return (
    <main className="shell">
      <header className="topbar">
        <div className="wordmark">
          <FlameMark className="flame" />
          Moneyhole
        </div>
        <span className="label">Garage</span>
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
          {latest && (
            <section className="stage stage-side" aria-label="Collection">
              <div className="stage-back">
                <span className="label">
                  {stats.totalCars === 1 ? "Car" : "Cars"} in the garage
                </span>
                <span
                  className="display"
                  style={{ fontSize: fitDisplay(stats.totalCars.toLocaleString(), 236) }}
                >
                  {stats.totalCars.toLocaleString()}
                </span>
              </div>
              <Link href={`/car/${latest.id}`} className="stage-subject">
                <CarPhoto car={latest} className="stage-photo" width={640} />
                <span className="label stage-caption">Latest · {latest.name}</span>
              </Link>
              <Link href="/scan" className="fab">
                <ScanIcon />
                Scan
              </Link>
            </section>
          )}

          <span className="label stage-facts">
            {stats.uniqueCastings} unique · {stats.duplicates} dupes ·{" "}
            {stats.treasureHunts + stats.superTreasureHunts}{" "}
            {stats.treasureHunts + stats.superTreasureHunts === 1 ? "hunt" : "hunts"}
          </span>

          <input
            className="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, series, toy number…"
            type="search"
            autoComplete="off"
          />

          <div className="chips">
            {(
              [
                ["all", "All"],
                ["dupes", "Duplicates"],
                ["hunts", "Hunts"],
                ["wishlist", wishlist.length ? `Wishlist (${wishlist.length})` : "Wishlist"],
              ] as Array<[Filter, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className="chip"
                aria-pressed={filter === value}
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
          <span className="display" aria-hidden="true">0</span>
          <span className="label" style={{ display: "block", margin: "10px 0 18px" }}>
            Cars in the garage
          </span>
          <p>
            Point the camera at a card. If it has a barcode you have scanned before
            it lands instantly; otherwise a photo of the card is enough to identify
            it.
          </p>
          <Link href="/scan" className="btn btn-primary">
            <ScanIcon />
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
