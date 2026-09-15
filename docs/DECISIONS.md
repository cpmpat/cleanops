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

---

## Standing follow-ups (not yet decided or built)

- **Nightly `--find-missing` sweep** on the existing `@Cron` scheduler,
  7-day window, notifications suppressed — the guard that is indifferent to
  the cause; it found all seven bookings before the cause was known.
- **A log line per `'skipped'` sync result** with reference and raw status.
- **Rotate the `cleanops-media-uploader` GCP service account** — its key has
  been pasted into `.env.production` files and echoed into tool output;
  already on the security review's list.
- **Nothing checks `TURNOVER_SYNC_ENABLED` at boot**; **no tests, no CI**
  (runbook, Still open).
