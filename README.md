# CarbonTree Payout Desk

Manual UPI refunds, start to finish. Upload a Return Prime export, and the orders that need paying by hand land in a shared ledger — grouped by the week they were approved, combined one row per order, with the UPI handle dug out of the notes column. Select a batch, work through the QRs one at a time, tick each one off. Everybody on the team sees the same ticks.

A Next.js app on Vercel, backed by Firebase, installable as an app on a phone.

---

## Why it looks the way it does

Three things drove most of the design.

**The payout happens on a phone.** You cannot scan a QR with the screen it is displayed on, so the laptop can only ever hand the payment to someone else. Installed on a phone, the app opens the payment directly in GPay, PhonePe or whatever else is on the device. That is why the QR sits *below* the amount and the Open-in-UPI-app button on a small screen, and beside them on a large one.

**Reads cost money, and the data barely changes.** The ledger is not a live feed; an export lands once a week. So the app opens from a local copy and bills nothing for it, and only talks to Firestore when you press Refresh — and then only asks for what changed since the last sync. A quiet day costs zero reads.

**A wrong payout is unrecoverable.** UPI has no chargeback. So the transform never silently inflates an amount: only lines it can justify are summed, everything it excluded stays visible with the reason, a cancelled shipment is flagged in red, and an order carrying two different handles says so rather than picking one quietly.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

It runs against the `payout-891fa` Firebase project out of the box. To point it somewhere else, copy `.env.local.example` to `.env.local` and fill it in.

Other scripts:

| Command | What it does |
|---|---|
| `npm test` | Runs the Return Prime transform against a fixture covering every awkward case |
| `npm run build` | Production build |
| `npm run lint` | ESLint, including the React Compiler rules |
| `npm run icons` | Redraws the app icons from `scripts/make-icons.py` |
| `npm run rules:deploy` | Pushes `firestore.rules` and `storage.rules` (needs the Firebase CLI) |

---

## Firebase setup

The app expects four things switched on in the Firebase console for the project.

1. **Authentication → Sign-in method → Google.** Enable it. Nothing else is needed; there is no password flow.
2. **Authentication → Settings → Authorized domains.** Add your Vercel domain (`your-app.vercel.app`, plus any custom domain). Sign-in fails silently without this, and it is the single most common cause of "the popup opens and closes again".
3. **Firestore Database.** Create it in the region closest to you (`asia-south1` for Mumbai). No collections need creating by hand — the first upload makes them.
4. **Storage.** Create the default bucket. Used only to archive the raw uploaded files.

Then deploy the rules:

```bash
npx firebase login
npx firebase use payout-891fa
npm run rules:deploy
```

**The rules are the access control, not the sign-in button.** `firestore.rules` and `storage.rules` both require a verified Google account whose email ends in `@carbontree.com`. Until they are deployed the project is running on Firebase's defaults, which are either wide open or fully locked depending on how the database was created. Deploy them before putting real customer data in.

Changing the company domain means changing it in three places: `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN`, `firestore.rules`, and `storage.rules`.

### Deploying to Vercel

Import the repo, accept the detected Next.js settings, deploy. No environment variables are required — the Firebase web config has working defaults compiled in. Set the `NEXT_PUBLIC_FIREBASE_*` variables only if you are pointing at a different project.

The Firebase web config is not a secret, despite containing a key called `apiKey`. Firebase is designed for it to ship in the browser bundle; what protects the data is the security rules. Do not spend effort hiding it.

---

## What lives where

```
orders/{orderNumber}      one document per order — the ledger, and the paid flag
batches/{batchId}         one per upload: who, when, what the file contained
payments/{autoId}         append-only log of every mark-paid and undo
uploads/… (Storage)       the original export files, untouched
```

**Orders are keyed by order number**, which is what makes overlapping exports safe. Upload June–August, then upload August–September, and the orders in the overlap are refreshed rather than duplicated. The upload write deliberately leaves out `paid`, `paidAt` and `paidByEmail` for orders that already exist, so an order you paid in August does not come back unpaid in September's file.

`updatedAt` is a server timestamp on every write, and it is the sync cursor. Refresh asks for `updatedAt > lastSeen`, so the cost of a refresh is proportional to what changed, not to the size of the ledger. "Full resync" on the Activity page throws the local copy away and re-reads everything — the escape hatch if a device ever gets out of step.

### Offline

Firestore's own IndexedDB cache is switched on, with multi-tab support. Three consequences worth knowing:

- Opening the app reads from disk, not the network. Zero billed reads.
- Marking a payout paid with no signal is queued locally and replays when the connection returns. You will not lose ticks in a basement.
- The service worker (`public/sw.js`) caches the app shell only. It deliberately does not touch Firebase traffic — the SDK's own cache is better at it, and intercepting it would break the write queue.

---

## The transform, precisely

Applied to line-item rows — one row per returned item.

A line is kept when **all three** hold:

- `requested_refund_mode` is `others` — the manual UPI bucket
- `refund_status` is not `refunded` — nobody is paid twice
- `status` is in the selected stage set (received + approved by default; the stages are checkboxes on the upload screen)

Then the UPI handle is recovered from `refund_additional_details`, because the export's own `upi` column arrives empty on every row. A handle is `something@bank` where the bank part has **no dots** — that one rule is what separates `rahul.verma@okaxis` from `rahul@gmail.com`, and it is worth the test that guards it.

Lines are then combined per order. A line counts toward the payable total only if it has a positive amount and its note does not say otherwise — `adjusted in another product`, `store credit`, `marketing`, `no refund needed`, `exchanged`, `alter and send`. Excluded lines are not dropped; they stay on the expanded row, tagged with the reason, so a ₹2,625 payout can be checked against the two pieces it came from.

Two columns are easy to confuse and are not the same thing: `status` is the return's own stage (requested → approved → received → inspected → archived), while `shipment_tracking_status` is where the courier is (Out for pickup, Returned to warehouse, Cancelled, Issue with pickup). A cancelled shipment that still carries a UPI handle shows a red chip — the goods never reached the warehouse, so it is worth a look before paying.

`npm test` pins all of this down against a fixture. It is ten seconds and it is the thing standing between a regex tweak and a refund sent to the wrong handle.

---

## Installing it on a phone

Open the deployed URL, then:

- **Android / Chrome** — an Install button appears in the app, or use the browser's "Install app" menu item.
- **iPhone / Safari** — Share, then Add to Home Screen. iOS does not offer an install button to the page; the app shows the instruction instead.

Installed, it runs full screen, keeps the ledger on the device, and opens payments straight into a UPI app.

---

## Project layout

```
src/app/                  routes — (app)/ is everything behind the sign-in gate
src/components/           the ledger, the pay desk, the uploader, the shell
src/lib/sheet/            parsing and the Return Prime transform (no React, no Firebase)
src/lib/data/orders.ts    every Firestore read and write, in one file
src/lib/store.tsx         the cached ledger and the pay queue
src/lib/firebase.ts       SDK setup, including the offline cache
scripts/                  the transform test and the icon generator
firestore.rules           access control — read this before trusting the app with data
```

`src/lib/sheet/` is deliberately free of React and Firebase. It can be run from a script, tested, and reasoned about on its own, which is why `npm test` is possible at all.

---

## What it does not do

- No automated disbursement. Every payout is opened or scanned by a person, on purpose.
- No writing back to Return Prime or Shopify, and no reconciliation against bank statements. Marking an order paid here records it here.
- No `.xls`/`.xlsx` parsing without a network on first use — the spreadsheet reader loads from a CDN on demand. CSV works offline.
- No push notifications. The manifest and service worker are in place if they are ever wanted.
