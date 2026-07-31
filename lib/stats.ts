import type { Car } from "./types";

export interface Stats {
  totalCars: number;
  uniqueCastings: number;
  duplicates: number;
  treasureHunts: number;
  superTreasureHunts: number;
  topSeries: Array<{ label: string; count: number }>;
  byYear: Array<{ label: string; count: number }>;
}

export function computeStats(cars: Car[]): Stats {
  const totalCars = cars.reduce((sum, car) => sum + car.quantity, 0);
  const series = new Map<string, number>();
  const years = new Map<string, number>();

  for (const car of cars) {
    if (car.series) series.set(car.series, (series.get(car.series) ?? 0) + car.quantity);
    if (car.year) {
      const key = String(car.year);
      years.set(key, (years.get(key) ?? 0) + car.quantity);
    }
  }

  return {
    totalCars,
    uniqueCastings: cars.length,
    duplicates: cars.reduce((sum, car) => sum + Math.max(0, car.quantity - 1), 0),
    treasureHunts: cars.filter((car) => car.treasureHunt === "th").length,
    superTreasureHunts: cars.filter((car) => car.treasureHunt === "sth").length,
    topSeries: [...series.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6),
    byYear: [...years.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.label.localeCompare(a.label))
      .slice(0, 8),
  };
}

export function searchCars(cars: Car[], query: string): Car[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return cars;
  return cars.filter((car) =>
    [
      car.name,
      car.series,
      car.seriesNumber,
      car.collectorNumber,
      car.toyNumber,
      car.color,
      car.notes,
      car.year ? String(car.year) : undefined,
    ]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(needle)),
  );
}
