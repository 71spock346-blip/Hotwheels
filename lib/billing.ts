"use client";

import { installId } from "./install";

/**
 * Google Play Billing from inside the Trusted Web Activity, via the Digital
 * Goods API. The service only exists when the app was installed from Play, so
 * every entry point here degrades quietly in an ordinary browser tab.
 *
 * Credit packs are consumable products: once the server has banked the credits
 * the purchase must be consumed, otherwise Play considers it still owned and
 * refuses to sell the same pack again.
 */

interface ItemDetails {
  itemId: string;
  title?: string;
  description?: string;
  price?: { currency: string; value: string };
}

interface PurchaseDetails {
  itemId: string;
  purchaseToken: string;
}

interface DigitalGoodsService {
  getDetails(itemIds: string[]): Promise<ItemDetails[]>;
  listPurchases(): Promise<PurchaseDetails[]>;
  consume(purchaseToken: string): Promise<void>;
}

type GetDigitalGoodsService = (provider: string) => Promise<DigitalGoodsService>;

const PLAY_BILLING = "https://play.google.com/billing";

export interface CreditPack {
  id: string;
  credits: number;
}

export interface Balance {
  freeUsed: number;
  freeLimit: number;
  freeRemaining: number;
  credits: number;
  remaining: number | null;
  metered: boolean;
  purchasable: boolean;
  packs: CreditPack[];
}

/** A pack joined with the live price Play reports for it. */
export interface PricedPack extends CreditPack {
  title?: string;
  price?: string;
}

function billingService(): Promise<DigitalGoodsService> | null {
  if (typeof window === "undefined") return null;
  const getService = (window as unknown as Record<string, unknown>)
    .getDigitalGoodsService as GetDigitalGoodsService | undefined;
  if (typeof getService !== "function") return null;
  return getService(PLAY_BILLING);
}

export function billingAvailable(): boolean {
  return (
    billingService() !== null &&
    typeof (window as unknown as Record<string, unknown>).PaymentRequest === "function"
  );
}

export async function fetchBalance(): Promise<Balance | null> {
  try {
    const response = await fetch("/api/entitlement", {
      headers: { "x-install-id": installId() },
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as Balance;
  } catch {
    return null;
  }
}

/** Ask Play what each pack costs, so prices are always right for the locale. */
export async function pricePacks(packs: CreditPack[]): Promise<PricedPack[]> {
  const servicePromise = billingService();
  if (!servicePromise || !packs.length) return packs;
  try {
    const service = await servicePromise;
    const details = await service.getDetails(packs.map((pack) => pack.id));
    const byId = new Map(details.map((item) => [item.itemId, item]));
    return packs.map((pack) => {
      const item = byId.get(pack.id);
      return {
        ...pack,
        title: item?.title,
        price:
          item?.price ?
            formatPrice(item.price.value, item.price.currency)
          : undefined,
      };
    });
  } catch {
    return packs;
  }
}

function formatPrice(value: string, currency: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `${value} ${currency}`;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
      amount,
    );
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export interface PurchaseOutcome {
  ok: boolean;
  message: string;
}

async function redeem(
  service: DigitalGoodsService,
  productId: string,
  purchaseToken: string,
): Promise<{ ok: boolean; granted: number; message: string }> {
  const response = await fetch("/api/purchase/verify", {
    method: "POST",
    headers: { "content-type": "application/json", "x-install-id": installId() },
    body: JSON.stringify({ productId, purchaseToken }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    return {
      ok: false,
      granted: 0,
      message: payload?.error ?? "Could not verify that purchase.",
    };
  }

  const result = (await response.json()) as { granted: number; credits: number };

  // Credits are banked; release the purchase so the pack can be bought again.
  // A failure here is not fatal — the token is already recorded as redeemed,
  // and restore will consume it on a later run.
  await service.consume(purchaseToken).catch(() => undefined);

  return {
    ok: true,
    granted: result.granted,
    message:
      result.granted > 0 ?
        `${result.granted} identifications added. You now have ${result.credits}.`
      : "That purchase was already applied.",
  };
}

export async function buyPack(productId: string): Promise<PurchaseOutcome> {
  const servicePromise = billingService();
  if (!servicePromise) {
    return {
      ok: false,
      message: "Purchases are only available in the Play Store version of the app.",
    };
  }

  try {
    const service = await servicePromise;
    const [details] = await service.getDetails([productId]);
    if (!details) {
      return { ok: false, message: "That pack is not available yet." };
    }

    const request = new PaymentRequest(
      [{ supportedMethods: PLAY_BILLING, data: { sku: productId } }],
      {
        total: {
          label: details.title ?? "Identification credits",
          amount: details.price ?? { currency: "USD", value: "0" },
        },
      },
    );

    const response = await request.show();
    const token = (response.details as { token?: string }).token;
    if (!token) {
      await response.complete("fail");
      return { ok: false, message: "Play did not return a purchase token." };
    }

    const result = await redeem(service, productId, token);
    await response.complete(result.ok ? "success" : "fail");
    return { ok: result.ok, message: result.message };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, message: "Purchase cancelled." };
    }
    return {
      ok: false,
      message: error instanceof Error ? error.message : "The purchase failed.",
    };
  }
}

/**
 * Recovers anything paid for but not yet banked — a crash between payment and
 * verification, or a reinstall. Play keeps an unconsumed purchase indefinitely,
 * so this is the safety net that stops a user paying for nothing.
 */
export async function restorePurchases(): Promise<PurchaseOutcome> {
  const servicePromise = billingService();
  if (!servicePromise) {
    return { ok: false, message: "Nothing to restore outside the Play Store version." };
  }
  try {
    const service = await servicePromise;
    const purchases = await service.listPurchases();
    if (!purchases.length) {
      return { ok: false, message: "No outstanding purchases found." };
    }
    let granted = 0;
    for (const purchase of purchases) {
      const result = await redeem(service, purchase.itemId, purchase.purchaseToken);
      if (result.ok) granted += result.granted;
    }
    return granted > 0 ?
        { ok: true, message: `Restored ${granted} identifications.` }
      : { ok: true, message: "Everything you have bought is already applied." };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Restore failed.",
    };
  }
}
