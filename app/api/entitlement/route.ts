import { NextResponse } from "next/server";
import { CREDIT_PACKS, readBalance, validInstallId } from "@/lib/server/entitlements";
import { billingConfigured } from "@/lib/server/play";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Drives the balance meter and the pack buttons on the upgrade screen. */
export async function GET(request: Request) {
  const installId = request.headers.get("x-install-id");
  if (!validInstallId(installId)) {
    return NextResponse.json({ error: "Missing install id." }, { status: 400 });
  }

  let balance;
  try {
    balance = await readBalance(installId);
  } catch {
    return NextResponse.json(
      { error: "Balance is unavailable right now.", code: "metering_unavailable" },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ...balance,
    remaining: balance.remaining === Number.POSITIVE_INFINITY ? null : balance.remaining,
    purchasable: billingConfigured,
    // Prices come from Play at display time; this is just the catalogue.
    packs: CREDIT_PACKS,
  });
}
