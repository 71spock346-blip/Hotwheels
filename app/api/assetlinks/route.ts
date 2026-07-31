import { NextResponse } from "next/server";

/**
 * Digital Asset Links, served at /.well-known/assetlinks.json via a rewrite.
 *
 * This is what tells Android that the Play Store app and this website are the
 * same owner. Without it a Trusted Web Activity still runs, but Chrome keeps a
 * URL bar pinned to the top of the app, which looks broken.
 *
 * Set both values in Vercel once Play App Signing has given you a certificate
 * fingerprint (Play Console -> Test and release -> Setup -> App signing).
 */
export const dynamic = "force-dynamic";

export function GET() {
  const packageName = process.env.TWA_PACKAGE_NAME;
  const fingerprint = process.env.TWA_SHA256_FINGERPRINT;

  if (!packageName || !fingerprint) {
    // An empty list is valid and simply asserts no linked app yet.
    return NextResponse.json([], {
      headers: { "cache-control": "public, max-age=300" },
    });
  }

  return NextResponse.json(
    [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: packageName,
          // Play may list more than one certificate; comma-separate them.
          sha256_cert_fingerprints: fingerprint
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        },
      },
    ],
    { headers: { "cache-control": "public, max-age=300" } },
  );
}
