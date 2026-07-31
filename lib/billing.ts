"use client";

import { installId } from "./install";

/**
 * Google Play Billing from inside the Trusted Web Activity, via the Digital
 * Goods API. The service only exists when the app was installed from Play, so
 * every entry point here degrades quietly in an ordinary browser tab.
 */

interface DigitalGoodsService {
  getDetails(itemIds: string[]): Promise<Array<{ itemId: string; title?: string; price?: { currency: string; value: string } }>>;
  listPurchases(): Promise<Array<{ itemId: string; purchaseToken: string }>>;
}

type GetDigitalGoodsService = (
  serviceProvider: string,
) => Promise<DigitalGoodsService>;

const PLAY_BILLING = "https://play.google.com/billing";

export interface EntitlementStatus {
  pro: boolean;
  used: number;
  limit: number;
  remaining: number | null;
  metered: boolean;
  purchasable: boolean;
  productId: string | null;
}

function billingService(): Promise<DigitalGoodsService> | null {
  const getService = (window as unknown as Record<string, unknown>)
    .getDigitalGoodsService as GetDigitalGoodsService | undefined;
  if (typeof getService !== "function") return null;
  return getService(PLAY_BILLING);
}

export function billingAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as Record<string, unknown>).getDigitalGoodsService ===
      "function" &&
    typeof (window as unknown as Record<string, unknown>).PaymentRequest ===
      "function"
  );
}

export async function fetchEntitlement(): Promise<EntitlementStatus | null> {
  try {
    const response = await fetch("/api/entitlement", {
      headers: { "x-install-id": installId() },
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as EntitlementStatus;
  } catch {
    return null;
  }
}

export interface PurchaseOutcome {
  ok: boolean;
  message: string;
}

/** Runs the Play purchase flow, then has the server verify the token. */
export async function purchasePro(productId: string): Promise<PurchaseOutcome> {
  const servicePromise = billingService();
  if (!servicePromise) {
    return {
      ok: false,
      message:
        "Purchases are only available in the Play Store version of the app.",
    };
  }

  try {
    const service = await servicePromise;
    const [details] = await service.getDetails([productId]);
    if (!details) {
      return { ok: false, message: "That product is not available yet." };
    }

    const request = new PaymentRequest(
      [{ supportedMethods: PLAY_BILLING, data: { sku: productId } }],
      {
        total: {
          label: details.title ?? "Unlimited identifications",
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

    const verified = await fetch("/api/purchase/verify", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-install-id": installId(),
      },
      body: JSON.stringify({ productId, purchaseToken: token }),
    });

    if (!verified.ok) {
      const payload = (await verified.json().catch(() => null)) as {
        error?: string;
      } | null;
      // Leave it incomplete so Play can refund rather than charging for nothing.
      await response.complete("fail");
      return {
        ok: false,
        message: payload?.error ?? "Could not verify that purchase.",
      };
    }

    await response.complete("success");
    return { ok: true, message: "Unlocked. Thank you." };
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
 * Re-applies a purchase this install already owns — needed after a reinstall,
 * or on a second device signed into the same Play account.
 */
export async function restorePurchases(): Promise<PurchaseOutcome> {
  const servicePromise = billingService();
  if (!servicePromise) {
    return {
      ok: false,
      message: "Nothing to restore outside the Play Store version.",
    };
  }
  try {
    const service = await servicePromise;
    const purchases = await service.listPurchases();
    if (!purchases.length) {
      return { ok: false, message: "No previous purchase found." };
    }
    for (const purchase of purchases) {
      const verified = await fetch("/api/purchase/verify", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-install-id": installId(),
        },
        body: JSON.stringify({
          productId: purchase.itemId,
          purchaseToken: purchase.purchaseToken,
        }),
      });
      if (verified.ok) return { ok: true, message: "Purchase restored." };
    }
    return { ok: false, message: "That purchase could not be verified." };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Restore failed.",
    };
  }
}
