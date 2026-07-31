"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Toast, useToast } from "@/components/Toast";
import { allCars, newId, putCar, deleteCar, queueItems } from "@/lib/db";
import { installId } from "@/lib/install";
import type { Car } from "@/lib/types";

type Check = { label: string; value: string; ok: boolean | null };

/**
 * One screen that answers "why is it not working".
 *
 * Every failure in this app so far has been invisible from the outside: a
 * decoder that never loaded, a photo silently discarded, a write that failed
 * with no message. This exercises each of those paths for real and reports
 * what happened, in a form that can be copied into a message.
 */
export default function DiagnosticsPage() {
  const [checks, setChecks] = useState<Check[]>([]);
  const [running, setRunning] = useState(true);
  const { toast, show } = useToast();

  const run = useCallback(async () => {
    setRunning(true);
    const results: Check[] = [];

    results.push({
      label: "Secure context (camera needs this)",
      value: window.isSecureContext ? "yes" : "no — camera cannot open",
      ok: window.isSecureContext,
    });

    results.push({
      label: "Install id",
      value: installId().slice(0, 8) + "…",
      ok: true,
    });

    // --- camera -----------------------------------------------------------
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
      });
      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings();
      results.push({
        label: "Camera",
        value: `${settings.width ?? "?"}×${settings.height ?? "?"}, ${settings.facingMode ?? "unknown facing"}`,
        ok: true,
      });
      stream.getTracks().forEach((t) => t.stop());
    } catch (error) {
      results.push({
        label: "Camera",
        value: error instanceof Error ? error.message : "unavailable",
        ok: false,
      });
    }

    // --- barcode decoder --------------------------------------------------
    const nativeDetector = "BarcodeDetector" in globalThis;
    try {
      const { createScanner } = await import("@/lib/barcode");
      const scanner = await createScanner();
      results.push({
        label: "Barcode reader",
        value:
          scanner.kind === "native" ?
            "built into this browser"
          : "ZXing (downloaded — normal on iPhone)",
        ok: true,
      });
    } catch (error) {
      results.push({
        label: "Barcode reader",
        value: `failed to load — ${error instanceof Error ? error.message : "unknown"}${nativeDetector ? "" : " (needs a network connection the first time)"}`,
        ok: false,
      });
    }

    // --- storage ----------------------------------------------------------
    try {
      const probe: Car = {
        id: newId(),
        name: "__diagnostics__",
        treasureHunt: "none",
        condition: "carded",
        quantity: 1,
        source: "manual",
        addedAt: Date.now(),
        updatedAt: Date.now(),
      };
      await putCar(probe);
      await deleteCar(probe.id);
      const cars = await allCars();
      const queue = await queueItems();
      results.push({
        label: "Storage (write test)",
        value: `works — ${cars.length} car${cars.length === 1 ? "" : "s"} saved, ${queue.length} photo${queue.length === 1 ? "" : "s"} queued`,
        ok: true,
      });
    } catch (error) {
      results.push({
        label: "Storage (write test)",
        value: error instanceof Error ? error.message : "failed",
        ok: false,
      });
    }

    // --- server -----------------------------------------------------------
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      const health = (await response.json()) as {
        identification: { apiKeyConfigured: boolean; model: string; effort: string };
        metering: { enabled: boolean; freeScanLimit: number };
        deployment: { commit: string | null };
      };
      results.push({
        label: "Anthropic API key",
        value: health.identification.apiKeyConfigured ? "configured" : "MISSING",
        ok: health.identification.apiKeyConfigured,
      });
      results.push({
        label: "Identification model",
        value: `${health.identification.model} (effort ${health.identification.effort})`,
        ok: true,
      });
      results.push({
        label: "Free-tier metering",
        value:
          health.metering.enabled ?
            `on — ${health.metering.freeScanLimit} free per install`
          : "off (unlimited)",
        ok: true,
      });
      results.push({
        label: "Deployed commit",
        value: health.deployment.commit ?? "local",
        ok: true,
      });
    } catch (error) {
      results.push({
        label: "Server",
        value: error instanceof Error ? error.message : "unreachable",
        ok: false,
      });
    }

    // --- app version ------------------------------------------------------
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      results.push({
        label: "Offline cache",
        value: registration ? "active" : "not registered yet",
        ok: true,
      });
    }

    setChecks(results);
    setRunning(false);
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  const report = checks
    .map((check) => `${check.ok === false ? "FAIL" : "ok  "}  ${check.label}: ${check.value}`)
    .join("\n");

  return (
    <main className="shell">
      <header className="topbar">
        <Link href="/scan" className="btn btn-ghost">
          ← Scan
        </Link>
        <button type="button" className="btn" onClick={() => void run()} disabled={running}>
          {running ? "Checking…" : "Re-run"}
        </button>
      </header>

      <h1 style={{ fontSize: 24, marginBottom: 6 }}>Diagnostics</h1>
      <p className="muted small" style={{ marginTop: 0, lineHeight: 1.5 }}>
        Runs each part of the app for real — camera, barcode reader, storage and
        server — and reports what happened.
      </p>

      <div style={{ marginTop: 18 }}>
        {checks.map((check) => (
          <div key={check.label} className="bar" style={{ alignItems: "flex-start" }}>
            <div>
              <div style={{ fontWeight: 650 }}>{check.label}</div>
              <div className="muted small" style={{ marginTop: 2, lineHeight: 1.4 }}>
                {check.value}
              </div>
            </div>
            <b style={{ color: check.ok === false ? "var(--danger)" : "var(--green)" }}>
              {check.ok === false ? "✕" : "✓"}
            </b>
          </div>
        ))}
        {running && <p className="muted small">Running checks…</p>}
      </div>

      <button
        type="button"
        className="btn btn-block"
        style={{ marginTop: 18 }}
        disabled={running || !checks.length}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(report);
            show("Copied — paste it into a message", "good");
          } catch {
            show("Could not copy. Screenshot this page instead.", "bad");
          }
        }}
      >
        Copy report
      </button>

      <Toast toast={toast} />
    </main>
  );
}
