# My Dream Clean

A single-file Progressive Web App for running a solo cleaning business: a rotating two-week diary,
client management, invoicing with PDF generation, receipts, financial reporting and mileage
tracking — on the device, with no application server.

Built for iPhone use, added to the home screen as a PWA. Everything — markup, styles and all
application logic — lives in **`index.html`**. No build step, no bundler, no dependencies to
install.

---

## Status

**Version 1.2.0** — see `index.html`'s top-of-file comment, which is bumped alongside this line on
every delivery.

All eight planned build stages are complete, plus the additions made since:

| Stage | Area | Status |
|---|---|---|
| 1–2 | Foundations, design language, navigation | ✅ Done |
| 3 | Clients | ✅ Done |
| 4 | Diary / Planning, Home | ✅ Done |
| 5 | Home refinements (address on rows, quick-add receipt) | ✅ Done |
| 6 | Invoices (PDF generation, numbering, Dropbox archival) | ✅ Done |
| 7 | Receipts log, Summary reporting, mileage | ✅ Done |
| 8 | Settings (business profile, integrations, backup) | ✅ Done |
| — | Guided tours, one per page | ✅ Done |
| — | Sign-in and cloud snapshot backup (Supabase) | ✅ Done |
| — | Cross-day diary drag, salary log, message templates | ✅ Done |

**Not yet done — Stage 9 (integration pass):** a full pass on a real iPhone in standalone
(home-screen) PWA mode. iOS Safari's PWA mode has known quirks — `visualViewport` handling,
safe-area insets — documented inline in the code, and that is why this exists as its own step.

---

## Getting it running

1. Host `index.html` somewhere reachable over HTTPS. GitHub Pages is the easiest free option.
2. Open the URL on the iPhone in Safari and tap Share → **Add to Home Screen**, for the
   full-screen, no-browser-chrome experience the app is designed for.
3. Sign in. The app creates its own local database (IndexedDB) on the device on first launch —
   nothing to configure before using Clients, Diary, Home, Invoices or Receipts.

Two features need a free key from a third party before they will do anything. **Both degrade
gracefully without one** — nothing else in the app is blocked.

### OpenRouteService key (mileage)

Powers the driving-distance calculation behind the mileage figure on Summary.

1. Sign up free at **openrouteservice.org** and confirm the email.
2. Dashboard → **API Keys** → create a token.
3. Paste it into **Settings → Mileage → Save Mileage Key**.

A **home address** must also be set in Settings, since mileage is the return journey from home to
each appointment and back. Without both, mileage simply reads as unavailable.

### Dropbox App Key (automatic invoice archival)

Every generated invoice PDF is uploaded to `/Invoices/<financial year>/<month>/` in Dropbox as a
backup, as well as being saved on the device.

1. **dropbox.com/developers/apps** → Create app.
2. **Scoped access** → **App folder** access.
3. Under **Permissions**, tick `files.content.write` and `files.content.read`, then Submit.
4. Copy the **App key** into **Settings → Dropbox → Save App Key**, then **Connect Dropbox** and
   approve access.

Neither key is a secret in the usual sense: they identify the app to the service and grant nothing
on their own. Dropbox uses OAuth2 with PKCE precisely because there is no server here to hold a
client secret.

---

## What's in the app

Six tabs.

- **Home** — one day at a glance: each appointment's client, duration, and the address that was
  current *on that date*. Rows are sized proportionally to their duration. Call and Message buttons
  sit inline on any row whose client has a mobile number, with Message offering your saved
  templates. Weekends are skipped when stepping between days, and a holiday shows a banner instead
  of a list. Home is deliberately **view-only** — all editing lives on Diary.
- **Diary** — the recurring weekly planner, Mon–Fri as columns on a rotating **two-week A/B**
  schedule. Drag to reorder within a day, or onto a different day to move an appointment there: the
  target column highlights and a line shows exactly where it will land. One-off adjustments (cancel
  or move a single occurrence) never touch the recurring template — you are asked whether a change
  applies **just this once** or **from now on**.
- **Clients** — domestic or commercial, with a **versioned** hourly rate and address, payment
  method, phone, optional separate billing address, and the "Is Invoiced" flag that decides whether
  they ever appear on Invoices.
- **Invoices** — a live **Ready to Send** queue computed from completed appointments, with no
  manual data entry: a client/month pairing appears once that month has no further appointments to
  come. Generate a PDF with your logo, business details and bank payment instructions; numbering is
  sequential per financial year; then a pre-filled email send flow and Outstanding → Paid tracking.
  A queue entry can be swiped away if it should not be invoiced.
- **Summary** — Day / Week / Month / **UC period** / Year reporting: revenue, costs from receipts,
  mileage with the tiered UK allowance (45p per mile up to 10,000 miles in a financial year, 25p
  after), salary drawn, unpaid invoices, the value of invoices not yet generated, and an estimated
  profit. **Actual** and **Projected** modes decide whether future scheduled work counts. The Year
  view runs on the **UK tax year (6 April – 5 April)** and adds a month-by-month table. The full
  receipts log — add, edit, delete — lives here too.
- **Settings** — business profile (versioned, same as client fields), home address, the two
  integration keys above, holiday date ranges, salary payments, message templates, light/dark
  theme, account and password, cloud backup, and a full JSON export/import.

Every page carries a **?** button that runs a short guided tour of that page — a spotlight and a
tooltip, no central help hub.

**App icon** — a simplified version of the My Dream Clean logo (roofline, window grid, sparkle) on
solid navy, embedded directly in the file. The full logo's fine detail and text do not hold up at
icon sizes, so this is a deliberately bolder mark rather than a shrunk copy.

---

## A few rules worth knowing (they apply everywhere, not just where you'd expect)

- **Nothing that has already happened gets rewritten by a later edit.** Client rates, client
  addresses and business profile details are all *versioned* with from/to date ranges — so putting
  your rate up today leaves yesterday's invoice showing yesterday's rate. Leaving the "Effective
  from" box blank on an edit means **the change applies now**; type a date only to backdate or
  schedule one.
- **The financial year runs 1 April – 31 March**, labelled e.g. "2026/27", and is used for invoice
  numbering, the Dropbox folder structure and the mileage threshold. **Summary's Year view is the
  UK tax year (6 April – 5 April)** — deliberately a different window, because it answers a
  different question.
- **Mileage is always one out-and-back trip per working day** — home → appointment 1 → appointment
  2 → … → home, in the order set in Diary. It is never re-optimised for the shortest route, since
  that is not necessarily the route you will drive.
- **The past is immutable.** A past day cannot be dragged into, and a holiday day never renders a
  slot to drop into.
- **One shared rule decides whether an appointment is billable on a given date**, resolved against
  that date rather than today's values, and used identically by mileage, Summary and Invoices — so
  the three can never quietly drift apart.

---

## Architecture notes

- **All data lives on the device**, in IndexedDB, across five stores: clients, appointments,
  invoices, receipts and settings. There is no relational backend and no sync.
- **Sign-in is Supabase Auth**, and Supabase Storage holds **JSON snapshot backups** — one a day,
  automatically, plus Back Up Now and Restore from Cloud in Settings. That is the only thing the
  backend does: there are no relational tables for this app.
- **PDF generation is fully offline.** jsPDF is embedded directly in the HTML, not loaded from a
  CDN, so invoices generate with no signal.
- **Mileage is cached per day**, keyed to a fingerprint of that day's actual route, and recomputed
  only when the route really changes. The first time mileage is switched on it works through the
  financial-year-to-date backlog in the background, which can take a while with a few months of
  history; after that it is instant and costs no further API calls for unchanged days.
- **Single file, no build step.** A deliberate simplicity choice.

`TECHNICAL.md` is the implementation reference.

---

## Known limitations

- **No full on-device iOS pass yet** (Stage 9 above).
- **Postcode lookup** (postcodes.io) and **mileage routing** (OpenRouteService) both need a
  connection. Both fail gracefully: manual address entry still works, and mileage reads as
  unavailable.
- **The JSON backup import is a full replace, not a merge.** It wipes what is on the device and
  replaces it with the backup's contents. There is a confirmation step, and no undo afterwards. The
  same is true of Restore from Cloud.
- **Multi-device use is not supported.** This is a single-device app by design; the Dropbox
  connection covers wanting to see an invoice from a laptop, but two devices editing the same data
  will not converge.
- **The diary is Monday–Friday.** Weekends only ever hold one-off appointments, never a recurring
  template.
