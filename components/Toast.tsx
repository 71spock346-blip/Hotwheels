"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ToastTone = "good" | "bad" | "plain";

export interface ToastState {
  message: string;
  tone: ToastTone;
}

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, tone: ToastTone = "plain") => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, tone });
    timer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return { toast, show };
}

export function Toast({ toast }: { toast: ToastState | null }) {
  if (!toast) return null;
  const toneClass =
    toast.tone === "good" ? " is-good"
    : toast.tone === "bad" ? " is-bad"
    : "";
  return (
    <div className={`toast${toneClass}`} role="status" aria-live="polite">
      <span aria-hidden="true">
        {toast.tone === "good" ? "✓" : toast.tone === "bad" ? "!" : "•"}
      </span>
      {toast.message}
    </div>
  );
}
