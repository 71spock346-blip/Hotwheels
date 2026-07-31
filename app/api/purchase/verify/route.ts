import { NextResponse } from "next/server";
import { grantPro, validInstallId } from "@/lib/server/entitlements";
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

  const productId = body.productId ?? process.env.PLAY_PRODUCT_ID;
  if (!productId || !body.purchaseToken) {
    return NextResponse.json(
      { error: "A product and purchase token are required." },
      { status: 400 },
    );
  }

  try {
    const result = await verifyAndAcknowledge(productId, body.purchaseToken);
    if (!result.valid) {
      return NextResponse.json({ error: result.reason }, { status: 402 });
    }
    await grantPro(installId);
    return NextResponse.json({ pro: true });
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
