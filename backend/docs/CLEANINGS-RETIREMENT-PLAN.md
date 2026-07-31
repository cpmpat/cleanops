# Retiring the `cleanings` model

Goal: one model for "a unit needs cleaning between two guests". Today there are
two — `cleanings` (per booking) and `turnovers` (per gap between bookings) —
written in parallel on every sync. Cleaners read turnovers; managers read
cleanings. That split is what made the 31 Jul incident take four scripts to
diagnose.

## The mapping

A Cleaning belongs to a booking. Each booking is the *arriving* side of exactly
one live turnover. So:

```
cleaning.bookingId  ↔  turnover.toBookingId   (supersededById IS NULL)
```

Exact 1:1, with one asymmetry: the **trailing** turnover of each property
(`toBookingId IS NULL` — the unit is free after the last departure) has no
Cleaning counterpart. That is fine; it is a slot with no arrival yet.

Two Cleaning columns are already duplicated on Turnover and simply disappear:

| Cleaning column | Turnover equivalent |
|---|---|
| `timeSlot` | `dueBy` |
| `previousGuestCheckOutTime` | `availableFrom` |

`reconcilePreviousGuestCheckOut()` — including the `make_interval` bug — is
deleted along with them, because `availableFrom` is derived from the chain
rather than recomputed by a periodic job.

## What only exists on Cleaning today

| Capability | Turnover equivalent | Consequence of dropping now |
|---|---|---|
| Photos (`CleaningPhoto`, uploads keyed by `cleaningId`) | **none** | mark-done photos are **already** discarded — see `markDone`'s TODO. Active data loss every day. |
| Tags (`CleaningTag` ↔ `ManagerTag`) | none | manager tagging disappears |
| Incident link (`Incident.cleaningId`) | none | incident→cleaning trail breaks |
| Manager assign / reassign (`assignments.service`) | **none** | managers cannot assign anyone; the pool is the only route |
| Manager schedule + dashboard (`/cleanings/*`) | partial | two manager pages break |

Plus `OverdueCheckJob`, `MorningSummaryJob`, `streams.service` and
`booking-sync` all read or write `cleanings`.

---

## Two decisions needed before Phase 3

**D1 — Do historical photos and tags get migrated, or abandoned?**
Migration is straightforward via the mapping above, but only for cleanings whose
booking still has a live turnover. Cleanings for cancelled bookings, or from
before turnover sync was enabled, may have no target. Options: migrate what
maps and report the rest; migrate everything and create turnovers for orphans;
or leave history behind and start photos fresh on turnovers.

**D2 — Drop the table, or keep it as frozen history?**
Recommended: rename to `cleanings_deprecated` and soak for two weeks before
`DROP`. A rename is instantly reversible; a drop is not. The cost is a dormant
table for a fortnight.

---

## Phase 1 — close the capability gaps (additive, nothing removed)

Safe to ship incrementally; the app keeps working throughout.

1. **`TurnoverPhoto` model** + upload route keyed by `turnoverId`, and wire
   `markDone`'s `photoUrls` to actually persist. *Do this first regardless of
   the rest of the plan — photos are being silently dropped today.*
2. **Manager assign / unassign on turnovers.** `POST /turnovers/:id/assign`
   (body: `userId`, `isPrimary`) and `POST /turnovers/:id/unassign`, both
   writing audit events — `claim`/`drop` already do, and assignment must too, or
   the next "where did it go" costs another night.
3. **`TurnoverTag`** ↔ existing `ManagerTag`.
4. **`Incident.turnoverId`** (nullable) alongside `cleaningId`.

## Phase 2 — move the readers

5. Manager **schedule** and **dashboard** from `events`/`/cleanings/*` to
   turnover endpoints.
6. **Planning view** (`getBookingsForPlanning`) returns turnover id/status
   instead of `cleaning`.
7. **`OverdueCheckJob`** onto turnovers — and give it the lower bound it lacks,
   so a past `ASSIGNED` row stops notifying managers hourly forever.
8. **`MorningSummaryJob`** onto turnovers, plus `{ timeZone: 'Europe/Prague' }`.
9. **`streams.service`** cleaning filter → turnovers.

## Phase 3 — backfill, then stop dual-writing

10. Backfill script: `CleaningPhoto → TurnoverPhoto`, `CleaningTag →
    TurnoverTag`, `Incident.cleaningId → turnoverId`, using the mapping above.
    Dry-run first, report anything that does not map (per D1).
11. Remove Cleaning creation/update from `booking-sync.processBooking`.
    Delete `reconcilePreviousGuestCheckOut` and its call sites.
12. Delete the `cleanings` and `assignments` modules and their frontend clients.

## Phase 4 — drop

13. `ALTER TABLE cleanings RENAME TO cleanings_deprecated` (and the three child
    tables). Deploy. Watch logs for two weeks.
14. `DROP TABLE` the four tables; drop `CleaningStatus` / `CleaningType` enums if
    nothing else references them.

---

## Sequencing notes

- Phases 1 and 2 are independently shippable and reversible. Nothing is
  destructive until Phase 3 step 11.
- Run `reconcile:turnovers --fail-on-drift` before and after Phase 3 — the
  turnover chain becomes the single source of truth at that point, so its
  integrity stops being a nice-to-have.
- The 736 bookings backfilled on 31 Jul created Cleaning rows too; they are
  covered by the same mapping and need no special handling.
- Item 2 (manager assign) is worth pulling forward on its own merit, plan or no
  plan: the assignment brief calls for managers assigning specific cleaners, and
  today that capability exists only on the model being retired.
