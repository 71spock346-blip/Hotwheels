import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy — Garage",
  description: "What Garage does and does not do with your data.",
};

/**
 * Google Play requires a reachable privacy policy URL for any app that asks
 * for the camera. Put a real contact address here before you submit — Play
 * rejects placeholder contact details.
 */
const CONTACT_EMAIL = "you@example.com";

const UPDATED = "31 July 2026";

export default function PrivacyPage() {
  return (
    <main className="shell">
      <header className="topbar">
        <Link href="/" className="btn btn-ghost">
          ← Garage
        </Link>
      </header>

      <h1 style={{ fontSize: 26, marginBottom: 6 }}>Privacy policy</h1>
      <p className="muted small" style={{ marginTop: 0 }}>
        Last updated {UPDATED}
      </p>

      <p className="small" style={{ lineHeight: 1.6 }}>
        Garage is a tool for cataloguing a die-cast car collection. It has no
        accounts, no logins and no analytics, and it does not sell or share
        personal information.
      </p>

      <h2 className="section-title">What stays on your device</h2>
      <p className="small" style={{ lineHeight: 1.6, marginTop: 0 }}>
        Your collection — car names, series, numbers, quantities, notes,
        condition and the thumbnails shown in the list — is stored only in your
        browser&rsquo;s local storage on this device. It is never uploaded to us,
        and we cannot see it. Clearing the app&rsquo;s data or uninstalling the
        app deletes it, which is why the app offers a backup file you can export
        and keep yourself.
      </p>

      <h2 className="section-title">The camera</h2>
      <p className="small" style={{ lineHeight: 1.6, marginTop: 0 }}>
        The camera is used only while the scanning screen is open, to read
        barcodes and to photograph a card you choose to capture. Nothing is
        recorded and no video is transmitted. Barcode reading happens entirely
        on your device.
      </p>

      <h2 className="section-title">Photos sent for identification</h2>
      <p className="small" style={{ lineHeight: 1.6, marginTop: 0 }}>
        When you capture a card, that single still photo is sent to
        Anthropic&rsquo;s Claude API so the car&rsquo;s details can be read from
        it, and the extracted details are returned to your device. This is the
        only data that leaves your device. Photos are sent for that purpose
        alone and are not used by us for anything else. Anthropic&rsquo;s handling
        of API data is described in their{" "}
        <a
          href="https://www.anthropic.com/legal/privacy"
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: "underline" }}
        >
          privacy policy
        </a>
        . If you never capture a photo, nothing is ever transmitted.
      </p>

      <h2 className="section-title">Children</h2>
      <p className="small" style={{ lineHeight: 1.6, marginTop: 0 }}>
        Garage is not directed at children and does not knowingly collect
        personal information from anyone.
      </p>

      <h2 className="section-title">Changes and contact</h2>
      <p className="small" style={{ lineHeight: 1.6, marginTop: 0 }}>
        Any change to this policy will be published on this page with a new date
        above. Questions can go to{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} style={{ textDecoration: "underline" }}>
          {CONTACT_EMAIL}
        </a>
        .
      </p>

      <div style={{ height: 24 }} />
    </main>
  );
}
