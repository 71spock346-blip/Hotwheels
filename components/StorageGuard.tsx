"use client";

import { useEffect } from "react";
import { COLLECTION_CHANGED } from "@/lib/commit";
import { requestPersistentStorage } from "@/lib/safety";

/** Chrome's answer can change as the app gets used; don't ask on every scan. */
const RETRY_MS = 10 * 60_000;

/**
 * Asks the browser, quietly, to keep the collection's storage so the phone
 * does not clear it when space runs low. Chrome never shows a prompt for this;
 * it answers from how the app is used, so ask at launch, after installing to
 * the home screen, and again now and then while cars are being added.
 */
export default function StorageGuard() {
  useEffect(() => {
    let lastAsked = 0;
    let kept = false;
    const ask = async (force = false) => {
      if (kept) return;
      if (!force && Date.now() - lastAsked < RETRY_MS) return;
      lastAsked = Date.now();
      kept = (await requestPersistentStorage()) !== "at-risk";
    };

    void ask(true);
    const onChange = () => void ask();
    const onInstalled = () => void ask(true);
    window.addEventListener(COLLECTION_CHANGED, onChange);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener(COLLECTION_CHANGED, onChange);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  return null;
}
