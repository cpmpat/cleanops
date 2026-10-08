# Decisions and conclusions

The record of *why* things are the way they are. One entry per decision or
established fact, newest first, each pointing at the evidence rather than
repeating it. Add an entry in the same PR as the change, or at the end of the
session that reached the conclusion — a decision that lives only in a chat
transcript is not a decision the next person can find.

The other record files and what belongs where:

- `CHANGELOG.md` — what was **deployed** and when; migrations and env per PR.
- `backend/docs/SYNC-BACKFILL-RUNBOOK.md` — how to operate the sync and the
  backfill/reconcile scripts, plus the operation log of every production run.
- `ARCHITECTURE.md` — how the system is put together.
- `SESSION_SUMMARY.md` — stale (April 2026); superseded by this file and the
  runbook. Do not update it; delete it when convenient.

---

## 2026-09-29 — CDM lists: per-column access matrix, row saves, field audit

**Decision.** Access to a migrated CDM list is a matrix of role × list ×
column → none / view / edit, in Postgres, default deny, enforced on the
server (unviewable columns are not selected; every saved field needs an edit
grant or the whole save is refused). Editing is inline in the grid plus a
record drawer, both sharing one draft per row and one Save. Saves carry the
row's `updatedAt`; a mismatch is a 409, never a silent overwrite. Each save is
one audit event plus one field-change row per changed field (old → new,
email, role, time), in the same transaction. Sensitive columns are audited
without values, visible to ADMIN only. Creating records is off for now.

**Why not SQL roles or per-role views.** The app talks to Postgres as one
pooled user; database grants cannot vary by tenant, every matrix change would
be DDL, and per-role views multiply and drift with each new column. The
matrix is ~170 indexed rows per role per list — read per request, no cache,
so a revoked grant is gone on the next request. SQL views remain the right
tool for curated read-only lists, behind the same matrix.

**Why grants are not a foreign key to `dataset_fields`.** A grant for a column
that does not exist yet waits for it (five CSV columns were granted before
they were added).

---

## 2026-09-25 — agent availability is stored as Prague wall-clock, per real date

**Decision.** `agent_availability` rows are `day` (YYYY-MM-DD, Prague) plus
`startMinute`/`endMinute` from that day's midnight; a block past midnight
keeps its evening's day (21:00 → 01:00 = 1260 → 1500, max 1800). No recurring
"usual week" — agents enter real dates and can copy a week forward. Today's
blocks may be extended but never shrunk or removed by the agent; from
tomorrow on they are free to edit. The desk only reads (no desk edits yet).

**Why.** The question the desk asks is "who is free on Friday evening", which
is a Prague wall-clock question; instants would drag DST and the browser's
clock into every read and write (the 15:10 → 17:10 lesson). Keeping the
overnight block on its evening's day matches how agents think and keeps one
row per shift. Locking today protects the plan the desk already made; a
change inside today goes through a phone call. A recurring template was
declined for now — real dates are unambiguous and "Copy this week" covers the
repetition.

**Also.** "Available" means the agent declared it. No row = not available,
by design; the UI says *Not available* in words.

---

## 2026-09-24 — each Planning tab owns one time; the other is read-only

**Decision.** `/planning/check-in` edits and pushes only `checkInTime`;
`/planning/check-out` only `checkOutTime`. The backend's planning list takes
`by=checkIn|checkOut`, which picks the date field the range bounds *and* the
turnover the row reports (before arrival vs. after departure).

**Why.** The desk plans arrivals and departures as two jobs, often by two
people. One page with both fields editable meant two operators could push
the same booking with different intents and the later PUT to Avantio won
silently. Locking the field that is not the tab's subject makes the intent
explicit and the conflict impossible.

---

## 2026-09-24 — "last minute" is decided by the PMS booking date, never by a turnover row's age

**Decision.** A turnover is last-minute when the guest *booked* and *arrives*
on the same Prague day, read from `bookings.pmsCreatedAt` (Avantio's
`createdAt`). Neither `turnovers.createdAt` nor `bookings.createdAt` may be
used for this.

**Why.** `supersede()` gives a turnover a fresh row on every change (time
edit, neighbour inserted/cancelled/extended, reconcile), so its `createdAt`
is "last touched", and an August booking showed as last-minute the morning
its arrival was adjusted in Planning. `bookings.createdAt` is when *we* first
saw the booking, which for the seven backfilled on 15 Sep is weeks after the
guest booked. Only the PMS date answers the question the mark asks.

**Corollary.** Anything that means "when did this happen in the world" needs
its own column filled from the PMS payload; a row timestamp is always about
our own bookkeeping.

---

## 2026-09-21 — operational booking attributes live on `bookings`, are ours, and are never synced either way

**Decision.** Things the front desk knows about a stay that the PMS does not
model — today a crib and separate beds — are columns on `bookings`, written
through the manager `PATCH /bookings/:id`, read by the turnover card through
`toBooking`. They are not pushed to Avantio and the sync never writes them.

**Why.** Avantio has no field for them, and the alternative (a manager note)
is prose the cleaner has to read. A column is a chip on the card. The sync
already only updates the PMS-owned columns it compares, so a local column
survives every resync without a `manuallyOverridden` flag — unlike guest
counts, which the runbook still lists as unprotected.

**Rule for the next one.** A new attribute of this kind is a column with a
default, exposed in `TURNOVER_BOOKING_SELECT` and on the planning DTO, with a
chip on `TurnoverCard`. Not a JSON bag, not a note.

---

## 2026-09-21 — the browser never builds an instant; times cross the API as `HH:mm` in Prague

**Decision.** Anything a person types as a time is sent to the backend as
`HH:mm` and resolved there, on the record's own day, in `Europe/Prague`,
through `backend/src/common/time.ts` (`atTimeInAppZone`). The frontend shows
times with `formatTime()`, which is pinned to Europe/Prague, 24-hour. No
frontend code constructs an ISO instant from a date and a time.

**Why.** Check-in Planning built `${date}T${HH:mm}:00.000Z` — Prague wall-clock
labelled as UTC — so 15:10 was pushed to Avantio, stored and shown as 17:10.
The July review found the identical fault in the old sync script (§2.1). Two
occurrences of the same mistake in one codebase is a convention problem, not
a typo: the convention is now that only `time.ts` converts wall-clock to
instants. The same rule fixed the arrival-range filter, where a bare `To`
date was midnight UTC and dropped the last day.

**Not done.** `todayISO()` / `dayKeyISO()` in `frontend/lib/utils.ts` still
use the browser's date; they seed the default "from" date and the day
buckets in the cleaner calendar. Correct for a device in Prague, off by one
day between 22:00 and midnight UTC elsewhere. Same fix when it bites.

---

## 2026-09-15 — the incremental sync overlaps its window by 15 minutes

**Decision.** `BookingSyncService` asks Avantio for bookings updated since
`pmsLastSyncAt − 15 min`, not since `pmsLastSyncAt`. The watermark itself is
still stamped from the run start. The cron fires at `:07` and `:37`, not on
the half hour.

**Why.** Seven bookings Avantio had were never created here; a cleaner found
one. All seven had `updatedAt` 0.0–22.3 s after a `*/30` firing, against a
uniform population of 8,730 (probability under the null ≈ 6×10⁻⁹). A booking
stamped just before a run's list call but not yet queryable at that instant
was skipped, and every later window started after its `updatedAt`. The same
race lost 3 cancellations (ghost bookings) and 107 modifications. Two of the
seven had `updatedAt` of exactly `hh:00:00.000` — Avantio runs its own job on
the half hour, which is why the cron moved off it.

**Evidence and tooling.** Runbook operation log, 13–15 Sep; project note
`claude/incident-2026-09-13-prebooking-HMED24DNKZ.md`; `pnpm diag:boundary`
reproduces the measurement.

**Rejected on the way.** (1) "Pre-booking status is skipped" — wrong: the UI's
Pre-booking is `UNPAID` in the API and maps to active. (2) "Cursor pagination
on `-updatedAt` drops rows" — wrong: a real 30-minute window is one page, and
the 120-day enumeration returned 8,730 unique ids with no duplicates.

---

## 2026-09-15 — `sort=-updatedAt` stays; Avantio offers no stable sort key

`GET /bookings` accepts only `creationDate`, `updatedAt`, `arrivalDate`,
`departureDate`, `createdAt` (± prefix) and `pagination_size ≥ 10`;
`sort=id` is a 400. The existing sort is sound (see above), so it is kept.

---

## 2026-09-15 — maintenance scripts are read-only unless they say otherwise

`diag:booking`, `diag:boundary`, `diag:list-sort` never write and never touch
`pmsLastSyncAt`. `backfill:*` and `reconcile:turnovers` are dry-run by default
and write only with `--apply`. Exit code 1 from a backfill's trailing reconcile
means "drift found, waiting for you", not failure — read the output.

---

## 2026-09-15 — production scripts need Railway's `CREDENTIALS_ENCRYPTION_KEY`

Since PR #31 the tenant's Avantio key is encrypted at rest. Any script that
calls Avantio needs the *Railway* value of `CREDENTIALS_ENCRYPTION_KEY` in
`backend/.env.production`, as its own line. Without it Nest falls through to
the dev key in `backend/.env` and `pmsConfigFor()` throws "Stored secret could
not be decrypted" — which reads like a corrupted row and is not. The
`AVANTIO_API_KEY` in `backend/.env` is stale (401) and is not a fallback.

## 2026-10-08 — a cancel by the reconcile is provisional; a manager's is final

Both write status CANCELLED, so the code could not tell them apart and
`supersede()` carried either one forward. They are not the same thing: a
manager cancelling says "no cleaning for this pair"; the reconcile cancelling
says "right now no pair of bookings justifies this row". The reconcile now
writes `skipReason = 'ORPHAN_RECONCILE'` with its cancel, and that cancel is
undone whenever the bookings point at the row again (sync supersede, a new
booking, or a later reconcile). `skipReason` NULL on a CANCELLED row means a
person did it — it is kept everywhere, as before. Rows cancelled before this
rule were tagged by `repair:orphan-cancels`, recognised by an audit event
`turnover.orphan_cancelled` on the original row and the same `cancelledAt`
copied down the chain.

The reconcile also cancels an orphan only when one of its bookings is gone
(missing, CANCELLED, moved property). Two CONFIRMED bookings that the chain
pairs differently from the reconcile is a disagreement about order, not proof
that no cleaning is needed: it is reported for a person, never cancelled.

## 2026-10-08 — the nightly sweep fixes, reports, and keeps notifications on

The sweep (03:20 Prague, `SafetySweepService`) applies only what the
reconcile is already allowed to do unattended and reports the rest. It sends
the normal notifications for bookings it finds: a booking the 30-minute sync
missed is one staff should have heard about, and suppressing notifications
in the server process would leak to concurrent requests. Its report is the
log plus one `sweep.completed` audit row per tenant per night — no screen, by
choice:

```sql
select "createdAt", action,
       metadata->'bookings'->'outcomes'  as bookings,
       metadata->'turnovers'->'applied'  as fixed,
       metadata->'turnovers'->'needsReview' as review
from audit_events where "actorEmail" = 'safety-sweep@cleanops'
order by "createdAt" desc limit 14;
```

## 2026-10-08 — Pricing Group moves are recorded by a database trigger

The ranking lives in the pick list `accommodation.pricingGroup`
(`dataset_picklist_values.sortOrder`, 1 = LUX A highest, 12 = CKC lowest), so
the Data dropdown and "up/down" can never disagree. A move is written to
`pricing_group_moves` by an AFTER INSERT trigger on `dataset_field_changes`
rather than in the two writers (app save, sheet import): one place, it cannot
be forgotten by a third writer, and history already recorded was backfilled
the same way. The direction is frozen when written; re-ordering the list
later does not rewrite past moves. A failure inside the trigger is a WARNING,
never a failed save. Names match ignoring case and spaces ("CK A" = "CKA").

---

## Open items

The running list of what is still to do, newest decisions above it. Tick an
item in the same PR that finishes it; delete it once the PR is deployed.

### Patrik — operations, no code

- [ ] Confirm the PR #41 deploy on Railway: green, and
      `20260925120000_agent_availability` applied.
- [ ] **Rotate the `cleanops-media-uploader` GCP service-account key** — it was
      pasted into `.env.production` and echoed into tool output (Sep 2026).
- [ ] Rotate the mailbox / Avantio passwords held in `cdm_users`
      (`passwordEmail1`, `passwordEmail2Avantio`) — they passed through a chat
      transcript during the CDM migration (Aug 2026).
- [ ] Clear the 9 orphan turnovers found on 25 Sep (Hartigova 8 ×7,
      Mahenova 8 ×2):
      `./scripts/prod.sh reconcile:turnovers -- --tenant prague-stays --apply --verify`.
- [ ] Give agents the `AGENT` role and brief them: no hours = not offered
      work; today's hours cannot be removed.
- [ ] Decide what `FRONT_DESK` / `FRONT_DESK_MANAGER` accounts may open —
      today they see Airchat only, so they cannot use Planning.

### Build — next

- [x] `codeLockBox`: decided 7 Oct 2026 — it is a link, renamed
      `urlFolderPPUklid` ("Folder PP cleaning"). Leftover FALSE cells to clean
      in the sheet.
- [ ] Admin screen for the access matrix and pick-list values (today: SQL
      or a migration). Values for `accommodation.accommodationStandard`.
- [ ] Type of `orderAccommodationAdded` (stored as text until decided).
- [ ] After deploy, before anyone edits: optionally run
      `import:cdm --list accommodation --apply` once to fill the five new
      columns from the sheet (it refuses once app edits exist).
- [ ] A log line per `'skipped'` sync result, with reference and raw status.

### Build — smaller

- [ ] Planning → Agents updates live when an agent changes hours (emit on
      the socket from `AvailabilityService`).
- [ ] Planning's default dates use the browser's day (`todayISO()`), not
      Prague's — wrong on a laptop in another time zone.
- [ ] Nothing checks `TURNOVER_SYNC_ENABLED` at boot.
- [ ] No tests, no CI beyond the Vercel build.

### Build — later, needs a design pass

- [ ] Agent check-in jobs: the desk assigns arrivals to available agents;
      takes the first tab of the agent app.
