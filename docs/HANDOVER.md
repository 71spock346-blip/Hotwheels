# MONEYHOLE — project handover

A Hot Wheels collection tracker for phones. You point the camera at a
blister card and the car lands in your collection, complete with name,
series, collector number, year and Treasure Hunt status.

- **Live app:** https://hotwheels-gules.vercel.app (open it in Chrome on
  Android and "Add to Home screen" to install it as an app)
- **Code:** https://github.com/71spock346-blip/Hotwheels, branch `main`
- **Hosting:** Vercel project `hotwheels`. Every push to `main` deploys
  automatically in a minute or two.
- **Owner's phone:** Samsung Galaxy S25 Ultra (Android, Chrome).

This document is the starting context for anyone, human or Claude, picking
the project up. The README in the repo goes deeper on setup and on each
feature; this file says where things stand and why they are the way they are.

---

## 1. Where it stands

### Working today, on the live app

- **Scanning.** Four ways in, fastest first:
  1. A barcode scanned before on this phone adds the car instantly, with no
     network call and no cost.
  2. A barcode other users have confirmed offers their cars to pick from
     (needs the Redis store, see section 2).
  3. A new barcode: flip the card, photograph the front, and the photo is
     identified by Claude. The reply only has to contain a toy number or a
     collector number; the built-in release catalogue fills in the rest.
  4. No barcode: the photo alone is enough.
  Also **Type a code**: type the toy number printed beside the barcode
  (like `HTB29`) and the car comes back complete, at no cost.
- **Release catalogue.** About 10,750 mainline releases from 1995 onwards,
  built from the Hot Wheels Wiki, shipped with the app and cached for
  offline use. Almost every release has a photo link.
- **Catalogue photos.** A car matched by toy number shows the wiki's photo
  of that exact release, in the garage and on its own page. A photo the
  owner takes on a car's page always takes precedence.
- **Collection.** Garage list with search and filters (duplicates, hunts,
  wishlist), duplicates counted as ×N, wishlist (scanning a wanted car
  moves it into the garage), series completion ("3/10 still hunting"),
  rough value estimates, CSV export, JSON backup and restore.
- **Keeping the collection.** The app asks the browser for persistent
  storage (`navigator.storage.persist()`, in `components/StorageGuard.tsx`)
  at launch, after install and now and then while cars are added; Chrome
  answers silently, usually yes once the app is on the home screen. Stats →
  Your data shows whether it was granted and when the last backup was
  (Drive, a shared file or a downloaded file). When cars have changed and a week has passed
  without a backup, an amber reminder shows on the Garage and on Stats.
  Logic in `lib/safety.ts`.
- **Offline.** The collection lives on the phone (IndexedDB). Photos taken
  offline queue and are identified when the connection comes back.
- **Design.** Black and gold showroom look, MONEYHOLE icon and splash,
  custom line icons, three-plane "stage" headers. See section 5 for the
  rules.

### Built, but not switched on until the owner configures something

| Feature | What it needs | Where |
|---|---|---|
| Shared barcode database | Upstash Redis | Vercel → Storage → Upstash (one click; sets two env vars) |
| Free tier (10 identifications) and paid credit packs | Upstash Redis, plus the Play Store items below | same |
| Google Drive automatic backup | A Google OAuth client ID in `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | README → "Google Drive backup" (about five minutes) |
| Play Store purchase verification | Package name, signing fingerprint, in-app products, a service account | README → "Putting it on the Google Play Store" |

At the last check, the only environment variable set on Vercel was
`ANTHROPIC_API_KEY`. Without Redis the app runs with unlimited free
identification, which is what you want while it is only the owner using it.

---

## 2. The owner's to-do list

Things only the owner can do, roughly in the order they matter:

1. **Reinstall the app on the phone** after big releases: Android caches
   the name and icon at install time.
2. **Add Upstash Redis** on Vercel to switch on the shared barcode database.
3. **Create the Google OAuth client** for Drive backup. Use "MONEYHOLE" as
   the app name on Google's consent screen.
4. **Replace the placeholder contact address** in `app/privacy/page.tsx`
   (`CONTACT_EMAIL = "you@example.com"`). Google Play requires a real one.
5. **Test accuracy on about 50 real cards** before selling, and try the
   cheaper identification model (`IDENTIFY_MODEL`) to see whether it is
   accurate enough. The model is the biggest cost lever.
6. **Play Store:** a $25 developer account. A *personal* account must run a
   closed test with at least 12 testers for 14 days before it can publish.
   Then set `TWA_PACKAGE_NAME`, `TWA_SHA256_FINGERPRINT`, create the credit
   pack products, and set `PLAY_CREDIT_PACKS` and the service-account
   variables.

---

## 3. Decisions already made, and why

Don't reopen these without a reason; each was discussed with the owner.

- **Business model: credit packs.** The owner pays for identification and
  charges for it. New installs get a free allowance (`FREE_SCAN_LIMIT`,
  default 10), then buy packs through Google Play Billing (the Digital Goods
  API works inside a Trusted Web Activity). Barcodes already scanned, typed
  toy numbers and manual entry are always free. Metering *fails closed*: if
  the store is unreachable, identification refuses rather than giving away
  paid calls.
- **No Hot Wheels or Mattel trademarks in the product.** The owner twice
  supplied the real Hot Wheels logo for the icon; it was refused both times,
  because it is Mattel's trademark and would put the Play listing at risk.
  The MONEYHOLE render the owner supplied is the icon. The app name is
  "MONEYHOLE", not "... Hot Wheels ...". Saying "for Hot Wheels" in a
  description is fine.
- **Mattel prints one barcode per assortment, not per car.** No barcode
  database can name a car from its barcode alone. That is why there is a
  release catalogue (keyed by toy number) plus a crowd-built barcode table
  (anonymous votes: barcode, toy number, name — nothing about the user).
- **Wiki photos are shown, never stored.** They are fan uploads used under
  fair use, so the app loads them from the wiki on demand with a credit
  link and never copies them into the app or into backups. The clean
  long-term answer is a shared pool of users' own photos.
- **Data lives on the phone.** No accounts, no server-side copy of anyone's
  collection. Backup is the user's own: Google Drive's hidden per-app
  folder (no verification review needed for that scope) or a downloaded
  file. Android web apps cannot write to a phone folder on their own
  schedule; that's a platform limit.
- **iPhone users** can install it from Safari. Drive backup is optional for
  them; their backup path is **Share backup** on Stats → Save to Files →
  iCloud Drive. The button uses the system share sheet (`shareFile` in
  `lib/export.ts`) and only shows where the browser can share files.
  Chrome on Android won't share `.json`, so there it shares the same
  contents as a `.txt` file; restore accepts both. If a share fails for
  any reason other than the user closing the sheet, it downloads instead.
- **Identification uses Claude** (`claude-opus-5` by default, effort
  `medium`) with a structured-output schema. It is told never to invent a
  toy number; an empty field beats a confident wrong one, because the toy
  number drives duplicate detection.

---

## 4. How it is built

- **Next.js 15 (App Router), React 19, TypeScript.** A progressive web app
  with a service worker (`public/sw.js`) and a manifest; it ships to the
  Play Store as a Trusted Web Activity wrapper around the same site.
- **Storage:** IndexedDB through `idb`. Stores are `cars`, `upcs` (barcode →
  car links) and `queue` (photos waiting to be identified). See
  `lib/types.ts` for the `Car` shape.
- **Barcode reading:** the browser's built-in BarcodeDetector where it
  exists, ZXing otherwise (`lib/barcode.ts`).
- **Server routes** (`app/api/`): `identify` (Claude vision), `estimate`
  (value ranges), `upc` (shared barcode database), `entitlement` and
  `purchase/verify` (credits and Play purchases), `assetlinks` (served at
  `/.well-known/assetlinks.json` for the Play wrapper), `health`.
- **Key client files:**
  - `app/scan/page.tsx`: the scan screen and every scan path
  - `lib/catalogue.ts`: lookups, resolving a partial read to a release, photo URLs
  - `lib/commit.ts`: saving an identification, folding duplicates, learning barcodes
  - `lib/dedupe.ts`: what counts as "the same car" (toy number first)
  - `lib/drive.ts`, `components/AutoBackup.tsx`, `components/DriveBackup.tsx`: Drive backup
  - `components/CarPhoto.tsx`: which picture a car shows
  - `lib/display.ts`: sizing for the huge display numbers
- **Scripts:**
  - `node scripts/build-catalogue.mjs` rebuilds `public/catalogue.json`
    from the wiki (about a minute). Re-run it now and then for new releases.
  - `npm run icons` regenerates the app icons from `public/icon-source.png`.

### Environment variables (`.env.example` documents each one)

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Photo identification and value estimates (set) |
| `IDENTIFY_MODEL`, `IDENTIFY_EFFORT` | Model and effort for identification |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google Drive backup |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Barcode database, free tier, credits |
| `FREE_SCAN_LIMIT` | Free identifications per install |
| `TWA_PACKAGE_NAME`, `TWA_SHA256_FINGERPRINT` | Play Store wrapper |
| `PLAY_CREDIT_PACKS` | Which Play products grant how many identifications |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` | Verifying Play purchases |

---

## 5. Design rules (keep to these)

The app was restyled around three rules from a design video the owner
shared. New screens should follow them.

1. **One signal colour.** Red (`--signal`) means "tap this" and nothing
   else. Primary actions are filled red; other actions are red text; rows
   that open something end in a small red ›. Never use red for decoration
   or errors (errors are amber, `--warn`).
2. **Ink and paper.** Near-black surfaces separated by thin grey lines.
   Gold is the brand ink, used only for the one huge thing on a screen and
   for Treasure Hunt badges. Don't put gold borders on cards or inputs:
   that makes them look tappable.
3. **No middle sizes.** Exactly three type sizes: a huge condensed display
   face (Anton, via `next/font`), 15px text (`--text-size`) and 11px
   capitals for labels (`--label-size`). One huge thing per screen.
4. **Three planes.** The Garage, Stats and car pages each have a "stage":
   huge type at the back, the car photo overlapping it, the action button
   overlapping the photo (classes `.stage`, `.stage-subject`, `.fab`).

Icons are a hand-drawn line set in `components/icons.tsx` (24-unit grid,
1.9 stroke, round caps). The owner explicitly rejected emoji as looking
cheap; never put emoji in the interface.

---

## 6. Backlog and known issues

**Ideas for later:**

- A shared pool of users' own photos per release (needs file storage, for
  example Vercel Blob, and terms of use).
- An App Store version (native wrapper, Apple review, 30% fee on in-app
  credits). A web checkout such as Stripe is the alternative for iPhone.

**Known quirks:**

- The catalogue has some duplicate toy numbers for 2004–2010, where the
  wiki lists cars twice. The resolver handles it, but lookups there are
  less certain.
- Some wiki photos carry seller watermarks (the 2024 '83 Chevy Silverado
  Super Treasure Hunt, for one). The owner's own photo replaces them.
- On iPhone, Google's sign-in popup can misbehave inside a home-screen
  app; Drive backup there is untested.
- The owner's S25 Ultra camera shudders and clicks in every app, including
  Samsung's own camera. That is a hardware fault in the stabiliser (check
  for magnetic cases first), not an app bug.

---

## 7. Working on it

- Run locally: `npm install`, then `npm run dev` (or `npm run build` and
  `npm start`). Identification needs `ANTHROPIC_API_KEY` in `.env.local`.
- Checks: `npm run typecheck` and `npm run build`. There is no test suite
  in the repo; past changes were verified with Playwright scripts against
  a production build, using small mock servers for the Anthropic API and
  Redis. Rebuild those mocks when needed rather than calling the real API.
- Commit style: plain, descriptive messages explaining what changed for
  the user and why. Push to `main`; Vercel deploys it.

### Working with the owner

- The owner is not a developer and follows along on their phone. Explain
  outcomes in plain language, say exactly what they need to tap or set,
  and verify changes before reporting them done.
- They report problems with phone screenshots. Look at the screenshot
  carefully before changing anything.
- They prefer things built and shipped over long option lists, but want
  honest caveats, especially on legal (trademarks, photo rights) and cost.
