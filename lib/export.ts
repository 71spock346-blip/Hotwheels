"use client";

import type { Car, UpcLink } from "./types";

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
  "wanted",
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

export interface Backup {
  cars: Car[];
  /** Learned barcode links — without them a restore forgets every scan. */
  upcs: UpcLink[];
}

/** Full backup, thumbnails and barcode links included, so a restore is exact. */
export function toBackupJson(cars: Car[], upcs: UpcLink[] = []): string {
  return JSON.stringify({ version: 2, exportedAt: Date.now(), cars, upcs }, null, 2);
}

export function parseBackupJson(text: string): Backup {
  const parsed: unknown = JSON.parse(text);
  const cars =
    Array.isArray(parsed) ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { cars?: unknown }).cars) ?
      (parsed as { cars: unknown[] }).cars
    : null;
  if (!cars) throw new Error("That file does not look like a collection backup.");

  const rawUpcs =
    parsed && typeof parsed === "object" && Array.isArray((parsed as { upcs?: unknown }).upcs) ?
      ((parsed as { upcs: unknown[] }).upcs as Partial<UpcLink>[])
    : [];
  const upcs: UpcLink[] = rawUpcs
    .filter((link) => typeof link?.upc === "string" && Array.isArray(link.carIds))
    .map((link) => ({
      upc: link.upc as string,
      carIds: (link.carIds as unknown[]).filter((id): id is string => typeof id === "string"),
      updatedAt: typeof link.updatedAt === "number" ? link.updatedAt : Date.now(),
    }));

  const parsedCars = cars.map((entry, index) => {
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

  return { cars: parsedCars, upcs };
}

/**
 * Bring a backup into the collection without losing anything already here:
 * cars merge by id, barcode links union. Used by file restore and Drive.
 */
export async function mergeBackup(backup: Backup): Promise<MergeResult> {
  const { allCars, replaceAllCars, mergeUpcLinks } = await import("./db");
  const byId = new Map((await allCars()).map((car) => [car.id, car]));
  const backupIds = new Set(backup.cars.map((car) => car.id));
  const localOnly = [...byId.keys()].filter((id) => !backupIds.has(id)).length;
  for (const car of backup.cars) byId.set(car.id, car);
  await replaceAllCars([...byId.values()]);
  await mergeUpcLinks(backup.upcs);
  return { cars: backup.cars.length, localOnly };
}

export interface MergeResult {
  cars: number;
  /** Cars this device had that the backup did not — the backup is now behind. */
  localOnly: number;
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
