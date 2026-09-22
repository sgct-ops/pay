# CarbonTree Payout Desk

Manual UPI refunds, from a Return Prime export to money leaving the account, with two people and a clear line between them.

**Operations** uploads the export, checks each order, fixes what the export got wrong, and approves what should be refunded. **Accounts** sees only what has been approved, and pays it. Neither can do the other's step — and that is enforced by the database, not by hiding buttons.

A Next.js app on Vercel, backed by Firebase, installable as an app on a phone.

---

## Why it looks the way it does

**The payout happens on a phone.** You cannot scan a QR with the screen it is displayed on, so a laptop can only ever hand the payment to someone else. Installed on a phone, the app opens the payment straight into Google Pay, PhonePe, Paytm or BHIM. That is why the phone pay screen leads with the amount and a large *Pay with…* button, keeps the QR small and secondary, and fits on one screen with nothing to scroll.

**A wrong payout is unrecoverable.** UPI has no chargeback. So: the transform never silently inflates an amount, the approval step is a different pair of hands from the payment step, and a re-upload that changes an amount pulls its approval back for a second look.

**Reads cost money, and the data barely changes.** An export lands once a week. The app opens from a local copy and bills nothing for it; only Refresh talks to Firestore, and then only asks for what changed since the last sync.

---

## The two desks

| | Operations | Accounts |
|---|---|---|
| Upload an export | ✔ | — |
| See pending, held and rejected orders | ✔ | — |
| Fix a wrong or missing UPI handle | ✔ | — |
| Change an amount | ✔ | — |
| Approve / hold / reject | ✔ | — |
| See approved refunds | ✔ | ✔ |
| Build a QR and mark paid | — | ✔ |
| Send a failed transfer back | — | ✔ |

`shantanu@carbontree.com` is admin: both desks, plus the **admin panel** and the full audit trail, and a *Work as* switcher in the avatar menu for seeing exactly what each role sees.

Seeded roles, changeable on the People screen without a redeploy:

- `shantanu@carbontree.com` — admin (pinned in code and in the rules, so the People screen can never lock you out)
- `operations@carbontree.com` — operations
- `accounts@carbontree.com` and `contact@carbontree.com` — accounts

### How an order moves

```
upload → pending → approved → paid
              ↘ hold (with a reason)
              ↘ rejected (with a reason)
```

Operations can correct the UPI handle or the amount before approving. Corrections never overwrite what the export said — the imported values stay underneath, the ledger shows "corrected", and accounts can see what it was. A held order carries the reason, which is what stops two people chasing the same customer.

If accounts hits a bounced transfer, **Payment failed** sends the order back with a reason. It stays approved, flagged, and shows up on the operations ledger.

---

## The admin panel

`/admin`, admin only. Six tabs, one save.

| Tab | What it holds |
|---|---|
| **Overview** | What the desk is doing right now, every rule in force, and what an admin deliberately *cannot* change |
| **People** | Who is allowed in and which desk they work — the old `/people` screen, which now redirects here |
| **Payouts** | The ceiling, the warning threshold, when an approval must carry a reason, whether a cancelled shipment blocks approval |
| **Transform** | Default return stages, and the list of notes that mean "not a payout" — with a box to paste a real note and see which rule catches it |
| **Payments** | The tag on every payout note, the note length limit, which UPI app opens by default, whether ad-hoc payees are allowed |
| **Data** | Ledger and audit-trail CSV export, upload history, sync staleness, full resync, and the read-only environment |

Settings live in one document, `settings/app`, watched live — a ceiling set on a laptop reaches the phone paying refunds without a reload. Everything else on the panel edits an in-memory draft and writes nothing until **Save**; a guardrail that took effect halfway through being typed would be worse than none. People is the exception, because each role change is individually meaningful and gets its own audit entry.

Every change is written to the same append-only trail as approvals and payments, and the entry names the figures: `ceiling ₹10,000 → ₹25,000`, not "settings changed".

### The guardrails are enforced by the database

The amount limits, the cancelled-shipment check and the required-reason threshold are **not** UI validation. They are in `firestore.rules`, checked at the moment an order becomes approved:

```
allow update: if isOps()
  && !touched().hasAny(moneyKeys())
  && (!approvingNow() || withinGuardrails());
```

So an operations session that skipped the screen is refused by Firestore, exactly as an accounts session that tried to raise an amount already is. `blockingReason()` in `src/lib/order-view.ts` explains the refusal; the rules perform it — **if you change one, change the other, or the button will lie.**

Two deliberate limits on the ceiling:

- It applies **only at the moment of approving**. Lowering it later does not unapprove anything, and does not break re-uploading an order approved under the old ceiling. Pull those back on the ledger if that is what you want — the Payouts tab tells you how many there are.
- It is measured on what would actually be **paid** — a correction operations made, not whatever the export said. `payable()` in the rules mirrors `payAmount()` in the code.

### What no setting can do

- Grant accounts the ability to approve, or operations the ability to pay.
- Change the owner address, which is pinned in code and in the rules.
- Edit or delete an audit entry, or delete an order.
- Delete the settings document. Turning a guardrail off means setting it to 0, visibly.

### Defaults

An unconfigured project behaves exactly as the app did before the panel existed: no ceiling, no warning, no required reason, cancelled shipments flagged but approvable, the same six exclusion rules, `CARBONTREE` as the tag. `mergeSettings` coerces anything malformed back to those defaults rather than letting a string reach a refund ceiling — `npm test` pins that.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

Before starting locally, copy `.env.local.example` to `.env.local` and fill in the Firebase values for your project. The app refuses to start with missing configuration rather than silently targeting another Firebase project.

| Command | What it does |
|---|---|
| `npm test` | Runs the Return Prime transform against a fixture covering every awkward case, then the desk-settings coercion and validation checks |
| `npm run test:rules` | Runs `firestore.rules` against the Firestore emulator — the two-desk split, the guardrails, the audit trail. Needs Java |
| `npm run build` | Production build |
| `npm run lint` | ESLint, including the React Compiler rules |
| `npm run icons` | Redraws the app icons from `scripts/make-icons.py` |
| `npm run rules:deploy` | Pushes `firestore.rules` (needs the Firebase CLI) |

---

## Deploying

### Vercel, on every push

1. In Vercel, **Add New → Project**, import `sgct-ops/pay`. Under **Environment Variables**, add every `NEXT_PUBLIC_...` variable from `.env.local.example` with the values from your Firebase project. Select **Production**; also select **Preview** if preview deployments need Firebase sign-in. Then deploy.
2. That import *is* the automatic deployment — Vercel installs a GitHub app and from then on every push to `main` builds and goes live, and every push to another branch gets its own preview URL. There is nothing else to wire up, and no deploy token to keep in GitHub secrets.
3. Add the resulting domain to **Firebase → Authentication → Settings → Authorized domains**, or sign-in will fail silently.

`.github/workflows/ci.yml` runs the transform test, the linter and a build on every push, in parallel with Vercel's own build. Vercel tells you the deploy succeeded; CI tells you the code is sound.

### Firebase, once

1. **Authentication → Sign-in method → Google.** Enable it.
2. **Authentication → Settings → Authorized domains.** Add your Vercel domain and any custom domain.
3. **Firestore Database.** Create it — `asia-south1` (Mumbai) is closest. No collections need making by hand.
4. Deploy the rules:

```bash
npx firebase login
npm run rules:deploy
```

There is no step for Firebase Storage, because nothing is written to it. An
export is transformed in the browser and the ledger goes to Firestore; the
original file, if the uploader keeps it, stays on their own machine. The project
is pinned in `.firebaserc`, so `--project` is not needed.

**Redeploy the rules after changing anything in this section, and after pulling a change that touches `firestore.rules`.** The admin panel needs the `settings/app` rule; without it the panel runs read-only on the defaults and says so.

**Deploy the rules before putting real data in.** They are the access control — the React code only decides what to show. Until they are deployed the project runs on Firebase's defaults, which are either wide open or fully locked depending on how the database was created.

Changing the company domain means changing it in two places: `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN` and `firestore.rules`.

The Firebase web config is not a secret, despite containing a key called `apiKey`. Firebase is designed for it to ship in the browser bundle; the rules are what protect the data.

---

## What lives where

```
orders/{orderNumber}      the ledger: the order, the decision, the correction, the payment
batches/{batchId}         one per upload: who, when, what the file contained
events/{autoId}           append-only audit trail of every decision and payment
roles/{email}             who is operations, who is accounts
settings/app              one document: the guardrails and the desk's own rules
```

The original export files are not in this list, and not in Firebase at all. A
kept copy sits in IndexedDB in the uploader's own browser and deletes itself 90
days after the upload — it is there to answer "where did this figure come from"
while that question is still live, and a raw export is customer PII that stops
earning its keep long before the ledger does. `src/lib/archive.ts` is the whole
of it. Admin → Data lists what this device is holding and can download or drop
any of it.

**Orders are keyed by order number**, which is what makes overlapping exports safe: upload June–August, then August–September, and the overlap is refreshed rather than duplicated. The upload write leaves out the payment fields *and* the approval fields for orders that already exist, so no file can quietly mark something approved or paid. The one exception is a material change — if a new export moves the amount or the handle on an already-approved order, the approval is pulled back to pending and the ledger says why.

`updatedAt` is a server timestamp on every write and doubles as the sync cursor. Refresh asks for `updatedAt > lastSeen`, so a refresh costs what changed, not the size of the ledger. **Full resync** on the Activity screen throws the local copy away and re-reads everything.

### How the split is actually enforced

In `firestore.rules`, an update to an order is checked field by field:

- Operations may change anything **except** `paid`, `paidAt`, `paidByEmail`.
- Accounts may change **only** those fields (plus a failure reason), only when `approval == 'approved'`, and only if the amount and handle are unchanged in the same write.

So an accounts session that tried to raise an amount on its way to paying would be refused by the database, not by the UI.

### Offline

Firestore's own IndexedDB cache is on, with multi-tab support:

- Opening the app reads from disk. Zero billed reads.
- Marking a refund paid with no signal is queued locally and replays when the connection returns.
- `public/sw.js` caches the app shell only and deliberately never touches Firebase traffic — the SDK's cache is better at it, and intercepting it would break the write queue.

---

## The transform, precisely

Applied to line-item rows — one row per returned item.

A line is kept when **all three** hold:

- `requested_refund_mode` is `others` — the manual UPI bucket
- `refund_status` is not `refunded` — nobody is paid twice
- `status` is in the selected stage set (received + approved by default; the stages are checkboxes on the upload screen)

The UPI handle is then recovered from `refund_additional_details`, because the export's own `upi` column arrives empty on every row. A handle is `something@bank` where the bank part has **no dots** — that single rule is what separates `rahul.verma@okaxis` from `rahul@gmail.com`, and it is worth the test that guards it.

Lines are combined per order. A line counts toward the payable total only if it has a positive amount and its note does not say otherwise — `adjusted in another product`, `store credit`, `marketing`, `no refund needed`, `exchanged`, `alter and send`. Those six are the defaults; they are editable on the admin panel's **Transform** tab, matched literally rather than as regular expressions, and `npm test` pins the defaults to the exact behaviour the old regexes had. Excluded lines are not dropped; they stay on the expanded row with the reason, so a ₹2,625 payout can be checked against the two pieces it came from.

`status` (the return's own stage) and `shipment_tracking_status` (where the courier is) are different columns and easy to confuse. A cancelled shipment that still carries a handle gets a red chip — the goods never reached the warehouse, so it is worth a look before approving. An admin can turn that chip into a refusal on the **Payouts** tab.

`npm test` pins all of this down against a fixture. It takes ten seconds and it is the thing standing between a regex tweak and a refund sent to the wrong handle.

---

## On a phone

Open the deployed URL, then:

- **Android / Chrome** — an Install button appears in the app, or use the browser's "Install app" menu item.
- **iPhone / Safari** — Share, then Add to Home Screen.

The pay screen is built to fit one viewport with nothing to scroll: who and how much at the top, a small QR for handing the payment to another device, then a full-width *Pay with…* button and large, well-separated Mark-paid and step controls.

**Choosing the UPI app** — the button next to *Pay with…* opens a picker: Any UPI app, Google Pay, PhonePe, Paytm, BHIM. The choice is remembered, so a run of twenty refunds is one tap each instead of a chooser every time. Every app understands the same payment query; only the URL scheme differs (see `src/lib/upi-apps.ts`). If a chosen app is not installed, the phone has no way to tell the page — nothing happens, and the picker keeps *Any UPI app* one tap away.

---

## Project layout

```
src/app/                  routes — (app)/ is everything behind the sign-in gate
src/components/           Ledger (operations), Refunds (accounts), PayDesk, Uploader
src/components/admin/     the admin panel, one file per tab
src/lib/sheet/            parsing and the Return Prime transform — no React, no Firebase
src/lib/data/orders.ts    every Firestore read and write, in one file
src/lib/roles.ts          who can do what
src/lib/settings.ts       the desk settings, their defaults, coercion and validation
src/lib/settings-context.tsx  the live settings document, read once and watched
src/lib/csv.ts            ledger and audit-trail export
src/lib/order-view.ts     payAmount() / payUpi() — always use these, never `total` and `upi`
src/lib/store.tsx         the cached ledger and the pay queue
firestore.rules           the real access control — read this before trusting the app with data
scripts/                  the transform test, the settings test, the rules test, the icon generator
```

`src/lib/sheet/` is deliberately free of React and Firebase, which is why `npm test` is possible at all.

---

## What it does not do

- No automated disbursement. Every payout is opened or scanned by a person, on purpose.
- No writing back to Return Prime or Shopify, and no reconciliation against bank statements.
- No `.xls`/`.xlsx` parsing without a network on first use — the spreadsheet reader loads from a CDN on demand. CSV works offline.
- No push notifications. The manifest and service worker are in place if they are ever wanted.
- No per-person permissions beyond the three roles. The split is the product; a matrix of checkboxes would dissolve it.
