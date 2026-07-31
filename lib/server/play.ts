import "server-only";
import { createSign } from "node:crypto";

/**
 * Verifies a Google Play purchase server side.
 *
 * A token handed over by the client proves nothing on its own, so it is checked
 * against the Play Developer API before any entitlement is granted. Signing the
 * service-account JWT by hand keeps a very large Google SDK out of a function
 * that makes two HTTP calls.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";

const CLIENT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
// Vercel stores newlines escaped; restore them before signing.
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const PACKAGE_NAME = process.env.TWA_PACKAGE_NAME;

export const billingConfigured = Boolean(CLIENT_EMAIL && PRIVATE_KEY && PACKAGE_NAME);

function base64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function accessToken(): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const claims = {
    iss: CLIENT_EMAIL,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3600,
  };
  const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(
    JSON.stringify(claims),
  )}`;

  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${base64url(signer.sign(PRIVATE_KEY as string))}`;

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Google auth failed (${response.status})`);
  }
  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) throw new Error("Google returned no access token");
  return payload.access_token;
}

export interface PurchaseCheck {
  valid: boolean;
  reason?: string;
}

/**
 * Confirms the purchase is real and, crucially, acknowledges it. Google
 * automatically refunds any purchase left unacknowledged for three days.
 */
export async function verifyAndAcknowledge(
  productId: string,
  purchaseToken: string,
): Promise<PurchaseCheck> {
  if (!billingConfigured) return { valid: false, reason: "Billing is not configured." };

  const token = await accessToken();
  const base = `${API}/${encodeURIComponent(PACKAGE_NAME as string)}/purchases/products/${encodeURIComponent(
    productId,
  )}/tokens/${encodeURIComponent(purchaseToken)}`;

  const response = await fetch(base, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) {
    return {
      valid: false,
      reason:
        response.status === 404 ?
          "Google does not recognise that purchase."
        : `Google rejected the check (${response.status}).`,
    };
  }

  const purchase = (await response.json()) as {
    purchaseState?: number;
    acknowledgementState?: number;
  };

  // 0 = purchased. 1 = cancelled, 2 = pending.
  if (purchase.purchaseState !== 0) {
    return { valid: false, reason: "That purchase is not complete." };
  }

  if (purchase.acknowledgementState === 0) {
    const ack = await fetch(`${base}:acknowledge`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: "{}",
      cache: "no-store",
    });
    if (!ack.ok && ack.status !== 409) {
      // 409 means someone already acknowledged it, which is fine.
      return { valid: false, reason: "Could not acknowledge the purchase." };
    }
  }

  return { valid: true };
}
