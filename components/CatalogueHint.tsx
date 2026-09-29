"use client";

import { useEffect, useState } from "react";
import type { CarDraft } from "@/components/CarFields";
import {
  loadCatalogue,
  releaseSubtitle,
  resolveIdentification,
  type Release,
} from "@/lib/catalogue";

/**
 * Watches a draft and, when its toy number or collector number points at a
 * catalogue release the draft does not yet match, offers to fill the rest in.
 * Typing "HTB29" and tapping once is the whole manual entry.
 */
export default function CatalogueHint({
  draft,
  onApply,
}: {
  draft: CarDraft;
  onApply: (draft: CarDraft) => void;
}) {
  const [release, setRelease] = useState<Release | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  const key = `${draft.toyNumber ?? ""}|${draft.collectorNumber ?? ""}|${draft.year ?? ""}|${draft.series ?? ""}`;

  useEffect(() => {
    let cancelled = false;
    if (!draft.toyNumber && !draft.collectorNumber) {
      setRelease(null);
      return;
    }
    void loadCatalogue()
      .then((catalogue) => {
        if (cancelled) return;
        const resolved = resolveIdentification(catalogue, {
          toyNumber: draft.toyNumber ?? null,
          collectorNumber: draft.collectorNumber ?? null,
          name: draft.name,
          year: draft.year ?? null,
          series: draft.series ?? null,
          seriesNumber: draft.seriesNumber ?? null,
          treasureHunt: draft.treasureHunt,
        });
        // Only a real toy/collector match is worth interrupting for.
        setRelease(resolved && resolved.by !== "name" ? resolved.release : null);
      })
      .catch(() => setRelease(null));
    return () => {
      cancelled = true;
    };
    // Re-run only when the identifying fields change, not every keystroke elsewhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!release || dismissed === key) return null;

  const filled = applyRelease(draft, release);
  const differs = (["name", "series", "seriesNumber", "collectorNumber", "year", "treasureHunt"] as const)
    .some((field) => String(filled[field] ?? "") !== String(draft[field] ?? ""));
  if (!differs) return null;

  return (
    <div className="notice notice-good" style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ minWidth: 0 }}>
          <div>
            Catalogue: <b>{release.name}</b>
          </div>
          <div className="small" style={{ opacity: 0.85 }}>
            {releaseSubtitle(release)}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onApply(filled)}
          >
            Fill in
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            aria-label="Dismiss"
            onClick={() => setDismissed(key)}
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

export function applyRelease(draft: CarDraft, release: Release): CarDraft {
  return {
    ...draft,
    name: release.name,
    series: release.series ?? draft.series,
    seriesNumber: release.seriesNumber ?? draft.seriesNumber,
    collectorNumber:
      release.collectorNumber ? `${Number(release.collectorNumber)}` : draft.collectorNumber,
    year: release.year,
    toyNumber: release.toyNumber ?? draft.toyNumber,
    treasureHunt: release.treasureHunt ?? draft.treasureHunt,
    notes:
      release.exclusive && !draft.notes?.includes(release.exclusive) ?
        [draft.notes, `${release.exclusive} exclusive`].filter(Boolean).join(" · ")
      : draft.notes,
  };
}
