"use client";

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Car, QueueItem, UpcLink } from "./types";

interface CollectionDB extends DBSchema {
  cars: {
    key: string;
    value: Car;
    indexes: { byToyNumber: string; byName: string; byAddedAt: number };
  };
  upcs: { key: string; value: UpcLink };
  queue: { key: string; value: QueueItem; indexes: { byCreatedAt: number } };
}

let dbPromise: Promise<IDBPDatabase<CollectionDB>> | null = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB<CollectionDB>("hotwheels", 1, {
      upgrade(database) {
        const cars = database.createObjectStore("cars", { keyPath: "id" });
        cars.createIndex("byToyNumber", "toyNumber");
        cars.createIndex("byName", "name");
        cars.createIndex("byAddedAt", "addedAt");

        database.createObjectStore("upcs", { keyPath: "upc" });

        const queue = database.createObjectStore("queue", { keyPath: "id" });
        queue.createIndex("byCreatedAt", "createdAt");
      },
    });
  }
  return dbPromise;
}

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ---------------------------------------------------------------- cars --- */

export async function allCars(): Promise<Car[]> {
  const cars = await (await db()).getAll("cars");
  return cars.sort((a, b) => b.addedAt - a.addedAt);
}

export async function getCar(id: string): Promise<Car | undefined> {
  return (await db()).get("cars", id);
}

export async function putCar(car: Car): Promise<void> {
  await (await db()).put("cars", { ...car, updatedAt: Date.now() });
}

export async function deleteCar(id: string): Promise<void> {
  const database = await db();
  await database.delete("cars", id);
  // Drop the id from any barcode link that pointed at it.
  const links = await database.getAll("upcs");
  for (const link of links) {
    if (!link.carIds.includes(id)) continue;
    const carIds = link.carIds.filter((carId) => carId !== id);
    if (carIds.length) {
      await database.put("upcs", { ...link, carIds, updatedAt: Date.now() });
    } else {
      await database.delete("upcs", link.upc);
    }
  }
}

export async function replaceAllCars(cars: Car[]): Promise<void> {
  const database = await db();
  const tx = database.transaction("cars", "readwrite");
  await tx.store.clear();
  for (const car of cars) await tx.store.put(car);
  await tx.done;
}

/* ---------------------------------------------------------------- upcs --- */

export async function carsForUpc(upc: string): Promise<Car[]> {
  const database = await db();
  const link = await database.get("upcs", upc);
  if (!link) return [];
  const cars = await Promise.all(link.carIds.map((id) => database.get("cars", id)));
  return cars.filter((car): car is Car => Boolean(car));
}

export async function linkUpc(upc: string, carId: string): Promise<void> {
  const database = await db();
  const existing = await database.get("upcs", upc);
  const carIds = existing ? Array.from(new Set([...existing.carIds, carId])) : [carId];
  await database.put("upcs", { upc, carIds, updatedAt: Date.now() });
}

/* --------------------------------------------------------------- queue --- */

export async function enqueue(item: QueueItem): Promise<void> {
  await (await db()).put("queue", item);
}

export async function queueItems(): Promise<QueueItem[]> {
  const items = await (await db()).getAll("queue");
  return items.sort((a, b) => a.createdAt - b.createdAt);
}

export async function updateQueueItem(item: QueueItem): Promise<void> {
  await (await db()).put("queue", item);
}

export async function dequeue(id: string): Promise<void> {
  await (await db()).delete("queue", id);
}
