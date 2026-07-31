import "server-only";
import { get, increment, set, storeConfigured } from "./store";

/**
 * Free-tier metering, keyed on a per-install identifier the client generates.
 *
 * This is deliberately not airtight: clearing app data earns a fresh free tier.
 * Tying it down would mean accounts, which is a large amount of product for a
 * collection app to carry. It stops incidental cost, which is the actual risk.
 */

/** Free identifications per install. Set FREE_SCAN_LIMIT to change it. */
export const FREE_SCAN_LIMIT = Number(process.env.FREE_SCAN_LIMIT ?? "50");

/** Metering only applies once there is somewhere durable to count. */
export const meteringEnabled = storeConfigured && FREE_SCAN_LIMIT > 0;

export interface Entitlement {
  pro: boolean;
  used: number;
  limit: number;
  remaining: number;
  metered: boolean;
}

const quotaKey = (installId: string) => `quota:${installId}`;
const proKey = (installId: string) => `pro:${installId}`;

/** Accept only our own generated ids, so a key cannot be crafted. */
export function validInstallId(value: string | null): value is string {
  return typeof value === "string" && /^[0-9a-f-]{16,64}$/i.test(value);
}

export async function readEntitlement(installId: string): Promise<Entitlement> {
  if (!meteringEnabled) {
    return {
      pro: true,
      used: 0,
      limit: 0,
      remaining: Number.POSITIVE_INFINITY,
      metered: false,
    };
  }
  const [pro, used] = await Promise.all([get(proKey(installId)), get(quotaKey(installId))]);
  const usedCount = Number(used ?? "0");
  const isPro = pro === "1";
  return {
    pro: isPro,
    used: usedCount,
    limit: FREE_SCAN_LIMIT,
    remaining: isPro ?
      Number.POSITIVE_INFINITY
    : Math.max(0, FREE_SCAN_LIMIT - usedCount),
    metered: true,
  };
}

export async function grantPro(installId: string): Promise<void> {
  await set(proKey(installId), "1");
}

/** Counted only after a successful read, so a failure never costs a scan. */
export async function recordScan(installId: string): Promise<void> {
  if (!meteringEnabled) return;
  await increment(quotaKey(installId));
}
