"use client";

const KEY = "garage:install-id";

/**
 * A stable per-install identifier, used only to meter the free tier. It is not
 * an account and is never tied to a person; clearing app data mints a new one.
 */
export function installId(): string {
  if (typeof window === "undefined") return "";
  let existing = "";
  try {
    existing = window.localStorage.getItem(KEY) ?? "";
  } catch {
    // Private browsing can refuse storage; fall through to a per-session id.
  }
  if (existing) return existing;

  const generated =
    typeof crypto !== "undefined" && "randomUUID" in crypto ?
      crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
  try {
    window.localStorage.setItem(KEY, generated);
  } catch {
    // Not persisted — metering will simply be per session here.
  }
  return generated;
}
