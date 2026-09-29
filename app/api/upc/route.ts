import { NextResponse } from "next/server";
import { hashAll, hashIncrement, storeConfigured } from "@/lib/server/store";

export const runtime = "nodejs";

/**
 * The shared barcode database.
 *
 * Mattel prints one barcode per assortment, not per car, so no vendor sells a
 * barcode -> Hot Wheels car lookup. This builds one from use: every time a
 * user confirms which car a barcode was on, that vote is counted here, and
 * the next person to scan the same barcode is offered the cars others found
 * behind it — no photo, no identification cost. Votes are anonymous: a
 * barcode, a toy number, a name. Nothing about who sent them is stored.
 */

const UPC_PATTERN = /^\d{8,14}$/;
const TOY_PATTERN = /^[A-Z0-9]{4,6}$/;
const MAX_CANDIDATES = 12;

interface Candidate {
  toyNumber: string;
  name: string;
  year?: number;
  count: number;
}

function key(upc: string): string {
  return `upc:${upc}`;
}

function decodeField(field: string, count: number): Candidate | null {
  const [toyNumber, name, year] = field.split("|");
  if (!toyNumber || !name) return null;
  const candidate: Candidate = { toyNumber, name, count };
  if (year && /^\d{4}$/.test(year)) candidate.year = Number(year);
  return candidate;
}

export async function GET(request: Request) {
  const upc = new URL(request.url).searchParams.get("upc") ?? "";
  if (!UPC_PATTERN.test(upc)) {
    return NextResponse.json({ error: "Bad barcode." }, { status: 400 });
  }
  if (!storeConfigured) {
    return NextResponse.json({ shared: false, candidates: [] });
  }
  try {
    const votes = await hashAll(key(upc));
    const candidates = Object.entries(votes)
      .map(([field, count]) => decodeField(field, count))
      .filter((candidate): candidate is Candidate => candidate !== null)
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_CANDIDATES);
    return NextResponse.json(
      { shared: true, candidates },
      { headers: { "cache-control": "public, max-age=300" } },
    );
  } catch {
    return NextResponse.json({ shared: false, candidates: [] });
  }
}

interface Vote {
  upc?: string;
  toyNumber?: string;
  name?: string;
  year?: number;
}

export async function POST(request: Request) {
  if (!storeConfigured) return new NextResponse(null, { status: 204 });

  const body = (await request.json().catch(() => null)) as Vote | null;
  const upc = body?.upc ?? "";
  const toyNumber = (body?.toyNumber ?? "").toUpperCase().trim();
  const name = (body?.name ?? "").trim().replace(/\|/g, "/").slice(0, 80);
  const year =
    typeof body?.year === "number" && body.year >= 1968 && body.year <= 2100 ?
      String(body.year)
    : "";
  if (!UPC_PATTERN.test(upc) || !TOY_PATTERN.test(toyNumber) || !name) {
    return NextResponse.json({ error: "Bad vote." }, { status: 400 });
  }
  try {
    await hashIncrement(key(upc), `${toyNumber}|${name}|${year}`);
  } catch {
    // Losing a vote costs nothing; the next scan casts another.
  }
  return new NextResponse(null, { status: 204 });
}
