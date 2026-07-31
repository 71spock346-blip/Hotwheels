"use client";

import { useCallback, useEffect, useState } from "react";
import { COLLECTION_CHANGED } from "./commit";
import { allCars, queueItems } from "./db";
import type { Car, QueueItem } from "./types";

/** Live view of the local collection, refreshed whenever anything writes. */
export function useCollection() {
  const [cars, setCars] = useState<Car[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [nextCars, nextQueue] = await Promise.all([allCars(), queueItems()]);
    setCars(nextCars);
    setQueue(nextQueue);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const onChange = () => void refresh();
    window.addEventListener(COLLECTION_CHANGED, onChange);
    // The queue drains on a timer in the background; poll so its badge stays honest.
    const interval = setInterval(() => void refresh(), 3000);
    return () => {
      window.removeEventListener(COLLECTION_CHANGED, onChange);
      clearInterval(interval);
    };
  }, [refresh]);

  return { cars, queue, loading, refresh };
}
