# My Dream Clean — Technical Notes

Implementation-level detail that doesn't belong in README.md (which stays user-facing). Update this alongside README.md whenever a change touches how something is *built*, not just what it *does*.

---

## Diary — drag/drop model

The week grid (`renderDiaryWeek`) draws Mon–Fri as columns, each wired with a single `ondragover`/`ondrop` pair addressed by that column's own date. Two kinds of appointment record exist (see the "Appointment model" comment above `getOccurrencesForDate` in `index.html`):

- **`adhoc`** — has its own literal `date` field. Moving one is just reassigning that field.
- **`template`** — recurring, defined by `template` (week letter A/B) + `dayOfWeek`, resolved against a date by `getOccurrencesForDate`. It has **no stored date of its own** — "today's occurrence" is always derived, never a record you can point at directly.

That distinction is why every reorder/move on a template goes through a **once vs. future** choice (`modal-reorder-scope`), while a pure ad-hoc move applies immediately:

| Action | ad-hoc | template |
|---|---|---|
| Reorder within a day (`reorderOccurrencesOnDate`) | `slotOrder` set directly | `'once'` → per-date `orderOverrides[date]`; `'future'` → `applyTemplateEditForward` splits/mutates the record from that date forward |
| Move to a different day (`moveOccurrenceAcrossDays`) | `date` reassigned directly | `'once'` → cancel the occurrence (`cancelledDates`, same mechanism as a normal single-occurrence cancel) **and** create a standalone new `adhoc` record on the target day; `'future'` → `applyTemplateEditForward` changes `dayOfWeek` (and `slotOrder`) from that date forward, keeping the same A/B letter |

`diaryReorderTouchesTemplate` / `diaryCrossDayTouchesTemplate` decide, before anything is written, whether *any* appointment whose position will shift as a side effect (not just the one being dragged) is a template — if so the modal is shown, and whichever scope the user picks is applied uniformly to every template touched by that one drag, not just the dragged item. This mirrors how the same-day reorder already worked before cross-day moves existed.

`applyOrderForOccurrence` is the one shared place that knows how to write a template-vs-adhoc order change (`orderOverrides` vs. `applyTemplateEditForward`) — both `reorderOccurrencesOnDate` and `moveOccurrenceAcrossDays` call into it for every occurrence that isn't the one actually being dragged.

### Two-part drop indicator

`handleDiaryColDragOver` fires continuously while the pointer is over any column (dragover bubbles from the chips up to the column's own handler, since only `.diary-day-col` has one wired). On every call it:

1. Clears `.drag-over-day` from every column and adds it to `event.currentTarget` — the whole-day highlight, so it's obvious which day the appointment would land on even before looking at the exact slot.
2. Repositions the shared `.diary-drop-indicator` element within that column's chips, via `insertBefore`/`after` against the chip nearest the pointer's Y position (`diaryDragBeforeIndex`) — the existing same-day mechanism, unchanged, now just as valid on a column that isn't where the drag started.

Both are cleared in `handleDiaryDragEnd` and at the top of `handleDiaryColDrop`, so a cancelled/aborted drag never leaves stray highlighting behind.

### Cross-day index math

Same-day reorder needs `diaryDragToIdx` because the dragged chip is still physically present in `chips` while computing `beforeIdx` — its own array needs adjusting for the fact it's about to be spliced out. Cross-day doesn't need that: the target column's `chips` never contains the chip being dragged (it's in a different column's DOM), so `beforeIdx` computed there is already the correct insertion index — no conversion.

### What's deliberately unrestricted

Per product decision: a drop is allowed onto a day that's already past its ~10-hour display capacity (the "+" empty-slot hint is cosmetic everywhere else in the app too — nothing else blocks overbooking a day). The only drop targets refused outright are a **past day** (immutable, same rule as everywhere else) or a **holiday day** (never renders slots to drop into in the first place).

---

## Versioning

No version was tracked before **v1.1.0**. Bump the `<!-- My Dream Clean — vX.Y.Z -->` comment at the top of `index.html` and the "Version" line under README's `## Status` together, on every delivery.
