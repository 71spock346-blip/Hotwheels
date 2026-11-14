import { NextResponse } from "next/server";
import { findRow, wikiRowsForYear } from "@/lib/server/wiki";

export const runtime = "nodejs";

/**
 * GET /api/photo?year=2026&toy=JJM69&col=072&name=Datsun+240Z
 *
 * Finds the wiki picture for a release the shipped catalogue has none for
 * (usually a brand-new car). Answers { photo: "<wiki upload path>" } or
 * { photo: null }; the phone builds the image URL and loads it from the wiki.
 */

const TOY_PATTERN = /^[A-Z0-9]{4,8}$/;
const COL_PATTERN = /^\d{1,4}$/;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const year = Number(params.get("year"));
  const toyNumber = (params.get("toy") ?? "").toUpperCase() || undefined;
  const collectorNumber = params.get("col") || undefined;
  const name = (params.get("name") ?? "").slice(0, 120) || undefined;

  const thisYear = new Date().getFullYear();
  if (!Number.isInteger(year) || year < 1995 || year > thisYear + 1) {
    return NextResponse.json({ error: "Bad year." }, { status: 400 });
  }
  if (toyNumber && !TOY_PATTERN.test(toyNumber)) {
    return NextResponse.json({ error: "Bad toy number." }, { status: 400 });
  }
  if (collectorNumber && !COL_PATTERN.test(collectorNumber)) {
    return NextResponse.json({ error: "Bad collector number." }, { status: 400 });
  }
  if (!toyNumber && !collectorNumber && !name) {
    return NextResponse.json({ error: "Nothing to look up." }, { status: 400 });
  }

  try {
    const rows = await wikiRowsForYear(year);
    const row = findRow(rows, {
      toyNumber,
      collectorNumber: collectorNumber?.padStart(3, "0"),
      name,
    });
    return NextResponse.json(
      { photo: row?.photo ?? null },
      // Let Vercel's edge answer repeats for a few hours.
      { headers: { "cache-control": "public, s-maxage=21600, stale-while-revalidate=86400" } },
    );
  } catch {
    // The wiki being down is not the phone's problem: it keeps its own photo.
    return NextResponse.json({ photo: null, error: "Wiki unreachable." }, { status: 502 });
  }
}
