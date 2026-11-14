"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import CarPhoto from "@/components/CarPhoto";
import CarRow from "@/components/CarRow";
import CarTile from "@/components/CarTile";
import { CameraIcon, FlameMark, GridIcon, ListIcon, ScanIcon } from "@/components/icons";
import { fitDisplay } from "@/lib/display";
import { useCollection } from "@/lib/useCollection";
import { useCollectionSafety } from "@/lib/safety";
import { computeStats, searchCars } from "@/lib/stats";

type Filter = "all" | "dupes" | "hunts" | "wishlist";
type View = "grid" | "list";

const VIEW_KEY = "garage:view";

function readView(): View {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

export default function CollectionPage() {
  const { cars, queue, loading } = useCollection();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<View>("grid");

  useEffect(() => {
    setView(readView());
    // Coming back from snapping wishes lands on the wishlist.
    if (new URLSearchParams(window.location.search).get("show") === "wishlist") {
      setFilter("wishlist");
    }
  }, []);

  const chooseView = (next: View) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* remembered for this visit only */
    }
  };

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

  const { reminder } = useCollectionSafety(cars);

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

      {reminder && (
        <p className="notice notice-bad" role="status">
          {reminder.lastAt ?
            `No backup in ${reminder.days} days, and cars have changed since.`
          : "This collection has never been backed up."}{" "}
          <Link href="/stats#your-data" style={{ color: "var(--signal-ink)", fontWeight: 700 }}>
            Back it up
          </Link>
        </p>
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

          <div className="search-row">
            <input
              className="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, series, toy number…"
              type="search"
              autoComplete="off"
            />
            <div className="view-switch" role="group" aria-label="Garage view">
              <button
                type="button"
                aria-pressed={view === "grid"}
                aria-label="Big pictures"
                onClick={() => chooseView("grid")}
              >
                <GridIcon />
              </button>
              <button
                type="button"
                aria-pressed={view === "list"}
                aria-label="List"
                onClick={() => chooseView("list")}
              >
                <ListIcon />
              </button>
            </div>
          </div>

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

          {filter === "wishlist" && (
            <div className="wish-cta">
              <Link href="/scan?for=wishlist" className="btn btn-primary btn-block">
                <CameraIcon />
                Snap a car you want
              </Link>
              <p>
                {wishlist.length ?
                  "Seen one in a shop or online? Photograph it and it joins the wishlist. Scan it later when you buy it and it moves into the garage."
                : "Nothing on the wishlist yet. Seen one in a shop or online? Photograph it and it lands here."}
              </p>
            </div>
          )}
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
          <Link href="/scan?for=wishlist" className="btn btn-ghost" style={{ marginTop: 8 }}>
            <CameraIcon />
            Snap one you want
          </Link>
        </div>
      : visible.length === 0 ?
        filter === "wishlist" && !query ? null : <p className="muted small">Nothing matches that.</p>
      : view === "grid" ?
        <div className="tiles">
          {visible.map((car) => (
            <CarTile key={car.id} car={car} />
          ))}
        </div>
      : <div className="cars">
          {visible.map((car) => (
            <CarRow key={car.id} car={car} />
          ))}
        </div>
      }
    </main>
  );
}
