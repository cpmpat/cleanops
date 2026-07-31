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

## Still open

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
