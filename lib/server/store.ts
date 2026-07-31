import "server-only";

/**
 * Tiny key-value store for quota and entitlements.
 *
 * Backed by Upstash Redis over its REST API when configured — no SDK, just
 * fetch, which suits serverless. Falls back to process memory otherwise so the
 * app runs unconfigured, with the loud caveat that serverless instances come
 * and go, making the fallback useless for real metering.
 */

const REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

export const storeConfigured = Boolean(REST_URL && REST_TOKEN);

const memory = new Map<string, string>();

async function command(...parts: (string | number)[]): Promise<unknown> {
  if (!storeConfigured) throw new Error("Store is not configured");
  const response = await fetch(REST_URL as string, {
    method: "POST",
    headers: {
      authorization: `Bearer ${REST_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(parts.map(String)),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Store request failed (${response.status})`);
  }
  const payload = (await response.json()) as { result?: unknown; error?: string };
  if (payload.error) throw new Error(payload.error);
  return payload.result ?? null;
}

export async function get(key: string): Promise<string | null> {
  if (!storeConfigured) return memory.get(key) ?? null;
  const result = await command("GET", key);
  return result === null || result === undefined ? null : String(result);
}

export async function set(key: string, value: string): Promise<void> {
  if (!storeConfigured) {
    memory.set(key, value);
    return;
  }
  await command("SET", key, value);
}

/** Atomic increment — the reason a real store matters once this is public. */
export async function increment(key: string): Promise<number> {
  if (!storeConfigured) {
    const next = Number(memory.get(key) ?? "0") + 1;
    memory.set(key, String(next));
    return next;
  }
  return Number(await command("INCR", key));
}
