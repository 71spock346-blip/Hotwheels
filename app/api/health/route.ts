import { NextResponse } from "next/server";
import { FREE_SCAN_LIMIT, meteringEnabled } from "@/lib/server/entitlements";
import { billingConfigured } from "@/lib/server/play";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Configuration readout for the diagnostics screen.
 *
 * Booleans only — never the key itself, or any part of it. "Is it set" is the
 * only question worth answering here, and it is the one that costs an hour of
 * confusion when nobody can check it.
 */
export function GET() {
  return NextResponse.json({
    ok: true,
    identification: {
      apiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
      model: process.env.IDENTIFY_MODEL ?? "claude-opus-5",
      effort: process.env.IDENTIFY_EFFORT ?? "medium",
    },
    metering: {
      enabled: meteringEnabled,
      freeScanLimit: FREE_SCAN_LIMIT,
    },
    billing: { configured: billingConfigured },
    deployment: {
      // Vercel sets these; absent when running locally.
      id: process.env.VERCEL_DEPLOYMENT_ID ?? null,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      region: process.env.VERCEL_REGION ?? null,
    },
  });
}
