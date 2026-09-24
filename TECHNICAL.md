# My Dream Clean — Technical Documentation

Implementation-level detail. README.md stays user-facing — what the app does; this is how it is
built and why. **Update this alongside README.md whenever a change touches how something is
*built*, not just what it *does*.**

---

## Table of contents

1. [Shape of the file](#1-shape-of-the-file)
2. [Storage](#2-storage)
3. [Dates, financial years and tax years](#3-dates-financial-years-and-tax-years)
4. [Versioned fields](#4-versioned-fields)
5. [The appointment model](#5-the-appointment-model)
    - [5.1 Historic corrections (v1.3.0)](#51-historic-corrections-v130)
6. [Diary — drag/drop model](#6-diary--dragdrop-model)
7. [Shell, navigation and modals](#7-shell-navigation-and-modals)
8. [Design system](#8-design-system)
9. [Module: Home](#9-module-home)
10. [Module: Clients](#10-module-clients)
11. [Addresses and postcode lookup](#11-addresses-and-postcode-lookup)
12. [Module: Invoices](#12-module-invoices)
    - [12.1 Drift, amend and void/re-issue (v1.4.0)](#121-drift-amend-and-voidre-issue-v140)
13. [PDF generation and file handling](#13-pdf-generation-and-file-handling)
14. [Dropbox archival](#14-dropbox-archival)
15. [Module: Summary](#15-module-summary)
16. [Mileage](#16-mileage)
17. [Module: Settings](#17-module-settings)
18. [Auth](#18-auth)
19. [Backup and restore](#19-backup-and-restore)
20. [The tour engine](#20-the-tour-engine)
21. [Boot order](#21-boot-order)
22. [Conventions and gotchas](#22-conventions-and-gotchas)
23. [Versioning](#23-versioning)

---

## 1. Shape of the file

One file, `index.html`, in four parts:

| Part | What |
|---|---|
| `<style>` | The whole design system — tokens, layout, nav, typography, dividers, flat rows, modals, form controls, the diary grid, Summary, Invoices, the tour overlay and the auth gate |
| `<body>` | Six `.screen` divs (`#screen-home`, `-diary`, `-clients`, `-invoices`, `-summary`, `-settings`), every modal, the nav, and the auth gate above it all |
| bundled libs | **jsPDF**, minified and embedded inline — not from a CDN, so invoices generate with no signal |
| application `<script>` | Everything else, in rough dependency order: date helpers → versioning → IndexedDB → theme/nav/modal plumbing → the tour engine → Clients → Diary/Home → Invoices → Summary/mileage → Settings → auth and cloud backup → boot |

There is no build step and no bundler. The Supabase client is the one runtime import
(`import('https://esm.sh/@supabase/supabase-js@2')`, dynamic, inside `initSupabaseAuth`), so a
first paint never waits on it.

---

## 2. Storage

IndexedDB, database `mydreamclean`, version 1, five object stores, each keyed on `id`:

```js
const DB_STORES = ['clients', 'appointments', 'invoices', 'receipts', 'settings'];
```

`getDB()` memoises one open promise; `dbPut` / `dbGet` / `dbGetAll` / `dbDelete` are the only
access paths, each wrapping one transaction. `uuid()` prefers `crypto.randomUUID()` with a v4
fallback.

**`settings` is a single record** holding the business profile histories, home address, API keys,
holidays, invoice counters, the mileage cache, dismissed queue entries, salary payments and
message templates. `ensureAppSettings()` creates it with `defaultBusinessSettings()` on first run
and backfills any key a newer version expects.

Everything the app reads is loaded into `appState` at boot (`loadClients`, `loadAppointments`,
`loadInvoices`, `loadReceipts`, `ensureAppSettings`) and written back through the `db*` helpers as
it changes. There is no relational backend — see §18–§19 for what the server actually does.

---

## 3. Dates, financial years and tax years

**Every date in the app is a `'YYYY-MM-DD'` string**, and every comparison is a string comparison
(`compareDateStr`). `toLocalDateStr` / `parseLocalDateStr` / `getLocalToday` / `addDays` are the
only conversions, and they build and read **local** date components — never
`new Date().toISOString().slice(0,10)`, which rolls the calendar date back a full day during BST.

Two different year windows exist, on purpose, and they are not interchangeable:

| Window | Runs | Used for |
|---|---|---|
| **Financial year** (`getFinancialYear`) | 1 Apr – 31 Mar, labelled `2026/27` | Invoice numbering, the Dropbox folder structure, the mileage tier threshold |
| **UK tax year** (`getUKTaxYear`) | 6 Apr – 5 Apr | Summary's **Year** view and its month-by-month table |

They differ by five days, deliberately: the first is the business's own bookkeeping year, the
second is the real HMRC self-employment year.

---

## 4. Versioned fields

Client hourly rate, client address (and the whole client "card" snapshot), and the business
profile's name, address and bank details are all **versioned**:

```js
history: [{ from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' | null, value }]   // null `to` = currently active
```

- `createInitialVersionedHistory(value, fromDate)` opens the first record.
- `resolveVersionedValue(history, onDate)` finds the record active on a date — used by **every**
  historic calculation (mileage, invoices, revenue), so a later change never retroactively alters
  past figures.
- **`endVersionedRecord(history, endDate, newValue)` is the ONLY mutation path.** Records are
  therefore contiguous with no gaps or overlaps *by construction*: closing a record at `endDate`
  always opens the next at `endDate + 1 day`.
- `repairVersionedHistory(history)` is the self-healing pass for older data.

> **A blank "Effective from" means yesterday, not today.** Every call site used to fall back to
> *today*, which leaves the OLD value in force *through* today and the NEW value effective
> tomorrow — backwards from what leaving the field blank should mean. Falling back to **yesterday**
> makes a same-day edit take effect immediately. An explicitly typed date is unaffected: it still
> means "the old value held through this date".

> **Same-day edge case.** If the current record already starts *today* (created today, or already
> edited once today), the yesterday-fallback would try to end it a day before it began. There is no
> earlier "today" version to split off, so the edit **overwrites the current record in place** and
> pulls its start date back to today — self-healing any stale future date as it goes. Any other
> date-before-start case (a genuine typo) still raises.

---

## 5. The appointment model

Two record types live in `appointments`, and the difference drives most of the diary's behaviour:

| | `adhoc` | `template` |
|---|---|---|
| Identified by | its own literal `date` | `template` (week letter A/B) + `dayOfWeek` |
| Date | stored | **derived** — "today's occurrence" is never a record you can point at |
| Lifetime | one day | `effectiveFrom` → `effectiveTo` (null = still active) |
| Skipping one day | delete it | add the date to `cancelledDates` |
| Ordering | `slotOrder` | `slotOrder`, overridable per date via `orderOverrides[date]` |

`getOccurrencesForDate(dateStr)` resolves what actually shows:

- **Weekends only ever show ad-hoc entries**, never a template.
- Weekdays resolve the active template version for that day-of-week and week letter, excluding
  `cancelledDates`, then add any ad-hoc entry on that exact date.
- The result is sorted by `effectiveSlotOrder(appt, dateStr)` — an `orderOverrides[date]` entry if
  one exists, otherwise the record's own `slotOrder`.

`getWeekLetter(dateStr)` derives A or B from the Monday of that week, so the rotation needs no
stored calendar.

`applyTemplateEditForward(appt, effectiveDate, changes)` is how a "from now on" change is made: it
closes the current template version at `effectiveDate - 1` and opens a new one carrying the
changes, so weeks already past keep what was true then.

**Day capacity** is a display heuristic, not data. `dayUsedHours` sums a day's durations (a holiday
is zero), `weekTotalHours` sums Mon–Fri, and `emptySlotCount` floors the hours left in an assumed
10-hour day — so a gap that would only fit 30 minutes never shows a slot.

**One shared billability rule.** `isBillableClientOnDate(client, dateStr)` is the single check used
by mileage, Summary and the invoice queue alike, resolved against the **appointment's own date**
rather than today's values — so what was true at the time is what counts. It exists as one function
precisely so the three cannot drift apart; if a new surface needs the same question answered, call
it rather than re-deriving it.

### 5.1 Historic corrections (v1.3.0)

Before v1.3.0 a past occurrence could not be opened at all: `renderDiaryWeek` rendered past chips
with no `onclick`, and the ad-hoc edit/delete paths bailed out with `"Past appointments can't be
edited."`. The only way to fix a wrong historic duration was to export the JSON backup, hand-edit
it and re-import — which is a **full replace** of everything on the device (§19), losing anything
done since the export. That is a bad trade for a one-figure correction, so the lock was lifted on
the Diary grid only, and replaced with two guard rails.

**Guard rail 1 — a past edit is always a single-occurrence correction.**
`saveAppointment` intercepts `isPastDate(ctxDate) && appt.type === 'template'` and routes to
`applyHistoricOccurrenceCorrection`, *not* `applyTemplateEditForward`. This distinction is the
whole point: `applyTemplateEditForward` with a past effective date would split the template there
and apply the change to **every occurrence from that date to today** — the exact opposite of a
one-off fix. The modal also hides the "Changes apply from" picker on a past edit, so no past
effective date can reach the forward-edit path at all.

`applyHistoricOccurrenceCorrection` has two sub-cases:

| Condition | What happens | Why |
|---|---|---|
| `templateResolvesToSingleDate(appt, date)` | Edit the template record **in place** | The record already governs only this one date, so it *is* the occurrence. No cancel/ad-hoc pair needed, and the data stays tidy. |
| otherwise | Add the date to `cancelledDates` and push a standalone `adhoc` record carrying the correction | The template also governs other dates, which must not change. Same pattern `moveOccurrenceAcrossDays` uses for scope `'once'`. |

`templateResolvesToSingleDate` returns `false` immediately for an open-ended record (no
`effectiveTo`), since it always governs future dates; that short-circuit also bounds the
day-by-day walk of the effective window. `slotOrder` is carried over via `effectiveSlotOrder`, so a
corrected entry keeps its position in that day's running order (which mileage depends on, §16).

**Guard rail 2 — the invoice consequence is stated before the change, not after.**
Invoices snapshot their `lineItems` at generation time and are never recomputed, and the app has
no way to delete or amend one. So `showHistoricNotice` reads the situation and shows one of three
severities in the modal:

| Case | Notice |
|---|---|
| `invoiceCoveringDate` finds an invoice for that client + month | **Red.** Names the invoice number and total, and says plainly that it will not update and needs correcting separately. |
| `isInvoicedClientOnDate` is true but no invoice generated yet | **Amber.** The change will be picked up when that month's invoice is generated. |
| Client is not invoiced (cash / £0 rate) | **Amber.** Summary figures for that period will change. |

Invoice periods are plain calendar months (`periodKey` is `'YYYY-MM'`), so "does an invoice already
cover this date" is a direct `periodKey` match rather than a date-range walk. `isInvoicedClientOnDate`
resolves the client snapshot **on the appointment's date**, not today, so a client since moved to
cash still warns about a month they were invoiced for.

**Reinstating a cancelled occurrence.** Cancelling used to be a one-way door: a cancelled
occurrence is filtered out by `getOccurrencesForDate`, so it renders no chip to tap, and a past day
deliberately offers no "+" to re-add it with. `cancelledOccurrencesForDate(dateStr)` is the exact
inverse of the template branch of `getOccurrencesForDate` — the versions that *would* resolve on
that date were it not in their `cancelledDates` — and the Diary's past columns render each as a
dashed, struck-through **ghost chip** that opens the modal in reinstate mode (title "Reinstate
Appointment", primary button "Reinstate this occurrence", the now-meaningless "Cancel this
occurrence only" hidden). Saving drops the cancellation and then runs the same
`applyHistoricOccurrenceCorrection`, so a reinstate at a *different* duration from the template
lands as the cancel + ad-hoc pair exactly as any other correction does.

One subtlety worth keeping: that ad-hoc branch **re-adds** the cancellation, which is the correct
end state — the template stays cancelled and the ad-hoc record carries what actually happened — but
it means a naive inverse would render a ghost chip beside the very appointment that replaced it,
reading as a double booking. `cancelledOccurrencesForDate` therefore filters out any cancellation
whose client already has an ad-hoc record on that same date. A cancellation with no same-day
replacement is a real gap and still gets its ghost, including the origin day of a cross-day move.

**What stays locked.** Adding to a past day, dragging, reordering, cross-day moves, and deleting a
recurring slot from a past date (which would truncate history that may already be invoiced — the
Delete button is hidden entirely on a historic template edit). Cancelling a single past occurrence
*is* allowed — "this visit didn't happen" is a legitimate correction — with confirm wording that
spells out the Summary and invoice consequences, and is now reversible via the ghost chip above.
Home is unaffected: it is view-only on every date by design (§9), not because of any past-date
rule. Ghost chips are **past-only**: a cancelled *future* occurrence has the same invisibility
problem, but reinstating one belongs with the forward-editing flow and its effective-date semantics,
not here.

---

## 6. Diary — drag/drop model

The week grid (`renderDiaryWeek`) draws Mon–Fri as columns, each wired with a single
`ondragover`/`ondrop` pair addressed by that column's own date.

Because a template has no stored date of its own (§5), every reorder or move on one goes through a
**once vs. future** choice (`modal-reorder-scope`), while a pure ad-hoc move applies immediately:

| Action | ad-hoc | template |
|---|---|---|
| Reorder within a day (`reorderOccurrencesOnDate`) | `slotOrder` set directly | `'once'` → per-date `orderOverrides[date]`; `'future'` → `applyTemplateEditForward` splits/mutates the record from that date forward |
| Move to a different day (`moveOccurrenceAcrossDays`) | `date` reassigned directly | `'once'` → cancel the occurrence (`cancelledDates`, the same mechanism as a normal single-occurrence cancel) **and** create a standalone new `adhoc` record on the target day; `'future'` → `applyTemplateEditForward` changes `dayOfWeek` (and `slotOrder`) from that date forward, keeping the same A/B letter |

`diaryReorderTouchesTemplate` / `diaryCrossDayTouchesTemplate` decide, **before anything is
written**, whether *any* appointment whose position will shift as a side effect — not just the one
being dragged — is a template. If so the modal is shown, and whichever scope is picked is applied
uniformly to every template touched by that one drag.

`applyOrderForOccurrence` is the one shared place that knows how to write a template-vs-ad-hoc
order change (`orderOverrides` vs. `applyTemplateEditForward`); both reorder paths call into it for
every occurrence that is not the one actually being dragged.

### Two-part drop indicator

`handleDiaryColDragOver` fires continuously while the pointer is over any column (dragover bubbles
from the chips up to the column's own handler, since only `.diary-day-col` has one wired). On every
call it:

1. Clears `.drag-over-day` from every column and adds it to `event.currentTarget` — the whole-day
   highlight, so it is obvious which day the appointment would land on before looking at the exact
   slot.
2. Repositions the shared `.diary-drop-indicator` element within that column's chips, via
   `insertBefore`/`after` against the chip nearest the pointer's Y position
   (`diaryDragBeforeIndex`).

Both are cleared in `handleDiaryDragEnd` and at the top of `handleDiaryColDrop`, so a cancelled
drag never leaves stray highlighting behind.

> `dataTransfer.getData()` is not reliably readable during `dragover` in every browser (only
> `dragstart`/`drop`), so the drag source is tracked in a plain variable set on `dragstart`, purely
> for the indicator. The actual reorder on drop still goes through `dataTransfer`.

### Cross-day index math

Same-day reorder needs `diaryDragToIdx` because the dragged chip is still physically present in
`chips` while `beforeIdx` is computed — its own array needs adjusting for the fact it is about to
be spliced out. Cross-day does **not**: the target column's `chips` never contains the chip being
dragged, so `beforeIdx` computed there is already the correct insertion index. No conversion.

### What is deliberately unrestricted

A drop **is** allowed onto a day already past its ~10-hour display capacity — the "+" empty-slot
hint is cosmetic everywhere else in the app too, and nothing else blocks overbooking a day. The
only drop targets refused outright are a **past day** (unreschedulable — see §5.1; a past chip is
tappable for a correction as of v1.3.0 but is never draggable, and `moveOccurrenceAcrossDays`
refuses past dates on both sides regardless) and a **holiday day** (which never renders slots to
drop into in the first place).

> **This drag idiom has been ported outward.** BLOC's plan page and Listly's shopping lists both
> use the landing-indicator visual from here. Listly could not reuse the *mechanism*, though: HTML5
> drag-and-drop events do not fire from touch on iPhone Safari, so it re-implemented the gesture on
> Pointer Events. If this file ever needs to work from touch, that is the reference.

---

## 7. Shell, navigation and modals

- **`showScreen(name)`** toggles `.screen.active` and the matching `.nav-btn.active`, then calls
  that screen's render function.
- **`positionNavPill()` / `animateNavPill()`** slide the highlight between nav buttons — the same
  treatment BLOC uses.
- **Modals** are bottom sheets. `openModalEl(id)` / `closeModal(id)` add and remove `.open`; every
  modal is declared in the body markup rather than constructed at runtime.
- **Segmented controls** are a shared pattern: `setSegmented(groupId, value)` /
  `getSegmented(groupId)`, used for Summary's granularity and view mode, client type and others.
- **`showConfirm(message, onConfirm)`** is the one confirmation dialog.
- **`escapeHtml(str)`** is applied to every interpolated value in the template strings the render
  functions build. **New markup must keep doing this** — these render functions write `innerHTML`.

---

## 8. Design system

Two palettes defined as CSS custom properties: **light is the default** (near-white ground, dark
navy primary) and dark is the original Stage 1 palette (near-black ground, teal). `setThemeMode`
switches them and the preference persists.

Structural conventions, several lifted from BLOC:

- **Edge fades** top and bottom of the scroll area.
- **A floating nav pill**, lifted verbatim from BLOC.
- **A three-tier divider system** (`divider-hero` / `divider` / `divider-sm`) instead of card
  wrappers.
- **Flat rows** rather than bordered boxes.
- **Clickable list rows** — one shared style, first used by Clients and reused everywhere since.

---

## 9. Module: Home

`renderHome()` renders one day, `homeSelectedDate`, defaulting to today.

- Header shows the weekday/date, "Today" or "Past", and `Week A` / `Week B` (or "Weekend"), with
  the day's and the week's total hours.
- A **holiday** short-circuits to a banner; no rows are drawn.
- Each row's height is proportional to duration (`34 + durationHours * 16` px).
- The address shown is **the client's address as it was on that date**, resolved from the client's
  own snapshot history — never today's address.
- **Call and Message** are inline circular icon buttons on the row, shown only when the client has
  a phone number. Message opens the template picker (`openMessageTemplatePicker`), whose entries
  come from Settings.
- `homeShiftDay(delta)` **skips weekends** by stepping again in the same direction.

> **Home is view-only.** No add, no edit, no drag — all of that lives on Diary. The one exception
> is the quick-add receipt button, which is about logging a cost on the spot, not editing the
> diary.

---

## 10. Module: Clients

A client record holds a versioned `history` of whole-card snapshots. `clientSnapshotOn(client,
dateStr)`, `clientCurrentSnapshot`, `clientCurrentRate` and `clientCurrentAddress` are the
accessors — **use them rather than reading a field off the client directly**, or a past figure will
silently follow a later edit.

A snapshot carries: name, client type (domestic / commercial), active flag, `isInvoiced`, payment
method, phone, rate (see below), address, and an optional separate billing address (shown only for
the client types that can have one — `updateBillingAddressVisibility`).

**Rate is entered as an amount for a duration**, not as a bare hourly figure:
`effectiveHourlyRate(rateAmount, rateDurationHours)` derives the hourly rate, and
`roundUpToNearestTenPence` is applied so a derived rate is never a fraction of a penny.
`rateSummaryLabel` is the display form and `updateClientRatePreview` shows it live in the form.

`renderHistoryList(containerId, history, formatValue)` renders any versioned history for the
"Show … history" disclosures, and `toggleHistory(kind)` drives them.

---

## 11. Addresses and postcode lookup

`lookupAddressesFor(key)` queries **postcodes.io** for a postcode and offers the result;
`geocodePostcode(rawPostcode)` resolves the `lat`/`lng` that mileage needs. **Both are optional** —
manual entry always works, and mileage simply reads as unavailable without coordinates.

Address text is normalised on save, to the spec's rules: `titleCaseWord` / `titleCaseText` title-
case every word, `formatAddressLine` expands the common abbreviations, and `formatPostcodeText`
normalises the postcode's spacing and case. `formatAddressSummary(addr)` is the one-line display
form used on Home and Diary rows. `buildAddressValue(postcode, line1, line2, previousAddr)` is what
actually constructs a stored address, carrying forward coordinates when the postcode has not
changed so an unnecessary geocode is avoided.

---

## 12. Module: Invoices

**The Ready-to-Send queue is computed, never stored.** `getInvoiceQueue()` walks every invoiceable
client (`invoicableClients()` — active, `isInvoiced`) across every month from that client's
earliest possible occurrence (`getClientEarliestPossibleDate`) to the current month, capped at the
most recent 24 months as a sanity bound.

A client/month pair enters the queue when all of these hold:

- `getClientCompletedOccurrencesInMonth` found at least one occurrence on or before today
  (weekends, holidays and non-billable dates excluded);
- **the month is complete** — either it is a past month, or it has no future occurrence left;
- no invoice already exists for that `clientId|periodKey`;
- it has not been dismissed (swiped away — `dismissQueueEntry`, stored in
  `settings.dismissedQueueEntries`).

### Numbering, labels and filenames

`nextInvoiceNumber(client, dateStr)` increments a per-financial-year counter in
`settings.invoiceCounters` and produces `<label> - <FY>-<NNN>`.

- `invoiceClientLabel` renders a domestic client as **"J Smith"** (first initial + surname) and a
  commercial client as its **full registered name** — an initial makes sense for a person, not a
  company. That split is a flagged assumption, changeable in one place.
- 🚨 **The financial year is written with a hyphen, not a slash.** The invoice number becomes the
  base of both the local filename and the Dropbox upload path, and a raw `/` in either **silently
  creates an extra folder** rather than being part of the filename — which is exactly what was
  producing a `Client Name 2026` folder containing `27-001.pdf`. Fixing it at the source means
  every downstream use is automatically safe rather than needing its own escaping.
- `invoiceFilename(invoice, client)` is deliberately different from the invoice *number*: it always
  uses the **full** client name plus the invoiced month, so a flat folder of PDFs is identifiable
  without opening each one.

### Lifecycle

`generateInvoiceForQueueEntry` → PDF (§13) + a stored `invoices` record → `previewInvoice` /
`shareInvoice` / `openShareEmailModal` (a pre-filled email body from `invoiceEmailText`) →
`markInvoiceSent` → `markInvoicePaid`. `isInvoiceOverdue` drives the overdue styling.
`renderInvoices` groups and renders; `toggleInvoiceRow` expands a row into its line items
(`invoiceLineItemsHtml`); `wireInvoiceSwipeGestures` attaches swipe-to-dismiss **to Ready-to-Send
rows only**.

Statuses are `ready` → `outstanding` → `paid`, plus `void` (§12.1). Overdue is **derived**, not
stored.

### 12.1 Drift, amend and void/re-issue (v1.4.0)

An invoice's `lineItems` are a snapshot taken at generation and never recalculated. `getRevenueForRange`
(§15), by contrast, recomputes from appointments on every render. The two are independent **by
design**, but that means correcting a historic appointment in an invoiced month silently desynced
the books from the billed figure, with no route back — `getInvoiceQueue` refuses to re-offer a
period that already has an invoice. v1.3.0 (§5.1) made such corrections easy, so v1.4.0 closes the
loop.

**One source of figures.** `computeInvoiceFigures(clientId, monthKey)` is now the only place an
invoice's lines and total are derived, used by generation *and* by drift detection. Two copies of
that arithmetic would make a spurious difference indistinguishable from a real one — which is the
entire signal here.

**Drift is derived, never stored.** `invoiceDrift(invoice)` recomputes the period and compares.
No flag to set at correction time, no migration for existing records, and it catches every cause of
divergence — a backdated rate on the client card, a holiday added, a cancelled occurrence
reinstated — not just the ones we remembered to instrument. It returns `null` for a `void` invoice,
which is history and not supposed to track anything.

**The fix depends on whether the client has seen it:**

| Status | Path | Why |
|---|---|---|
| `ready` | `amendReadyInvoice` — mutate in place, keep the number, re-upload over the same Dropbox path | Never left the device; there is no prior version worth preserving. |
| `outstanding` / `overdue` / `paid` | `voidAndReissueInvoice` | The client holds a document bearing that number and total. Editing it silently would make the app lie about what was billed. |

`voidAndReissueInvoice` sets `status:'void'`, `voidedDate`, `supersededBy`, and captures
`wasPaidWhenVoided` / `statusBeforeVoid` — once `status` is `'void'` there is otherwise no way to
tell a voided *paid* invoice from a voided unpaid one, and that is exactly what says whether money
has already come in. The replacement carries `supersedes` back. Both links are stored, so the trail
survives a backup round-trip.

**Voided invoices deliberately do not reserve their period.** `getInvoiceQueue`'s `existingPeriods`
filters them out — that is what allows a voided month to be invoiced again. In the normal flow the
replacement is created in the same operation and immediately holds the period, so the month never
actually reappears in the queue; the exclusion matters for the case where it would otherwise be
stranded forever. `getUnpaidInvoicesTotal` needs no change: it whitelists `ready`/`outstanding`, so
`void` drops out on its own.

**Decided with Adam, 2026-09-24:** voiding a **paid** invoice is allowed and treated exactly like
any other sent invoice. The consequence is that the payment detaches, since the replacement is
issued unpaid; `invoiceSupersedeHtml` surfaces "£x already received against it" on the new row so
the outstanding amount stays visible. Reconciling it is manual.

---

## 13. PDF generation and file handling

`buildInvoicePdfBlob(invoice, client)` draws the document with **jsPDF, bundled inline**: logo,
business details and address as they were on the statement date, client name and billing address,
the line items, the total, and the bank payment instructions.

**The PDF is never stored** — only the record is, and the PDF is rebuilt from it on demand for
Preview, Share and every Dropbox upload. That is what makes voiding cheap: setting `status:'void'`
makes every copy the app produces from then on come out stamped, with no stored file to chase.

**VOID stamp (v1.4.0)** — drawn *last* so it sits over the content rather than under it, via
`setGState({opacity})` so the figures underneath stay readable; this is a record of what was
billed, not a redaction. Verified against the embedded **jsPDF 4.2.1**, which supports both
`setGState` and rotated text (`{ angle }`). A **supersede cross-reference** ("Replaces invoice X" /
"Voided — replaced by invoice Y") is printed on both halves of a pair, because the client has no
access to the app and two invoices for the same month are otherwise just confusing.

`saveOrShareFile(blob, filename, opts)` is the one file exit. It prefers the Web Share API when the
platform supports sharing files (which is what puts a PDF into iOS Files or Mail), and falls back
to a download link otherwise.

---

## 14. Dropbox archival

OAuth2 with **PKCE** — the flow designed for apps with no server to hold a client secret, which is
exactly this app.

- `pkceChallenge()` / `base64UrlEncode()` build the challenge;
- `dropboxConnect()` starts the redirect;
- `dropboxHandleRedirect()` runs on boot and is a **no-op unless the page was just reloaded via the
  OAuth redirect**;
- `dropboxEnsureFreshToken()` refreshes before an upload;
- `dropboxInvoicePath(invoice, filename)` builds
  `/Invoices/<financial year>/<month>/<filename>.pdf` — split out in v1.4.0 so upload, the VOID
  replacement and the delete can never disagree about where a given invoice's PDF lives;
- `dropboxUploadInvoice(blob, invoice, filename)` writes there, returning whether it succeeded;
- `dropboxDeletePath(path)` removes a file (`files/delete_v2`);
- `dropboxReplaceWithVoidCopy(invoice, client)` swaps an archived PDF for a VOID-stamped one under
  a `… - VOID` filename.

Both halves of that last one matter: the stamp makes it obvious on opening, the filename makes it
obvious in a folder listing without opening anything.

> **Order is load-bearing.** The stamped copy is uploaded **first**, and the original deleted only
> if that upload actually succeeded. Deleting first risks destroying the only archived copy and
> then failing to write its replacement — offline, expired token, Dropbox down. Leaving both files
> behind is untidy; leaving none is data loss. It must also be called *after* the record is marked
> void, since `buildInvoicePdfBlob` reads `status` to decide whether to draw the stamp.

`delete_v2` and `upload` are both covered by the **`files.content.write`** scope the app already
holds, so voiding needs no re-consent. Note the authorize URL requests no explicit `scope`
parameter — granted scopes come from the app's Permissions tab in the Dropbox console.

`dropboxIsConnected()` gates the UI. **Every failure here is non-fatal** — the invoice is already
saved locally, and archival is a backup.

---

## 15. Module: Summary

`summaryPeriodBounds()` resolves the window from the granularity segmented control and
`summaryAnchorDate`:

| Granularity | Window |
|---|---|
| Day | the anchor date |
| Week | Monday–Sunday of the anchor's week |
| Month | the anchor's calendar month |
| **UC** | a 13th-to-12th cycle (e.g. 13 Apr – 12 May) |
| Year | the **UK tax year** containing the anchor |

**Two deliberate grace windows on the defaults**, so a period does not roll over the instant it
ends and leave the figures you actually want one tap away:

- `summaryDefaultMonthAnchor()` keeps showing the **previous** month until the 8th;
- `summaryDefaultUCAnchor()` keeps showing the **previous** UC cycle on the 13th–16th.

`summaryPeriodLabel()` and `summaryPeriodSubLabel()` render the heading (the sub-label is only used
for Year and UC). `summaryShiftPeriod(delta)` steps, and `openSummaryPeriodPicker()` +
`summaryPickDate/Week/Month/Year/UC` jump.

**Actual vs Projected** (`summaryViewModeChanged`) is a single `includeFuture` flag threaded
through `getRevenueForRange`, `getCachedMileageForRange` and the rest: Actual counts only what has
occurred, Projected also counts future scheduled work inside the window.

The figures: **Revenue** (`getRevenueForRange`), **Costs** from receipts (`getCostsForRange`),
**Mileage** with its allowance (§16), **Salary** drawn (`getSalaryForRange`), **Unpaid Invoices**
(`getUnpaidInvoicesTotal`), the value of invoices **not yet generated**
(`getUngeneratedInvoicesValue`), and an estimated **Profit**. The mileage allowance is shown but
deliberately **not** folded into the profit estimate — it is a tax allowance, not a cost that has
left the account.

`renderSummaryYearlyTable(fyStartYear, isProjected)` adds the Year view's month-by-month
breakdown. `renderSummaryReceipts(start, end)` renders the full receipts log for the window, with
add, edit and delete (`openReceiptModal`, `saveReceipt`, `deleteReceipt`) — the same modal Home's
quick-add uses.

---

## 16. Mileage

Provider: **OpenRouteService** — free, public, no backend needed. `settings.orsApiKey` is required;
without it mileage reads as unavailable, the same graceful degradation as Dropbox and the business
profile.

**The route.** `computeDayMileage(dateStr)` builds `home → each billable appointment's address, in
slot order → home` and posts it to the directions API, converting metres to miles at 1dp. The
journey **always starts and ends at home and is never re-optimised** for the shortest distance.
`getMileageOriginAddress()` prefers the configured home address and falls back to the business
address — plenty of solo traders never fill in a separate home address but do have a business one
on file. It returns `null` rather than throwing when it genuinely cannot compute, and never blocks
its caller.

**Caching.** `ensureDayMileageCached(dateStr)` stores each day's result in `settings.mileageCache`
keyed by date, alongside a **fingerprint** of that day's actual route
(`dayRouteFingerprint` — home coordinates plus each stop's appointment id and coordinates, in
order). The cache is invalidated only when that fingerprint changes, so a day is computed **once**.
A solo diary is at most ~8 legs a day, so this is a one-off cost per day, not a recurring one:
after the first pass, opening Summary costs zero further API calls for unchanged history.

`getCachedMileageForRange` is **synchronous and cache-only** — it never makes a network call — and
reports `allCached` so the caller knows whether the figure is complete.
`backgroundFillMileage(start, end, includeFuture)` fills the gaps behind the rendered UI, and
`refreshMileageForCurrentPeriod()` is the manual refresh button on the Summary callout.

**The allowance.** `tieredMileageCost(milesBeforeRange, milesInRange)` applies the UK rates — 45p
per mile up to 10,000 miles in a **financial year**, 25p after — which is why the caller first sums
the miles already driven earlier in that financial year: the tier boundary depends on the whole
year, not on the window being viewed.

---

## 17. Module: Settings

`renderSettings()` draws the page; each section saves independently.

| Section | Notes |
|---|---|
| **Business Profile** | Name, address and bank details, each **versioned** (§4), each with its own "Effective from" and a "Show … history" disclosure. `handleLogoUpload` stores the invoice logo as a data URI |
| **Home Address** | The mileage origin (§16), with postcode lookup |
| **Mileage / Dropbox** | The two API keys, and Connect Dropbox |
| **Holidays** | Date ranges. An appointment inside a holiday is **skipped, never rescheduled** — `isHolidayDate` is checked by the diary, the invoice queue and mileage alike |
| **Jenn's Salary** | A log of discrete fixed-amount payments drawn from the business, feeding Summary's Salary figure |
| **Message Templates** | User-authored quick texts, used from Home's Message button |
| **Appearance** | Light / Dark (`setThemeMode`) |
| **Account** | Identity, Change password, Sign out (§18) |
| **Data Backup** | Export/Import JSON, Back Up to Cloud Now, Restore from Cloud (§19) |

**Sort code input** is three boxes of two digits (`sortCodeBoxInput` / `sortCodeBoxBackspace`),
auto-advancing and auto-hyphenated on read (`getSortCodeInputValue` / `setSortCodeInputValue`).

---

## 18. Auth

Supabase Auth, ported from BLOC. **This app has no relational tables** — the only server-side
mechanisms are authentication and the Storage snapshots in §19.

The **auth gate** (`#auth-gate`) sits above `#app` and is **visible by default in CSS**, hidden
only once `initSupabaseAuth()` positively confirms a session — so there is no frame in which the
app flashes into view for someone who is not signed in.

`initSupabaseAuth()` dynamically imports `@supabase/supabase-js`, checks the session, and
subscribes to `onAuthStateChange`. `onAuthResolved(session)` hides or shows the gate and starts the
boot (§21). `signInWithProvider` (OAuth), `submitEmailAuth` (sign-up and sign-in),
`sendPasswordReset`, `signOutUser`, `openChangePassword` / `submitChangePassword` and
`updateAccountUI` are the rest. `renderAuthProviders()` builds the provider list from a config
array, so adding one is data, not code.

The Supabase URL and **publishable** key are constants in the file. That is correct: the key is
public by design — RLS protects the data, not the key.

---

## 19. Backup and restore

**One payload shape, two destinations, so they can never drift apart.**

- `buildBackupPayload()` reads all five stores and stamps `exportedAt` and `appVersion`.
- `applyBackupPayload(data)` **deletes every record in every store and writes the payload's** — a
  full replace. **The caller is responsible for confirming first**; this function does not ask.

**Local:** `exportJsonBackup()` downloads `my-dream-clean-backup-<date>.json` through
`saveOrShareFile`; `importJsonBackup(event)` parses, confirms, and applies.

**Cloud:** Supabase Storage, bucket `my-dream-clean-backups`, path `<user id>/<date>.json` — no
app-slug prefix, since the bucket is already scoped to this app.

- `uploadSnapshot()` writes with `upsert: true`, so a second backup the same day replaces the
  first, and records `mdc_last_snapshot_date` in `localStorage`.
- `maybeUploadOpportunisticSnapshot()` runs at boot: skipped if offline, or if today's snapshot
  already exists. **A browser tab cannot run a reliable scheduled job**, so piggybacking on boot is
  the mechanism — the same reasoning as BLOC's.
- `maybeUploadSnapshotZero()` covers a device that has never uploaded one — a new sign-up, or an
  existing device signing in for the first time. **Upload-only; it never touches local data.**
- `listSnapshots()` / `openRestorePicker()` / `handleRestoreSnapshot(date)` are the restore path,
  behind the same full-replace warning as the local import.

---

## 20. The tour engine

Ported from BLOC's spotlight-and-tooltip tour. The engine knows how to walk a step list, mask the
screen, point at an element and get out of the way cleanly — nothing about any particular page.

```js
{
  targetId: 'clients-list',   // required — the element to spotlight
  screen:   'clients',        // required — a screen name showScreen() understands
  title:    '…',              // required
  body:     '…',              // required
  onEnter:  (step) => {},     // optional — may reassign step.targetId to a dynamically-found element
}
```

`startTour(steps, opts)` → `_buildTourDom` → `_renderTourStep`, with `tourNext` / `tourBack` /
`tourSkip` (and a skip confirmation) and `endTour` tearing it down. `_ensureTourScreen` navigates
to the step's screen before positioning. `_positionTourStep` / `_repositionTourStep` are wired to
both `window.resize` and `visualViewport.resize`, because the iOS keyboard moves the viewport
without a window resize.

**Every tour here is a "mini-tour" in BLOC's terms: live data only, no wait-for-action steps,
`allowSkip` always true, final label "Got it".** One `?` button per page —
`startHomeTour`, `startDiaryTour`, `startClientsTour`, `startInvoicesTour`, `startSummaryTour`,
`startSettingsTour` — and deliberately **no central help hub**.

---

## 21. Boot order

`initSupabaseAuth()` is called immediately at the end of the body — `createClient()` and
`getSession()` touch no DOM, and starting early keeps the gate's resolve time short for a returning
signed-in person.

`onAuthResolved()` then calls `runBoot()` **once** (`_bootStarted` guards against a later
`onAuthStateChange`, e.g. a token refresh, running it twice):

```
Promise.all([ loadClients, ensureAppSettings, loadAppointments, loadInvoices, loadReceipts ])
  → dropboxHandleRedirect()          // no-op unless this load is an OAuth redirect
  → re-render whichever screen is active
  → maybeUploadOpportunisticSnapshot()
```

> Everything that used to run unconditionally at parse time now waits for a confirmed session.
> **Substance unchanged, just relocated behind the auth gate** — so nothing reads or writes the
> database for someone who is not signed in.

---

## 22. Conventions and gotchas

- **Every date is a string; every comparison is `compareDateStr`.** Never construct a `Date` to
  compare two calendar days.
- **Never read a versioned field directly.** Go through `resolveVersionedValue` or a client
  snapshot accessor, with the date you actually mean.
- **`escapeHtml` every interpolated value.** The render functions write `innerHTML`.
- **Weekends and holidays are excluded consistently** — by the diary, `dayUsedHours`, the invoice
  queue and mileage. A new surface that walks dates must do the same.
- **The past is unreschedulable, not unwritable** (v1.3.0 — see §5.1). `isPastDate` still gates
  every path that would *move* history: drag, reorder, cross-day move, adding to a past day, and
  truncating a recurring slot from a past date. A single-occurrence *correction* is allowed, and
  must route through `applyHistoricOccurrenceCorrection` — never `applyTemplateEditForward`, which
  with a past effective date would rewrite every occurrence from then to now.
- **A failed integration must degrade, never block.** Mileage, postcode lookup, Dropbox and the
  cloud snapshot all return `null` or warn, and the app keeps working.
- **Row identity matters for templates.** A template occurrence has no stored date, so never build
  a mechanism that needs to "point at" one — use the slot (week letter + day-of-week + date) the
  way `orderOverrides` and `cancelledDates` do.
- **`upsert: true` on the daily snapshot is deliberate**, so a second backup in a day replaces
  rather than accumulates.

---

## 23. Versioning

No version was tracked before **v1.1.0**. Current: **v1.4.0**. Bump the `<!-- My Dream Clean — vX.Y.Z -->` comment at
the top of `index.html` and the **Version** line under README's `## Status` **together, on every
delivery**.

If a change touches Supabase, the migration files go to
`silver-octo-invention/supabase/migrations/` and the two documents in
`silver-octo-invention/docs/` are updated in the same pass.
