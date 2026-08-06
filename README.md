# My Dream Clean

A single-file Progressive Web App for running a solo/small cleaning business: diary planning, client management, invoicing with PDF generation, receipts, financial-year reporting, and mileage tracking — all on-device, no backend server.

Built for iPhone use (added to the home screen as a PWA). Single file: `mdc-index.html`. No build step, no server — open it in a browser or host it as a static file (GitHub Pages works well).

---

## Status

All eight planned build stages are complete:

| Stage | Area | Status |
|---|---|---|
| 1–2 | Foundations, design language, navigation | ✅ Done |
| 3 | Clients | ✅ Done |
| 4 | Diary / Planning, Home | ✅ Done |
| 5 | Home refinements (address on rows, quick-add receipt) | ✅ Done |
| 6 | Invoices (PDF generation, numbering, Dropbox archival) | ✅ Done |
| 7 | Receipts log, Summary reporting, mileage | ✅ Done |
| 8 | Settings (business profile, integrations, backup) | ✅ Done |

**Not yet done — Stage 9 (Integration pass):** on-device testing on an actual iPhone in standalone (home-screen) PWA mode. Everything so far has been tested in a desktop-sized headless browser with touch-event simulation; iOS Safari's PWA mode has known quirks (documented inline in the code, e.g. `visualViewport` handling, safe-area insets) that are the reason this pass exists as its own step before calling the build finished. Recommended next step before daily use.

---

## Getting it running

1. Download `mdc-index.html`.
2. Host it somewhere reachable over HTTPS — GitHub Pages is the easiest free option (push it to a repo, enable Pages in the repo settings, done).
3. Open the URL on your iPhone in Safari, tap Share → **Add to Home Screen**. This gives you the full-screen, no-browser-chrome PWA experience the app is designed for.
4. First launch creates its own local database (IndexedDB) on the device — nothing to configure to start using Clients/Diary/Home/Invoices/Receipts.

Two features need a free API key from a third party before they'll do anything (both degrade gracefully without one — nothing else in the app is blocked):

### OpenRouteService key (for mileage)
Powers the driving-distance calculation behind the mileage allowance figure on Summary.

1. Go to **openrouteservice.org** → Sign up (free, just an email + password).
2. Confirm your email.
3. Dashboard → **API Keys** → Create a token, name it anything.
4. Copy the key into **Settings → Mileage → Save Mileage Key**.

You'll also need a **home address** set in Settings — mileage is calculated as the return journey from home to each appointment and back, so both are required before any mileage figure appears.

### Dropbox App Key (for automatic invoice archival)
Every generated invoice PDF is silently uploaded to a `/Invoices/<financial year>/<month>/` folder in Dropbox as a backup, in addition to being saved locally.

1. Go to **dropbox.com/developers/apps** → Create app.
2. Choose **Scoped access** → **App folder** access.
3. Name it anything, e.g. "My Dream Clean Invoices."
4. Under **Permissions**, tick `files.content.write` and `files.content.read`, then Submit.
5. Copy the **App key** from the Settings tab into **Settings → Dropbox → Save App Key**, then tap **Connect Dropbox** and approve access.

Neither key is a secret in the traditional sense (both are safe to type into the app or share) — they identify the app to the service, they don't grant access on their own.

---

## What's in the app

- **Home** — today's (or any day's) appointments at a glance: client, duration, and the address that was current on that date. Quick-add button for logging a receipt on the spot.
- **Diary** — the recurring weekly planner. Two-week A/B rotation, drag-to-reorder within a day, one-off adjustments (cancel/move a single occurrence) that never touch the recurring template.
- **Clients** — domestic or commercial, with versioned hourly rate and address (so past diary days and past invoices always reflect what was true at the time, even after a later change), payment method, and the "Is Invoiced" flag that determines whether they ever appear on the Invoices page.
- **Invoices** — a live "Ready to Send" queue computed from completed appointments (no manual data entry), PDF generation with your logo/business details/bank instructions, sequential per-financial-year numbering, a pre-filled email send flow, and Outstanding → Paid status tracking.
- **Summary** — Day/Week/Month/Year reporting: revenue, costs (from receipts), mileage with the tiered UK allowance (45p/mile up to 10,000 miles per financial year, 25p after), and a rough profit estimate. The full receipts log (add/edit/delete) lives here.
- **Settings** — business profile (versioned, same as client fields), home address, the two integration keys above, holiday date ranges (appointments inside a holiday are skipped, not rescheduled), light/dark theme, and a full JSON backup export/import for disaster recovery.
- **App icon** — a simplified version of the My Dream Clean logo (roofline, window grid, sparkle) on a solid navy background, embedded directly in the file as the home-screen/tab icon. The full logo's fine detail and text don't hold up at icon sizes, so this is a deliberately bolder, simpler mark rather than a shrunk copy of the original.

---

## A few business rules worth knowing (they apply everywhere, not just where you'd expect)

- **Cash-paying or £0-rate clients are excluded** from mileage, from every figure on Summary, and from the Invoices page entirely — but stay fully visible and usable in Home and Diary. This is a single shared rule (`isBillableClientOnDate` in the code) rather than being checked separately in each place, so it can't drift out of sync between pages.
- **Nothing that's already happened gets rewritten by a later edit.** Client rates, client addresses, and business profile details are all "versioned" (from/to date ranges) — so if you put your rate up today, yesterday's invoice still shows yesterday's rate, and today's invoice shows today's. When you leave the "Effective from" box blank on an edit, the change applies immediately (from today); type a specific date only if you want to backdate or schedule a change.
- **Financial year runs 1 April – 31 March**, labelled e.g. "2026/27" — used for invoice numbering, the Dropbox folder structure, and Summary's Year view.
- **Mileage is always one out-and-back trip per working day** — home → appointment 1 → appointment 2 → ... → home, in the fixed order set in Diary. It's never re-optimised for the shortest route, since that's not necessarily the route you'll actually drive.

---

## Architecture notes

- **No backend, ever.** Everything lives in the browser's IndexedDB on the device. This is why Dropbox uses the OAuth2 + PKCE flow (designed for apps with no server to hold a secret) rather than a simpler API-key-only integration.
- **PDF generation is fully offline.** jsPDF is embedded directly in the HTML file (not loaded from a CDN), so invoices generate even with no signal.
- **Mileage is cached per day**, not recalculated on every visit to Summary — each day's route is computed once (via OpenRouteService) and reused until that day's appointments actually change. The first time you turn mileage on, it'll need to work through the financial-year-to-date backlog, which can take a little while if there's a few months of history; after that it's instant.
- **Single file, no build step.** Everything — markup, styles, and all application logic — lives in `mdc-index.html`. This was a deliberate simplicity choice: no bundler, no dependencies to install, just open the file.

---

## Known limitations / things to be aware of

- **No on-device iOS testing yet** (see Stage 9 above) — some iOS-specific PWA quirks may still need addressing once tested on an actual phone.
- **Postcode lookup** (postcodes.io) and **mileage routing** (OpenRouteService) both need an internet connection to work; both fail gracefully (manual entry still works, mileage just shows as unavailable) if offline or unconfigured.
- **The JSON backup import is a full replace, not a merge.** Importing a backup wipes everything currently on the device and replaces it with the backup's contents. There's a confirmation step before this happens, but there's no undo after.
- **Multi-device use isn't supported** — this is a single-device (phone) app by design. The Dropbox connection covers the rare case of needing to see an invoice from a laptop, but there's no sync between two phones or a phone-and-laptop editing the same data.
