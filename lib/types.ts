export type TreasureHunt = "none" | "th" | "sth";

export type Condition = "carded" | "opened" | "loose" | "damaged";

export type CarSource = "photo" | "barcode" | "manual";

/** One casting/variant in the collection. Quantity tracks duplicates. */
export interface Car {
  id: string;
  /** Casting name as printed, e.g. "'67 Camaro" or "Twin Mill". */
  name: string;
  /** Series/segment, e.g. "HW Muscle Mania" or "Fast & Furious". */
  series?: string;
  /** Position within the series, e.g. "3/10". */
  seriesNumber?: string;
  /** Mainline collector number, e.g. "112/250". */
  collectorNumber?: string;
  /** Model year printed on the card. */
  year?: number;
  /**
   * Mattel toy/item number, e.g. "HTB29". This is the closest thing Hot Wheels
   * has to a unique key for a specific casting + colourway, so it drives dedupe.
   */
  toyNumber?: string;
  color?: string;
  treasureHunt: TreasureHunt;
  condition: Condition;
  /** Barcode as scanned. Often shared across a whole assortment — see README. */
  upc?: string;
  quantity: number;
  /** Small JPEG data URL kept for the collection grid. */
  thumbnail?: string;
  notes?: string;
  /** 0-1, how sure the identifier was. Absent for manual entries. */
  confidence?: number;
  /** Owner-set value per unit, in USD. Wins over the estimate everywhere. */
  value?: number;
  /** Rough market range per unit, in USD, from the estimator. */
  estimate?: { low: number; high: number; at: number };
  source: CarSource;
  addedAt: number;
  updatedAt: number;
}

/**
 * Remembered barcode -> car mapping. Lets a repeat scan of a barcode you have
 * seen before resolve instantly and for free, with no network call.
 */
export interface UpcLink {
  upc: string;
  carIds: string[];
  updatedAt: number;
}

/** A photo waiting to be identified. Survives reloads and offline periods. */
export interface QueueItem {
  id: string;
  imageDataUrl: string;
  upc?: string;
  status: "pending" | "working" | "failed";
  error?: string;
  attempts: number;
  createdAt: number;
}

/** Shape the /api/identify route returns. */
export interface Identification {
  name: string;
  series: string | null;
  seriesNumber: string | null;
  collectorNumber: string | null;
  year: number | null;
  toyNumber: string | null;
  color: string | null;
  treasureHunt: TreasureHunt;
  isHotWheels: boolean;
  confidence: number;
  notes: string | null;
}

export const EMPTY_IDENTIFICATION: Identification = {
  name: "",
  series: null,
  seriesNumber: null,
  collectorNumber: null,
  year: null,
  toyNumber: null,
  color: null,
  treasureHunt: "none",
  isHotWheels: false,
  confidence: 0,
  notes: null,
};
