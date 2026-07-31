import { NextResponse } from "next/server";
import { readEntitlement, validInstallId } from "@/lib/server/entitlements";
import { billingConfigured } from "@/lib/server/play";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What the app shows on its upgrade screen: scans left, and whether to offer a purchase. */
export async function GET(request: Request) {
  const installId = request.headers.get("x-install-id");
  if (!validInstallId(installId)) {
    return NextResponse.json({ error: "Missing install id." }, { status: 400 });
  }

  const entitlement = await readEntitlement(installId);

  return NextResponse.json({
    ...entitlement,
    remaining:
      entitlement.remaining === Number.POSITIVE_INFINITY ? null : entitlement.remaining,
    purchasable: billingConfigured,
    productId: process.env.PLAY_PRODUCT_ID ?? null,
  });
}
