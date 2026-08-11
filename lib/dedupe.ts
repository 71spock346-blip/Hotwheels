import type { Car, Identification } from "./types";

/**
 * A stable key for "is this the same car I already own?".
 *
 * The Mattel toy number identifies a specific casting *and* colourway, so it is
 * the strongest signal available. When it is missing (loose cars, worn cards)
 * we fall back to name + year + colour, which is weaker but usually right.
 */
/** The fields that decide whether two entries are the same car. */
export interface MatchFields {
  toyNumber?: string | null;
  name: string;
  year?: number | null;
  color?: string | null;
}

export function matchKey(car: MatchFields): string {
  if (car.toyNumber) return `toy:${normalise(car.toyNumber)}`;
  return `name:${normalise(car.name)}|${car.year ?? ""}|${normalise(car.color ?? "")}`;
}

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Find an existing car that this identification should fold into. */
export function findMatch(cars: Car[], candidate: MatchFields): Car | undefined {
  const key = matchKey(candidate);
  return cars.find((car) => matchKey(car) === key);
}

export function identificationToCar(
  id: string,
  identification: Identification,
  extras: { upc?: string; thumbnail?: string; source: Car["source"] },
): Car {
  const now = Date.now();
  return {
    id,
    name: identification.name.trim() || "Unidentified car",
    series: identification.series ?? undefined,
    seriesNumber: identification.seriesNumber ?? undefined,
    collectorNumber: identification.collectorNumber ?? undefined,
    year: identification.year ?? undefined,
    toyNumber: identification.toyNumber ?? undefined,
    color: identification.color ?? undefined,
    treasureHunt: identification.treasureHunt,
    condition: "carded",
    upc: extras.upc,
    quantity: 1,
    thumbnail: extras.thumbnail,
    notes: identification.notes ?? undefined,
    confidence: identification.confidence,
    source: extras.source,
    addedAt: now,
    updatedAt: now,
  };
}
