# Garage — a Hot Wheels collection tracker

Point your phone at a card. The car ends up in your collection.

It runs as a web app on Vercel, so there is nothing to install — open the URL on
your phone and add it to your home screen. Everything is designed around the
fewest possible taps, because logging a few hundred cars by hand is the reason
most collection spreadsheets get abandoned.

## How logging a car works

There are three paths, and the app picks the fastest one available:

1. **A barcode you have scanned before** — the camera reads it and the car is
   added instantly. Zero taps, no network call, no cost. This is the path you
   will be on most of the time once your collection is established.
2. **A barcode you have not seen** — the app photographs the card and reads it:
   casting name, series, series number, collector number, year, Mattel toy
   number, colour, and whether it is a Treasure Hunt. You confirm and save.
3. **No barcode at all** — loose cars, damaged cards, a car already out of the
   package. Press the shutter and the photo alone is enough; the casting name
   and copyright year on the base of the car are usually readable.

You can always fall back to typing it in, and every identified field stays
editable before you save.

### Two scanning modes

- **Confirm each** — each card is identified and shown to you before saving.
  Good for careful logging of a handful of cars.
- **Rapid fire** — shoot a whole case without waiting. Photos are stashed on the
  device and identified in the background; you review the results in the garage
  afterwards. Photos survive app restarts and offline periods, so nothing is
  lost if you close the app mid-batch.

### One thing worth knowing about barcodes

Hot Wheels mainline singles frequently share a **single barcode across an entire
assortment** — dozens of different castings, one UPC. A barcode scanner alone
therefore cannot tell you which car you are holding, which is why most
barcode-only collection apps are frustrating to use with Hot Wheels.

This app handles it two ways:

- The **Mattel toy number** (a code like `HTB29`, printed small near the
  barcode) is what actually identifies a specific casting and colourway. It is
  the field the photo reader works hardest to capture, and it is what duplicate
  detection keys on.
- A barcode is treated as a **shortcut, not an identity**. The first time you
  scan one it gets linked to whatever car you save. If a barcode ends up linked
  to more than one car, the next scan shows you a short list to pick from
  instead of guessing.

## Duplicates

Duplicates are counted, not rejected — a `×3` badge on the car rather than three
rows. There is a **Duplicates** filter on the collection screen so you can see
your trade stock at a glance.

## Deploying it

You need a [Vercel](https://vercel.com) account (the free tier is plenty) and
the GitHub repo this code lives in.

1. In Vercel, choose **Add New → Project** and import
   `71spock346-blip/hotwheels`.
2. Leave every build setting at its default — Vercel detects Next.js.
3. Before deploying, open **Environment Variables** and add:

   | Name | Value |
   | --- | --- |
   | `ANTHROPIC_API_KEY` | a key from [console.anthropic.com](https://console.anthropic.com) → API Keys |

4. Deploy. Open the resulting `https://…vercel.app` URL on your phone and use
   **Add to Home Screen** so it opens full-screen like an app.

The camera only works over HTTPS. Vercel gives you that automatically; it will
not work if you try to serve the app over plain `http`.

### If you skip the API key

Everything still works except photo identification: barcode scanning, the
remembered-barcode fast path, manual entry, search, duplicates, stats and
export. The app tells you what is missing rather than failing silently, and you
can add the key later and redeploy.

### What identification costs

Each photo sent for identification costs roughly **2–3 US cents** at current
Anthropic API pricing. Barcodes you have already scanned cost nothing, so the
cost is per *new* car rather than per scan — logging a 500-car collection is on
the order of $10–15, and day-to-day additions after that are pennies.

## Your data

The collection is stored **on your phone**, in the browser's local database. It
works offline and no collection data is uploaded anywhere. The only thing that
leaves the device is a photo, sent to Anthropic when a car needs identifying.

The trade-off is that clearing your browser's site data will wipe the
collection. The **Stats** tab has:

- **Download backup (JSON)** — complete, thumbnails included, restores exactly.
- **Export spreadsheet (CSV)** — for Excel, Google Sheets, insurance lists.
- **Restore from a backup** — merges a backup file back in.

Take a backup occasionally, and after any big logging session.

## Putting it on the Google Play Store

The app ships as a Trusted Web Activity: a thin Android wrapper around this
same site, which is Google's own supported way to publish a web app. The code
here already includes what that needs.

**Before you start**, know the two real gates:

- A Google Play developer account costs **$25, one time**.
- If you register a **personal** (not organisation) account, Google requires a
  closed test with **at least 12 testers opted in continuously for 14 days**
  before you may apply for production access. Budget weeks, not days.

**The steps:**

1. Deploy to Vercel and confirm the site works on your phone.
2. Set a real contact address in `app/privacy/page.tsx` (`CONTACT_EMAIL`).
   Play rejects placeholder contact details.
3. Generate the Android package. The easiest route is
   [PWABuilder](https://www.pwabuilder.com) — paste your URL, choose Android,
   download the package. The command-line alternative is Google's
   [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap):
   ```bash
   npm install -g @bubblewrap/cli
   bubblewrap init --manifest https://YOUR-APP.vercel.app/manifest.json
   bubblewrap build
   ```
4. Upload the resulting `.aab` to the Play Console and enrol in Play App
   Signing.
5. Play Console → *Test and release → Setup → App signing* gives you a
   **SHA-256 certificate fingerprint**. Add it in Vercel alongside the package
   name:

   | Variable | Example |
   | --- | --- |
   | `TWA_PACKAGE_NAME` | `com.yourname.garage` |
   | `TWA_SHA256_FINGERPRINT` | `AB:CD:…` (comma-separate if Play lists several) |

   Redeploy, then check `https://YOUR-APP.vercel.app/.well-known/assetlinks.json`
   returns your package rather than `[]`. Without this the app runs but keeps a
   browser URL bar pinned to the top.
6. Complete the store listing: privacy policy URL (`/privacy`), data safety
   form (declare the camera and that photos go to a third party for
   processing), content rating, icon, feature graphic and screenshots.

### Before you publish publicly

Identification runs on **your** API key. On a private URL that is fine. Listed
on Play, every install's photos bill to you, and `/api/identify` is an open
endpoint anyone can call. Decide how that is paid for before going public —
per-install rate limiting, a subscription, or having each user supply their own
key in settings.

## Running it locally

```bash
npm install
cp .env.example .env.local   # then put your key in it
npm run dev
```

Then open <http://localhost:3000>. Note that the **camera will not open on
`localhost` in most mobile browsers** — for real scanning, test against the
deployed Vercel URL. On desktop you can still use "choose a photo" to exercise
the identification path.

Useful commands:

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript, no emit |
| `npm run icons` | Regenerate the PWA icons |

## How it is put together

```
app/
  page.tsx              Collection: search, filters, duplicate and hunt views
  scan/page.tsx         Camera, live barcode reading, capture and confirm
  stats/page.tsx        Breakdowns, failed-photo review, backup and export
  car/[id]/page.tsx     Edit or remove one car
  api/identify/route.ts Server route that reads a card photo
lib/
  barcode.ts            Native BarcodeDetector, with a ZXing fallback
  db.ts                 IndexedDB: cars, barcode links, photo queue
  dedupe.ts             Toy-number-first matching for duplicates
  commit.ts             Adding an identified car to the collection
  image.ts              Frame capture, resizing, thumbnails
  export.ts             CSV, JSON backup and restore
components/
  QueueRunner.tsx       Drains the background photo queue app-wide
```

Barcode reading uses the browser's native `BarcodeDetector` where it exists
(Android Chrome), and lazily loads ZXing where it does not (every iPhone). The
decoder is only downloaded on the devices that need it.

Card reading uses Claude (`claude-opus-5`) with a constrained JSON schema, so
the route always returns the same fields and unreadable ones come back empty
rather than invented. The prompt is explicit that a blank field beats a
confident wrong guess — a wrong toy number is worse than no toy number, because
it silently breaks duplicate detection.
