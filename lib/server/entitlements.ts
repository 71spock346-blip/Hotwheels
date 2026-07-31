import "server-only";
import { claim, decrement, getNumber, increment, storeConfigured } from "./store";

/**
 * Metering: a small free allowance, then credits bought in packs.
 *
 * Credits rather than an unlimited unlock because identification has a real
 * per-use cost. A one-off "unlimited" sold against a per-scan cost is an
 * unbounded liability — one collector logging a large backlog can cost more
 * than twenty buyers pay. Credits keep revenue and cost moving together.
 *
 * The free tier is keyed on a per-install id, so clearing app data earns a
 * fresh allowance. Closing that means user accounts, which is a lot of product
 * for a collection app to carry; this stops incidental cost, which is the risk
 * that actually exists.
 */

/** Free identifications per install before any purchase. */
export const FREE_SCAN_LIMIT = Number(process.env.FREE_SCAN_LIMIT ?? "10");

/** Metering only applies once there is somewhere durable to count. */
export const meteringEnabled = storeConfigured;

export interface CreditPack {
  id: string;
  credits: number;
}

/**
 * Play in-app product ids mapped to what they grant. Server-side so a client
 * cannot ask for a pack size that was never sold.
 */
export const CREDIT_PACKS: CreditPack[] = parsePacks(process.env.PLAY_CREDIT_PACKS);

function parsePacks(raw: string | undefined): CreditPack[] {
  const fallback: CreditPack[] = [
    { id: "identifications_250", credits: 250 },
    { id: "identifications_1000", credits: 1000 },
  ];
  if (!raw) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    const packs = parsed
      .map((entry) => entry as Partial<CreditPack>)
      .filter(
        (entry): entry is CreditPack =>
          typeof entry.id === "string" &&
          entry.id.length > 0 &&
          typeof entry.credits === "number" &&
          Number.isFinite(entry.credits) &&
          entry.credits > 0,
      );
    return packs.length ? packs : fallback;
  } catch {
    return fallback;
  }
}

export function packFor(productId: string): CreditPack | undefined {
  return CREDIT_PACKS.find((pack) => pack.id === productId);
}

export interface Balance {
  /** Free identifications already spent, capped at the limit for display. */
  freeUsed: number;
  freeLimit: number;
  freeRemaining: number;
  credits: number;
  /** Everything available right now, free plus purchased. */
  remaining: number;
  metered: boolean;
}

const freeKey = (installId: string) => `free:${installId}`;
const creditKey = (installId: string) => `credits:${installId}`;
const tokenKey = (token: string) => `redeemed:${token}`;

/** Accept only our own generated ids, so a key cannot be crafted. */
export function validInstallId(value: string | null): value is string {
  return typeof value === "string" && /^[0-9a-f-]{16,64}$/i.test(value);
}

export async function readBalance(installId: string): Promise<Balance> {
  if (!meteringEnabled) {
    return {
      freeUsed: 0,
      freeLimit: 0,
      freeRemaining: 0,
      credits: 0,
      remaining: Number.POSITIVE_INFINITY,
      metered: false,
    };
  }
  const [freeUsed, credits] = await Promise.all([
    getNumber(freeKey(installId)),
    getNumber(creditKey(installId)),
  ]);
  const freeRemaining = Math.max(0, FREE_SCAN_LIMIT - freeUsed);
  return {
    freeUsed: Math.min(freeUsed, FREE_SCAN_LIMIT),
    freeLimit: FREE_SCAN_LIMIT,
    freeRemaining,
    credits: Math.max(0, credits),
    remaining: freeRemaining + Math.max(0, credits),
    metered: true,
  };
}

/**
 * Spend one identification, free allowance first. Called only after a usable
 * answer comes back, so a failure never costs the user anything.
 */
export async function spendScan(installId: string): Promise<void> {
  if (!meteringEnabled) return;
  const freeUsed = await getNumber(freeKey(installId));
  if (freeUsed < FREE_SCAN_LIMIT) {
    await increment(freeKey(installId));
    return;
  }
  await decrement(creditKey(installId));
}

export interface GrantResult {
  granted: number;
  credits: number;
  alreadyRedeemed: boolean;
}

/**
 * Add a pack's credits, exactly once per purchase token. The token claim is
 * atomic, so a replayed or retried request cannot grant twice.
 */
export async function grantCredits(
  installId: string,
  pack: CreditPack,
  purchaseToken: string,
): Promise<GrantResult> {
  const first = await claim(tokenKey(purchaseToken), installId);
  if (!first) {
    return {
      granted: 0,
      credits: await getNumber(creditKey(installId)),
      alreadyRedeemed: true,
    };
  }
  const credits = await increment(creditKey(installId), pack.credits);
  return { granted: pack.credits, credits, alreadyRedeemed: false };
}
