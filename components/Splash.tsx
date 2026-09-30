"use client";

import { useEffect, useState } from "react";

/**
 * The launch screen.
 *
 * Android draws its own splash from the manifest — icon on the background
 * colour — and drops it the instant the page first paints, which on a fast
 * phone is a blink. This overlay is painted in the same place with the same
 * colours before React runs (see the inline script in the layout, which
 * decides whether to show it), so the hand-off is invisible; it then holds
 * for a beat and fades out. Once per launch, and only for the installed app.
 */
const HOLD_MS = 1500;
const FADE_MS = 450;

export default function Splash() {
  const [phase, setPhase] = useState<"hold" | "fade" | "gone">("hold");

  useEffect(() => {
    if (document.documentElement.dataset.splash !== "1") {
      setPhase("gone");
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hold = setTimeout(() => setPhase("fade"), reduced ? 600 : HOLD_MS);
    const fade = setTimeout(
      () => {
        setPhase("gone");
        delete document.documentElement.dataset.splash;
      },
      (reduced ? 600 : HOLD_MS) + FADE_MS,
    );
    return () => {
      clearTimeout(hold);
      clearTimeout(fade);
    };
  }, []);

  if (phase === "gone") return null;

  return (
    <div className={`splash${phase === "fade" ? " is-fading" : ""}`} aria-hidden="true">
      <div className="splash-icon">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon-192.png" alt="" />
      </div>
      <div className="splash-name">Garage</div>
    </div>
  );
}
