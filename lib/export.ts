"use client";

import type { Car } from "./types";

const CSV_COLUMNS = [
  "name",
  "series",
  "seriesNumber",
  "collectorNumber",
  "year",
  "toyNumber",
  "color",
  "treasureHunt",
  "condition",
  "quantity",
  "upc",
  "value",
  "estimateLowUsd",
  "estimateHighUsd",
  "notes",
  "addedAt",
] as const;

export function toCsv(cars: Car[]): string {
  const rows = [CSV_COLUMNS.join(",")];
  for (const car of cars) {
    rows.push(
      CSV_COLUMNS.map((column) => {
        const value =
          column === "addedAt" ? new Date(car.addedAt).toISOString()
          : column === "estimateLowUsd" ? car.estimate?.low
          : column === "estimateHighUsd" ? car.estimate?.high
          : car[column];
        return escapeCsv(value);
      }).join(","),
    );
  }
  return rows.join("\n");
}

function escapeCsv(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Full backup, thumbnails included, so it can restore the collection exactly. */
export function toBackupJson(cars: Car[]): string {
  return JSON.stringify({ version: 1, exportedAt: Date.now(), cars }, null, 2);
}

export function parseBackupJson(text: string): Car[] {
  const parsed: unknown = JSON.parse(text);
  const cars =
    Array.isArray(parsed) ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { cars?: unknown }).cars) ?
      (parsed as { cars: unknown[] }).cars
    : null;
  if (!cars) throw new Error("That file does not look like a collection backup.");

  return cars.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Entry ${index + 1} is not a car.`);
    }
    const car = entry as Partial<Car>;
    if (!car.name) throw new Error(`Entry ${index + 1} has no name.`);
    return {
      ...car,
      id: car.id ?? `${Date.now()}-${index}`,
      name: car.name,
      quantity: car.quantity ?? 1,
      treasureHunt: car.treasureHunt ?? "none",
      condition: car.condition ?? "carded",
      source: car.source ?? "manual",
      addedAt: car.addedAt ?? Date.now(),
      updatedAt: car.updatedAt ?? Date.now(),
    } as Car;
  });
}

export function download(filename: string, contents: string, mimeType: string): void {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
