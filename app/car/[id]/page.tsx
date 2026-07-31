"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import CarFields, { draftFromCar, type CarDraft } from "@/components/CarFields";
import { Toast, useToast } from "@/components/Toast";
import { announceChange } from "@/lib/commit";
import { deleteCar, getCar, putCar } from "@/lib/db";
import type { Car } from "@/lib/types";

export default function CarPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast, show } = useToast();

  const [car, setCar] = useState<Car | null>(null);
  const [draft, setDraft] = useState<CarDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const found = await getCar(params.id);
      if (cancelled) return;
      setCar(found ?? null);
      setDraft(found ? draftFromCar(found) : null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  async function save() {
    if (!car || !draft) return;
    if (!draft.name.trim()) {
      show("Give it a name first.", "bad");
      return;
    }
    await putCar({ ...car, ...draft, name: draft.name.trim() });
    announceChange();
    show("Saved", "good");
  }

  async function remove() {
    if (!car) return;
    await deleteCar(car.id);
    announceChange();
    router.push("/");
  }

  if (loading) {
    return (
      <main className="shell">
        <p className="muted small" style={{ paddingTop: 24 }}>
          Loading…
        </p>
      </main>
    );
  }

  if (!car || !draft) {
    return (
      <main className="shell">
        <div className="empty" style={{ marginTop: 24 }}>
          <h2>Not in the garage</h2>
          <p>That car is no longer in your collection.</p>
          <Link href="/" className="btn btn-primary">
            Back to the garage
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <Link href="/" className="btn btn-ghost">
          ← Garage
        </Link>
        <button type="button" className="btn btn-primary" onClick={() => void save()}>
          Save
        </button>
      </header>

      {car.thumbnail && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={car.thumbnail}
          alt={car.name}
          style={{
            width: "100%",
            maxHeight: 260,
            objectFit: "contain",
            borderRadius: "var(--radius)",
            background: "var(--surface)",
            marginBottom: 16,
          }}
        />
      )}

      <CarFields draft={draft} onChange={setDraft} />

      <p className="muted tiny" style={{ marginTop: 4, lineHeight: 1.6 }}>
        Added {new Date(car.addedAt).toLocaleDateString()} via {sourceLabel(car.source)}
        {car.upc && ` · barcode ${car.upc}`}
        {car.confidence !== undefined &&
          ` · identified with ${Math.round(car.confidence * 100)}% confidence`}
      </p>

      <div style={{ marginTop: 22 }}>
        {confirmingDelete ?
          <div className="card">
            <p className="small" style={{ marginTop: 0 }}>
              Remove {car.name} from the collection? This cannot be undone.
            </p>
            <div className="sheet-actions" style={{ marginTop: 10 }}>
              <button type="button" className="btn btn-danger" onClick={() => void remove()}>
                Remove it
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setConfirmingDelete(false)}
              >
                Keep it
              </button>
            </div>
          </div>
        : <button
            type="button"
            className="btn btn-danger btn-block"
            onClick={() => setConfirmingDelete(true)}
          >
            Remove from collection
          </button>
        }
      </div>

      <Toast toast={toast} />
    </main>
  );
}

function sourceLabel(source: Car["source"]): string {
  if (source === "barcode") return "a barcode scan";
  if (source === "photo") return "a photo";
  return "manual entry";
}
