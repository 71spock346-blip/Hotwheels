"use client";

import type { Car, Condition, TreasureHunt } from "@/lib/types";

export type CarDraft = Pick<
  Car,
  | "name"
  | "series"
  | "seriesNumber"
  | "collectorNumber"
  | "year"
  | "toyNumber"
  | "color"
  | "treasureHunt"
  | "condition"
  | "quantity"
  | "notes"
  | "upc"
>;

interface Props {
  draft: CarDraft;
  onChange: (draft: CarDraft) => void;
  /** Hide fields a collector rarely edits mid-scan. */
  compact?: boolean;
}

export default function CarFields({ draft, onChange, compact }: Props) {
  const set = <K extends keyof CarDraft>(key: K, value: CarDraft[K]) =>
    onChange({ ...draft, [key]: value });

  const text = (value: string) => (value.trim() ? value : undefined);

  return (
    <>
      <label className="field">
        <span>Casting name</span>
        <input
          value={draft.name}
          onChange={(event) => set("name", event.target.value)}
          placeholder="'67 Camaro"
          autoComplete="off"
        />
      </label>

      <div className="row">
        <label className="field">
          <span>Series</span>
          <input
            value={draft.series ?? ""}
            onChange={(event) => set("series", text(event.target.value))}
            placeholder="HW Muscle Mania"
            autoComplete="off"
          />
        </label>
        <label className="field">
          <span>In series</span>
          <input
            value={draft.seriesNumber ?? ""}
            onChange={(event) => set("seriesNumber", text(event.target.value))}
            placeholder="3/10"
            autoComplete="off"
          />
        </label>
      </div>

      <div className="row">
        <label className="field">
          <span>Collector no.</span>
          <input
            value={draft.collectorNumber ?? ""}
            onChange={(event) => set("collectorNumber", text(event.target.value))}
            placeholder="112/250"
            autoComplete="off"
          />
        </label>
        <label className="field">
          <span>Toy no.</span>
          <input
            value={draft.toyNumber ?? ""}
            onChange={(event) =>
              set("toyNumber", text(event.target.value.toUpperCase()))
            }
            placeholder="HTB29"
            autoComplete="off"
          />
        </label>
      </div>

      <div className="row">
        <label className="field">
          <span>Year</span>
          <input
            inputMode="numeric"
            value={draft.year ?? ""}
            onChange={(event) => {
              const value = event.target.value.replace(/\D/g, "").slice(0, 4);
              set("year", value ? Number(value) : undefined);
            }}
            placeholder="2024"
          />
        </label>
        <label className="field">
          <span>Colour</span>
          <input
            value={draft.color ?? ""}
            onChange={(event) => set("color", text(event.target.value))}
            placeholder="Metallic blue"
            autoComplete="off"
          />
        </label>
      </div>

      <div className="row">
        <label className="field">
          <span>Treasure hunt</span>
          <select
            value={draft.treasureHunt}
            onChange={(event) => set("treasureHunt", event.target.value as TreasureHunt)}
          >
            <option value="none">No</option>
            <option value="th">Treasure Hunt</option>
            <option value="sth">Super Treasure Hunt</option>
          </select>
        </label>
        <label className="field">
          <span>Quantity</span>
          <input
            inputMode="numeric"
            value={draft.quantity}
            onChange={(event) => {
              const value = event.target.value.replace(/\D/g, "");
              set("quantity", value ? Math.max(1, Number(value)) : 1);
            }}
          />
        </label>
      </div>

      <label className="field">
        <span>Barcode</span>
        <input
          inputMode="numeric"
          value={draft.upc ?? ""}
          onChange={(event) =>
            set("upc", text(event.target.value.replace(/[^0-9]/g, "")))
          }
          placeholder="Type it if it will not scan"
          autoComplete="off"
        />
      </label>

      {!compact && (
        <>
          <label className="field">
            <span>Condition</span>
            <select
              value={draft.condition}
              onChange={(event) => set("condition", event.target.value as Condition)}
            >
              <option value="carded">Carded / sealed</option>
              <option value="opened">Opened, card kept</option>
              <option value="loose">Loose</option>
              <option value="damaged">Damaged card</option>
            </select>
          </label>

          <label className="field">
            <span>Notes</span>
            <textarea
              rows={3}
              value={draft.notes ?? ""}
              onChange={(event) => set("notes", text(event.target.value))}
              placeholder="Error variant, trade bait, where you found it…"
            />
          </label>
        </>
      )}
    </>
  );
}

export function draftFromCar(car: Car): CarDraft {
  return {
    name: car.name,
    series: car.series,
    seriesNumber: car.seriesNumber,
    collectorNumber: car.collectorNumber,
    year: car.year,
    toyNumber: car.toyNumber,
    color: car.color,
    treasureHunt: car.treasureHunt,
    condition: car.condition,
    quantity: car.quantity,
    notes: car.notes,
    upc: car.upc,
  };
}

export const BLANK_DRAFT: CarDraft = {
  name: "",
  treasureHunt: "none",
  condition: "carded",
  quantity: 1,
};
