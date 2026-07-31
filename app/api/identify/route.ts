import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import type { Identification, TreasureHunt } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-opus-5";

const SYSTEM = `You identify die-cast toy cars from photographs for a collector's inventory app.

Most photos are Hot Wheels on their blister card, shot quickly on a phone: angled, glare on the plastic, sometimes blurry. Some are loose cars with no packaging, where the base of the car carries the casting name and copyright year.

Read what is actually printed. Do not guess a plausible Hot Wheels car because the photo is hard to read — an empty field is far more useful to the collector than a confident wrong answer.

Where to look on a standard mainline card:
- Casting name: largest text on the card front, e.g. "'67 CAMARO", "TWIN MILL", "BONE SHAKER".
- Series: the segment name, e.g. "HW MUSCLE MANIA", "HW EXOTICS", "FAST & FURIOUS", "MONSTER TRUCKS".
- Series number: position within that segment, printed as a fraction like "3/10".
- Collector number: the mainline number, printed as a fraction with a large denominator like "112/250".
- Toy number: a 5-character Mattel item code, two letters then three digits, e.g. "HTB29", "HKG42". Usually small, near the barcode or the bottom corner. This is the single most valuable field — it pins down the exact casting and colour variant — so look carefully for it.
- Year: the copyright year printed in fine print, or the model year that is part of the casting name.

Treasure Hunt classification:
- "th" for a regular Treasure Hunt: a small flame-in-a-circle logo somewhere on the card front.
- "sth" for a Super Treasure Hunt: Real Riders rubber tyres, Spectraflame paint, and a "TH" logo on the car itself.
- "none" otherwise. Only mark a Treasure Hunt when you can actually see the marker.

Rules for the fields you return:
- Use an empty string for anything you cannot read. Never invent a toy number, collector number or series.
- "name" is the only field worth a best effort when text is partly obscured; if even the name is unreadable, return an empty string and set isHotWheels false.
- "color" is a short plain description of the car body, e.g. "metallic blue", "matte black with orange flames".
- "confidence" is 0 to 1, reflecting how sure you are of the name specifically.
- "notes" is for anything a collector would want flagged: damaged card, error variant, non-Hot-Wheels brand such as Matchbox or Johnny Lightning, multi-pack. Otherwise empty.
- Set "isHotWheels" false if the photo is not a die-cast car at all.`;

const SCHEMA = {
  type: "object",
  properties: {
    isHotWheels: {
      type: "boolean",
      description: "True if the photo shows a die-cast collectible car.",
    },
    name: { type: "string", description: "Casting name as printed, or empty." },
    series: { type: "string", description: "Series/segment name, or empty." },
    seriesNumber: { type: "string", description: 'Position in series, e.g. "3/10".' },
    collectorNumber: {
      type: "string",
      description: 'Mainline collector number, e.g. "112/250".',
    },
    year: { type: "string", description: "Four-digit year, or empty." },
    toyNumber: {
      type: "string",
      description: 'Mattel item code, two letters then three digits, e.g. "HTB29".',
    },
    color: { type: "string", description: "Short description of the body colour." },
    treasureHunt: { type: "string", enum: ["none", "th", "sth"] },
    confidence: { type: "number", description: "0 to 1 confidence in the name." },
    notes: { type: "string", description: "Anything notable, or empty." },
  },
  required: [
    "isHotWheels",
    "name",
    "series",
    "seriesNumber",
    "collectorNumber",
    "year",
    "toyNumber",
    "color",
    "treasureHunt",
    "confidence",
    "notes",
  ],
  additionalProperties: false,
} as const;

interface IdentifyRequest {
  images?: string[];
  upc?: string;
}

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Photo identification is not configured. Add ANTHROPIC_API_KEY in your Vercel project settings, then redeploy.",
        code: "no_api_key",
      },
      { status: 503 },
    );
  }

  let body: IdentifyRequest;
  try {
    body = (await request.json()) as IdentifyRequest;
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const images = (body.images ?? []).filter((image) => typeof image === "string");
  if (!images.length) {
    return NextResponse.json({ error: "No photo was sent." }, { status: 400 });
  }

  const blocks: Anthropic.ImageBlockParam[] = [];
  for (const image of images.slice(0, 3)) {
    const parsed = parseDataUrl(image);
    if (!parsed) {
      return NextResponse.json(
        { error: "Photos must be base64 data URLs." },
        { status: 400 },
      );
    }
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: parsed.mediaType,
        data: parsed.base64,
      },
    });
  }

  const hint =
    body.upc ?
      `\n\nThe barcode on this package scanned as ${body.upc}. Note that Hot Wheels mainline singles frequently share one barcode across an entire assortment, so treat this only as weak corroboration — identify the car from what you can see.`
    : "";

  const client = new Anthropic({ apiKey });

  try {
    const message = await createMessage(client, blocks, hint);

    if (message.stop_reason === "refusal") {
      return NextResponse.json(
        {
          error: "That photo could not be processed. You can add the car by hand instead.",
          code: "refused",
        },
        { status: 422 },
      );
    }

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    const identification = coerce(text);
    if (!identification) {
      return NextResponse.json(
        { error: "Could not read the identification result.", code: "bad_output" },
        { status: 502 },
      );
    }

    return NextResponse.json(identification);
  } catch (error) {
    return NextResponse.json(errorPayload(error), { status: statusFor(error) });
  }
}

/**
 * Ask Claude to read the card. Tries the server-side refusal fallback first so
 * a declined request is rescued automatically; if this SDK or account does not
 * have that beta, drops back to a plain request rather than failing the scan.
 */
async function createMessage(
  client: Anthropic,
  blocks: Anthropic.ImageBlockParam[],
  hint: string,
): Promise<Anthropic.Message> {
  const params = {
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM,
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    messages: [
      {
        role: "user" as const,
        content: [
          ...blocks,
          {
            type: "text" as const,
            text: `Identify this car for my collection.${hint}`,
          },
        ],
      },
    ],
  };

  try {
    return (await client.beta.messages.create({
      ...params,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)) as Anthropic.Message;
  } catch (error) {
    if (!isBetaUnavailable(error)) throw error;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await client.messages.create(params as any)) as Anthropic.Message;
  }
}

function isBetaUnavailable(error: unknown): boolean {
  if (!(error instanceof Anthropic.APIError)) return false;
  if (error.status !== 400 && error.status !== 404) return false;
  return /beta|fallback|unexpected|unknown/i.test(error.message);
}

function parseDataUrl(
  dataUrl: string,
): { mediaType: "image/jpeg" | "image/png" | "image/webp"; base64: string } | null {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s.exec(dataUrl);
  if (!match) return null;
  return {
    mediaType: match[1] as "image/jpeg" | "image/png" | "image/webp",
    base64: match[2],
  };
}

function coerce(text: string): Identification | null {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Structured outputs should make this impossible, but a stray code fence
    // would otherwise lose the whole scan.
    const match = /\{[\s\S]*\}/.exec(text);
    if (!match) return null;
    try {
      raw = JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  const str = (key: string): string | null => {
    const value = raw[key];
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  };

  const yearText = str("year");
  const year = yearText && /^\d{4}$/.test(yearText) ? Number(yearText) : null;

  const treasureHunt = raw.treasureHunt;
  const hunt: TreasureHunt =
    treasureHunt === "th" || treasureHunt === "sth" ? treasureHunt : "none";

  const confidence = typeof raw.confidence === "number" ? raw.confidence : 0;

  return {
    name: str("name") ?? "",
    series: str("series"),
    seriesNumber: str("seriesNumber"),
    collectorNumber: str("collectorNumber"),
    year,
    toyNumber: str("toyNumber")?.toUpperCase() ?? null,
    color: str("color"),
    treasureHunt: hunt,
    isHotWheels: raw.isHotWheels !== false,
    confidence: Math.min(1, Math.max(0, confidence)),
    notes: str("notes"),
  };
}

function statusFor(error: unknown): number {
  if (error instanceof Anthropic.AuthenticationError) return 401;
  if (error instanceof Anthropic.RateLimitError) return 429;
  if (error instanceof Anthropic.APIConnectionError) return 504;
  if (error instanceof Anthropic.APIError) return error.status ?? 502;
  return 500;
}

function errorPayload(error: unknown): { error: string; code: string } {
  if (error instanceof Anthropic.AuthenticationError) {
    return {
      error: "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in Vercel.",
      code: "bad_api_key",
    };
  }
  if (error instanceof Anthropic.RateLimitError) {
    return {
      error: "Rate limited by the API. Wait a moment and retry the queue.",
      code: "rate_limited",
    };
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return { error: "Could not reach the API. Check your connection.", code: "offline" };
  }
  const message = error instanceof Error ? error.message : "Identification failed.";
  return { error: message, code: "unknown" };
}
