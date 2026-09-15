# Runbook: booking backfill & turnover reconciliation

Two scripts, both booting a minimal Nest context (`scripts/lib/script-context.ts`)
so they run the real `AvantioAdapter`, `BookingSyncService` and
`TurnoverSyncService`. Nothing about Avantio or the turnover chain is
reimplemented at script level — that is what went wrong with the old
`sync-avantio-to-postgres.ts` (now in `backend/_to_delete/`, safe to delete).

Both default to **dry run**. Neither ever writes `tenant.pmsLastSyncAt`.

---

## 0. Before the first run

```bash
cd backend
npx prisma migrate deploy          # adds Turnover.skipReason + 3 indexes
npm run typecheck:scripts          # scripts are outside tsconfig.json's include
```

`TURNOVER_SYNC_ENABLED=true` is set on the Railway backend service (confirmed
30 Jul 2026), so new bookings do write turnovers. It is deliberately absent from
`backend/.env` — a local run defaults to off, and the reconciler prints a note
saying so. That note reflects *your shell*, not the server.

**Since PR #31 (4 Sep 2026) `tenants.pmsApiKey` is encrypted at rest**, so any
script that talks to Avantio (`backfill:bookings`, `diag:booking`) also needs
Railway's `CREDENTIALS_ENCRYPTION_KEY` in `backend/.env.production`. Without
it, Nest's `ConfigModule` silently falls through to the dev key in
`backend/.env`, and the script dies at `pmsConfigFor()` with *"Stored secret
could not be decrypted"* — which reads like a corrupted row and is not. Copy
the value out of the Railway backend service's Variables. (The
`AVANTIO_API_KEY` in `backend/.env` is stale — it returns 401 — so it is not a
fallback either.)

---

## 1. Measure the existing drift (do this first)

```bash
npm run reconcile:turnovers -- --tenant <slug> --all-history
```

Read-only. The report tells you how much damage the swallowed-error path in
`safelyRunTurnoverSync` has already done. Drift kinds:

| Kind | Meaning | Auto-fix |
|---|---|---|
| `MISSING` | bookings say a slot exists, no live turnover | create |
| `STALE_ENDPOINT` | turnover points at the wrong neighbour | supersede onto the right endpoints, assignments preserved |
| `TIME_DRIFT` | right endpoints, wrong `availableFrom`/`dueBy`/`isOwnerStay` | supersede with the booking-derived times |
| `DUPLICATE_ACTIVE` | two live turnovers claim one slot | keep the one with the most work, retire the rest |
| `ORPHAN` | live turnover matches no slot | mark `CANCELLED` (row kept for audit) — **only within the orphan window**, see below |
| `LEGACY_MERGE` | pre-fix merged row still `supersededById IS NULL` | reported only |
| `CHAIN_CYCLE` | `supersededById` self-reference | never touched |

Anything carrying assignments or `IN_PROGRESS`/`COMPLETED`/`FLAGGED` status is
reported as **REVIEW** and left alone. Resolve those in the UI first.

**Orphan window.** An orphan is only auto-cancelled when a cleaner could still
act on it: carry-forward date (`availableFrom ?? dueBy ?? createdAt`) within
`--orphan-window` days of now, default **2**, matching `POOL_STALE_CUTOFF_DAYS`
in `TurnoversService`. Older orphans are counted and disclosed in the report's
scope notes, but never written to — they are past the pool cutoff, so nobody can
claim them. Note this bounds the *pool*: browsing to a past month in the
calendar can still surface an old orphan. To clear those too:

```bash
npm run reconcile:turnovers -- --tenant <slug> --all-history --orphan-window 3650 --apply --verify
```

Fix it:

```bash
npm run reconcile:turnovers -- --tenant <slug> --all-history --apply --verify
```

`--verify` re-checks each property inside the same transaction. If drift
survives, that is a bug in the reconciler, not stale data — the script says so
and exits 1. Do not loop on it.

Routine use is the 7-day window (the default) as a health check:

```bash
npm run reconcile:turnovers -- --tenant <slug> --fail-on-drift
```

Exit 1 on any drift, so it works as a cron or CI check.

---

## 2. Backfill the bookings Avantio has and we missed

```bash
# what did Avantio touch in the last 30 days that we never recorded?
npm run backfill:bookings -- --tenant <slug> --updated-since 30d --find-missing

# looks right? write it
npm run backfill:bookings -- --tenant <slug> --updated-since 30d --find-missing --apply
```

- Dry run prints a per-booking diff (`created` / `updated` / `cancelled` /
  `skipped` / `error`) using a read-only mirror of `processBooking`'s change
  detection.
- Notifications are **suppressed by default**. `--notify` turns them on — only
  do that for genuinely current bookings, or 50 cleaners get a push per row.
- `--find-missing` keeps only IDs with no local `Booking`. Drop it to also
  re-sync rows you already have, which is how you catch stale check-in times.
- `--checkpoint ids-done.txt` makes a long run resumable.
- Failures are written to `backfill-failed-<slug>.txt`; feed it back with
  `--ids-file`.
- After a successful `--apply` the script re-derives
  `previousGuestCheckOutTime` across all history and then dry-run reconciles the
  turnover chains, because a backfilled booking inserts into the *middle* of an
  existing chain — the case the event handlers are weakest at.

---

## Known limitations, stated plainly

- **No unique constraint yet.** The right end state is a partial unique index on
  active `toBookingId` / `fromBookingId`. It is not in the migration because
  `TurnoverSyncService.createTurnover()` inserts first and calls
  `enforceUniqueActive()` second, so a unique index would make the insert throw
  before conflict resolution runs. Moving detection ahead of the insert is a
  separate change. Until then, `--fail-on-drift` on a schedule is the guard.
- **Overlapping bookings are not flagged.** Where two bookings at one unit
  overlap (common with midnight check-in conventions), the derived slot can have
  `dueBy < availableFrom`. The reconciler reproduces what the bookings say
  rather than second-guessing it.
- **`--since` and `--orphan-window` exclude, silently by design but loudly in
  output.** The run prints exactly what each window skipped. Drift outside them
  stays.
- **The reconciler reads per property rather than one big windowed SQL pass.**
  At ~100 units that is ~200 queries and it needs whole rows to make the
  keep-vs-retire decisions. Revisit if unit count grows by an order of magnitude.
- **`skipReason` on pre-existing rows** was backfilled to
  `MERGED_ON_CANCELLATION` because, as of that migration, nothing else wrote
  `SKIPPED`. If a manager-facing skip is added later it must set
  `MANAGER_SKIPPED`, or the reconciler will treat it as re-threadable.

## Operation log

**31 Jul 2026 — first production run (Prague Stays)**

1. `prisma migrate deploy` — `skipReason` + 3 indexes. 589 existing SKIPPED rows
   stamped `MERGED_ON_CANCELLATION`; confirmed beforehand that
   `mergeAcrossCancellation` is the only writer of that status.
2. Backfill of 737 Avantio IDs supplied as a CSV: **736 created, 1 skipped**
   (cancelled in Avantio and absent locally), 0 errors. 698 historical, 38
   future arrivals. No property had a `defaultCleanerId`, so everything landed
   `PENDING` — no auto-assignment, and nothing entered the overdue-notification
   path. Elapsed 11m28s.
3. `previousGuestCheckOutTime` full re-derivation: **589 rows corrected** — the
   ripple from inserting bookings ahead of existing ones.
4. Turnover reconcile, all history: **151 drift items across 87 of 258
   properties**, 0 needing human review. MISSING 39, STALE_ENDPOINT 89,
   TIME_DRIFT 22, ORPHAN 1. Applied with `--verify`; convergence confirmed
   inside each property transaction. 47 orphans older than the 2-day window
   left in place by policy.

Notable findings from that run:

- **The owner-stay bug was real and bidirectional.** 22 TIME_DRIFT items were
  mostly stale `isOwnerStay` flags. Several were `false -> true`: cleanings
  before an actual owner arrival that showed no owner-stay banner at all
  (Štupartská 18 units 2 and 3, Sokolovská 136).
- **One turnover had times from `new Date()`** rather than from its bookings
  (Legerova 27/4: `availableFrom` 2026-06-24T23:08:06.106Z, three days off).
  Origin unknown — worth investigating if more appear.
- **`make_interval(days => $1)` failed in production with 42883.** Prisma binds
  JS numbers as `int8` and Postgres has no bigint overload. The backfill used
  the `null` (full-history) branch, which skips `make_interval` entirely, so the
  windowed branch's first execution was on the cron. Fixed with `::int`
  (PR #2). Lesson: exercise both branches of a conditional SQL fragment.

**13–15 Sep 2026 — bookings lost at the cron boundary (A203-HMED24DNKZ, A203-HMMXNMKQSY, +5)**

Two bookings reported as present in Avantio and absent from `bookings`; a
cleaner found the second one. Both Airbnb, both `UNPAID`/`CONFIRMED` (a UI
"Pre-booking" is `UNPAID` in the API — active, not skipped), both on properties
that resolve, neither in `pms_sync_failures`, no audit row, no `Cleaning`, no
`Turnover`. Sync healthy throughout: watermark minutes old, 38–82 bookings
created per day.

Two earlier drafts of this entry blamed the Pre-booking status and then cursor
pagination. Both were wrong and are gone; what follows is what the data showed.

*Census* (`backfill:bookings --updated-since 30d --find-missing`, dry run):
2,493 ids touched in 30 days, 513 with no local row, of which **506 are
correctly absent** (cancelled / inquiries / owner blocks) and **7 are real
misses** — 0.3%, six different units, arrivals 9 Sep to 11 Nov. Same order as
the 0.54% measured on 22 Aug, so this leak predates the watermark fixes and
is a separate mechanism.

*Window test* (`diag:booking --id … --window-test`): both reported bookings
are returned by `GET /bookings` for `updatedAt_from` windows the cron would
have asked for. So Avantio offered them; the app never listed them; nothing
was queued (anything that reaches `pullBookings` and fails is queued). The
loss is inside `collectBookingIds`' *window*, not in fetching or processing.

*The proof* (`diag:boundary`): for all 8,730 bookings updated in 120 days,
the distance of `updatedAt` from a `*/30` cron firing is uniform (7.19%
within 60 s; uniform is 6.67%). **All 7 lost bookings sit 0.0–22.3 s after a
firing.** Under the null that is ~6×10⁻⁹. Two of them (`33900567`, `33877165`)
have `updatedAt` of exactly `hh:00:00.000` / `hh:30:00.000` — Avantio runs a
scheduled job on the half hour that touches bookings, at the same instant our
cron fires.

*Mechanism.* `pmsLastSyncAt` is our wall clock; `updatedAt_from` filters on
Avantio's clock. A booking stamped `updatedAt = 13:00:09` that is not yet
queryable when the run's list call goes out at ~13:00:30 (replication lag, or
a channel import that stamps before it commits) is missed by that run, which
then writes `pmsLastSyncAt = 13:00:30`. Every later run asks
`updatedAt_from = 13:00:30` — later than the booking's `updatedAt`. It is
excluded forever unless Avantio touches it again, which a settled Airbnb
booking never is. No error, no queue entry, no log line.

*Fix* (both halves, `booking-sync.service.ts` + `jobs.module.ts`):

1. **Overlap.** `since = pmsLastSyncAt − SYNC_OVERLAP_MS` (15 min). The
   watermark itself is unchanged. `processBooking` is idempotent and emits
   nothing when nothing changed, so the cost is a handful of re-reads per run.
2. **Move off the half hour.** `@Cron('7,37 * * * *')` instead of
   `*/30`, so we no longer fire at the instant Avantio's own job stamps
   `updatedAt`.

*Remediation, as run on 15 Sep:*

1. `backfill:bookings --updated-since 120d --find-missing` (dry run): still
   exactly the same 7 — no older backlog.
2. `backfill:bookings --updated-since 30d --find-missing --apply`: 7 created,
   7 `previousGuestCheckOutTime` rows corrected; the trailing reconcile
   reported 9 drift items on 5 properties (mid-chain inserts — expected).
3. `reconcile:turnovers --all-history --apply --verify`: MISSING 3 +
   STALE_ENDPOINT 3 applied and verified. 3 IMPOSSIBLE_WINDOW left for
   review — ghosts (cancelled in Avantio, CONFIRMED here) on Studentská 4/55
   and Nebozízek 23/2. **A missed cancellation is the same boundary race**,
   so it was fixed the same way:
4. `backfill:bookings --updated-since 30d --apply` (no `--find-missing`, so
   present rows are re-synced): **updated 107, cancelled 3**, 5 timeouts
   retried from `backfill-failed-prague-stays.txt`; trailing reconcile:
   *Chains are consistent.* The 107 are lost *modifications* — the third
   costume of the same bug.

Order matters: the reconciler cannot fix a ghost, only report it; the re-sync
turns the ghost into a real cancellation and the chain heals itself.

*Also learned:* `GET /bookings` accepts only `sort` ∈ {`creationDate`,
`updatedAt`, `arrivalDate`, `departureDate`, `createdAt`} (± prefix) and
`pagination_size` ≥ 10 — `sort=id` is a 400. The 120-day enumeration returned
8,730 unique ids with 0 duplicates, so cursor pagination on `-updatedAt` is
sound.

*Tooling:* `diag:booking` (one booking, every local key, Avantio detail,
property mapping, window test), `diag:boundary` (the cadence test above),
`diag:list-sort` (sort comparison; superseded by the sort list above), and
`_diag/run-missing-diag.sh` (all of it for N references plus the census).

---

## Still open

- **Deploy the cron-boundary fix and backfill the 7** (see 13–15 Sep entry).
  After deploy, confirm in the Railway log that runs fire at :07/:37 and that
  each `Bookings list page 1 since …` timestamp is ~15 min behind the previous
  run's start.
- **Nightly `--find-missing` sweep as a `@Cron`** (7-day window,
  notifications suppressed). The overlap closes the measured hole; the sweep
  is the guard that is indifferent to the cause — it found all 7 before the
  cause was known. Log every `'skipped'` with reference and raw status.
- **`--find-missing` over 120 days, dry run**, to size the backlog older than
  the 30-day census.
- Deploy verification: confirm the cron logs
  `Reconciled previousGuestCheckOutTime on N cleanings` rather than a warning.
- Standing health check not yet wired:
  `reconcile:turnovers --since 7d --fail-on-drift` on a schedule.
- 158 turnovers sit in `IN_PROGRESS` — cleaners tapping Start and never Done.
- `OverdueCheckJob` has no lower bound on `checkInTime`, so any past `ASSIGNED`
  cleaning would notify every manager hourly, forever. Harmless today only
  because no property has a `defaultCleanerId`.
- Partial UNIQUE index on active turnover endpoints (see limitations above).

## Verification status

`npm run typecheck:scripts` is clean for all new and edited files. It was
checked against types generated mechanically from `schema.prisma` (that
environment could not download Prisma's engines, so `prisma generate` was
unavailable) — every model field and enum member is confirmed against the real
schema, but query *arguments* and raw-SQL types were not, which is exactly how
the `make_interval` bug reached production. Both scripts have now been run
against the production database; see the operation log above.
