import { NextResponse } from "next/server";
import { versionsForCasting, type WikiVersion } from "@/lib/server/versions";

export const runtime = "nodejs";

/**
 * GET /api/versions?name=Lancia+Stratos+Zero&name=Lancia+Stratos
 *
 * Every release of up to three castings, read live from their wiki pages:
 * year, series, colour, toy number and picture path. Free (no identification
 * is spent); the phone uses it to fill the "which one is it?" list when the
 * shipped catalogue does not know the car, mostly premium cards.
 */
export async function GET(request: Request) {
  const names = new URL(request.url).searchParams
    .getAll("name")
    .map((name) => name.trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 3);
  if (!names.length) {
    return NextResponse.json({ error: "Nothing to look up." }, { status: 400 });
  }

  const results = await Promise.allSettled(names.map((name) => versionsForCasting(name)));
  const versions: WikiVersion[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") versions.push(...result.value.slice(0, 60));
  }
  if (!versions.length && results.every((result) => result.status === "rejected")) {
    return NextResponse.json({ versions: [], error: "Wiki unreachable." }, { status: 502 });
  }
  return NextResponse.json(
    { versions },
    { headers: { "cache-control": "public, s-maxage=21600, stale-while-revalidate=86400" } },
  );
}
