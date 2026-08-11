import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import {
  meteringEnabled,
  readBalance,
  spendScan,
  validInstallId,
} from "@/lib/server/entitlements";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = process.env.IDENTIFY_MODEL ?? "claude-opus-5";

/**
 * Rough market values for a batch of cars, from the model's general knowledge.
 *
 * These are honest ballparks, not appraisals: real prices swing with card
 * condition, region and variant, and the model's knowledge has a cutoff. The
 * prompt pushes hard toward category-typical ranges over invented precision,
 * because a made-up "$45" on a $2 mainline poisons trust in the whole total.
 */
const SYSTEM = `You estimate resale values for die-cast toy cars in a collector's inventory app.

For each car described, give a realistic low-high range in US dollars for what it typically sells for on the secondary market (eBay sold listings, collector groups) in the stated condition.

Ground rules:
- Standard mainline Hot Wheels are cheap: usually $1-3 loose, $2-5 carded. Most cars in any collection are in this bracket. Do not inflate them.
- Regular Treasure Hunts typically $5-15. Super Treasure Hunts typically $25-80, more for sought-after castings.
- Premium lines (Car Culture, Team Transport, RLC, licensed premiums) typically $8-40.
- Sought-after castings, first editions and known chase variants can be worth more — apply that only when the specific casting and year genuinely warrants it.
- Condition matters: loose cars sell for less than carded; damaged cards lose most collector premium.
- When you do not recognise the specific casting, give the typical range for its category (mainline / TH / STH / premium) rather than guessing high.
- Ranges are per single car, not for the quantity owned.`;

const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "The id given for this car." },
          low: { type: "number", description: "Low end of the range in USD." },
          high: { type: "number", description: "High end of the range in USD." },
        },
        required: ["id", "low", "high"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
} as const;

interface EstimateCar {
  id: string;
  name: string;
  series?: string;
  seriesNumber?: string;
  year?: number;
  toyNumber?: string;
  color?: string;
  treasureHunt?: string;
  condition?: string;
}

const MAX_BATCH = 25;

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Estimation needs ANTHROPIC_API_KEY, same as identification." },
      { status: 503 },
    );
  }

  const installId = request.headers.get("x-install-id");
  if (meteringEnabled) {
    if (!validInstallId(installId)) {
      return NextResponse.json({ error: "Missing install id." }, { status: 400 });
    }
    try {
      if ((await readBalance(installId)).remaining <= 0) {
        return NextResponse.json(
          {
            error: "You have no identifications left — a value estimate uses one.",
            code: "quota_exhausted",
          },
          { status: 402 },
        );
      }
    } catch {
      return NextResponse.json(
        { error: "Cannot check your balance right now.", code: "metering_unavailable" },
        { status: 503 },
      );
    }
  }

  let cars: EstimateCar[];
  try {
    const body = (await request.json()) as { cars?: EstimateCar[] };
    cars = (body.cars ?? []).filter(
      (car) => typeof car?.id === "string" && typeof car?.name === "string",
    );
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }
  if (!cars.length) {
    return NextResponse.json({ error: "No cars to estimate." }, { status: 400 });
  }
  cars = cars.slice(0, MAX_BATCH);

  const listing = cars
    .map((car) =>
      [
        `id=${car.id}`,
        car.name,
        car.series && `series: ${car.series}${car.seriesNumber ? ` ${car.seriesNumber}` : ""}`,
        car.year && `year: ${car.year}`,
        car.toyNumber && `toy#: ${car.toyNumber}`,
        car.color && `colour: ${car.color}`,
        `hunt: ${car.treasureHunt ?? "none"}`,
        `condition: ${car.condition ?? "carded"}`,
      ]
        .filter(Boolean)
        .join(" | "),
    )
    .join("\n");

  const client = new Anthropic({ apiKey });
  try {
    // output_config is not yet in this SDK version's typings; the API knows it.
    const message = (await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: `Estimate a per-car value range for each of these:\n\n${listing}`,
        },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)) as Anthropic.Message;

    if (message.stop_reason === "refusal") {
      return NextResponse.json({ error: "Estimation was declined." }, { status: 422 });
    }

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
    const parsed = JSON.parse(text) as {
      items?: Array<{ id?: string; low?: number; high?: number }>;
    };

    const wanted = new Set(cars.map((car) => car.id));
    const items = (parsed.items ?? [])
      .filter(
        (item): item is { id: string; low: number; high: number } =>
          typeof item?.id === "string" &&
          wanted.has(item.id) &&
          typeof item.low === "number" &&
          typeof item.high === "number" &&
          item.low >= 0 &&
          item.high >= item.low,
      )
      .map((item) => ({
        id: item.id,
        low: Math.round(item.low * 100) / 100,
        high: Math.round(item.high * 100) / 100,
      }));

    if (meteringEnabled && validInstallId(installId)) {
      await spendScan(installId).catch(() => undefined);
    }

    return NextResponse.json({ items });
  } catch (error) {
    const status =
      error instanceof Anthropic.AuthenticationError ? 401
      : error instanceof Anthropic.RateLimitError ? 429
      : error instanceof Anthropic.APIError ? (error.status ?? 502)
      : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Estimation failed." },
      { status },
    );
  }
}
