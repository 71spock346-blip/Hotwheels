"use client";

import { useEffect, useRef } from "react";
import { commitIdentification, identify } from "@/lib/commit";
import { dequeue, queueItems, updateQueueItem } from "@/lib/db";
import { makeThumbnail } from "@/lib/image";

const MAX_ATTEMPTS = 3;
const POLL_MS = 4000;

/**
 * Drains the photo queue in the background so rapid-fire scanning never blocks
 * on the network. Mounted once, app-wide. Photos stay in IndexedDB until they
 * are identified, so closing the app mid-batch loses nothing.
 */
export default function QueueRunner() {
  const busy = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function drain() {
      if (busy.current || cancelled) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      busy.current = true;
      try {
        const items = await queueItems();
        for (const item of items) {
          if (cancelled) break;
          if (item.status === "failed" && item.attempts >= MAX_ATTEMPTS) continue;

          await updateQueueItem({ ...item, status: "working" });
          try {
            const identification = await identify([item.imageDataUrl], item.upc);
            const thumbnail = await makeThumbnail(item.imageDataUrl).catch(
              () => undefined,
            );
            await commitIdentification(identification, {
              upc: item.upc,
              thumbnail,
              source: item.upc ? "barcode" : "photo",
            });
            await dequeue(item.id);
          } catch (error) {
            await updateQueueItem({
              ...item,
              status: "failed",
              attempts: item.attempts + 1,
              error: error instanceof Error ? error.message : "Identification failed.",
            });
          }
        }
      } finally {
        busy.current = false;
      }
    }

    void drain();
    const interval = setInterval(() => void drain(), POLL_MS);
    const onOnline = () => void drain();
    window.addEventListener("online", onOnline);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  return null;
}
