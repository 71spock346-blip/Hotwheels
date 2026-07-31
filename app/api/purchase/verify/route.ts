import { NextResponse } from "next/server";
import { grantCredits, packFor, validInstallId } from "@/lib/server/entitlements";
import { billingConfigured, verifyAndAcknowledge } from "@/lib/server/play";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  productId?: string;
  purchaseToken?: string;
}

export async function POST(request: Request) {
  if (!billingConfigured) {
    return NextResponse.json(
      { error: "Purchases are not configured on this deployment." },
      { status: 503 },
    );
  }

  const installId = request.headers.get("x-install-id");
  if (!validInstallId(installId)) {
    return NextResponse.json({ error: "Missing install id." }, { status: 400 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  if (!body.productId || !body.purchaseToken) {
    return NextResponse.json(
      { error: "A product and purchase token are required." },
      { status: 400 },
    );
  }

  // Only packs this deployment actually sells can be granted.
  const pack = packFor(body.productId);
  if (!pack) {
    return NextResponse.json({ error: "Unknown product." }, { status: 400 });
  }

  try {
    const result = await verifyAndAcknowledge(pack.id, body.purchaseToken);
    if (!result.valid) {
      return NextResponse.json({ error: result.reason }, { status: 402 });
    }

    const grant = await grantCredits(installId, pack, body.purchaseToken);

    // An already-redeemed token is not an error: it means a previous attempt
    // granted the credits but the client never got to consume the purchase.
    // Reporting success lets it finish consuming and clear the purchase.
    return NextResponse.json({
      granted: grant.granted,
      credits: grant.credits,
      alreadyRedeemed: grant.alreadyRedeemed,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not verify that purchase.",
      },
      { status: 502 },
    );
  }
}
