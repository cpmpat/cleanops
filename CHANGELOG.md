# Deploy log

Every merge into `main` triggers a deploy. This file is the record of what
went out and when — the thing git history cannot tell you, because a commit
existing is not the same as a commit running.

**Add an entry in the same PR as the change.** If it lands here after the
merge it will not land here at all, and the next person will reconstruct it
by hand from commit subjects, which is how the migration list in
`airchat-deploy-runbook.md` had to be built.

Each entry answers the three questions asked at 2am:

- **What changed** — one or two lines, in terms of what an operator sees.
- **Migrations** — named, in order, or the word *None*. Never blank.
- **Env** — new or changed environment variables, or *None*.

Rollback for everything below is a revert of the merge commit unless the
entry says otherwise. Migrations are additive by convention; reverting code
leaves the columns and tables in place, unread.

Entries are newest first. Dates are the merge date.

---

## Unreleased — branch `feat/planning-turnover-status`

**Planning shows what the cleaner actually did.** The row's status badge and
assignees now come from the live *arrival* turnover (the cleaning before this
guest checks in) instead of the legacy `Cleaning` row, which stayed
`PENDING · Unassigned` forever once cleaners moved to turnovers. So *In pool
→ Assigned → In progress → Completed* is finally visible to the desk, and
completed rows stay listed (muted). Assigning from Planning writes to the
turnover (`POST /turnovers/:id/assign` / `unassign`), so the cleaner sees it
and the audit trail has it. The status filter, which compared a cleaning
status against `bookings.status` and matched nothing, now filters on the
turnover status. Retirement plan, item 6.

**Last-minute mark for the desk.** Same rule as the cleaner's card — guest
arrives today and the turnover was created today — shown as a red *Last
minute* chip and a red left edge on the row.

*Migrations:* None. *Env:* None.

---

## Deployed

### 2026-09-21 · PR #34

**Crib and separate beds, from the desk to the cleaner.** Two setup requests
on the booking — *crib* and *separate beds* — toggled per row in Check-in
Planning. They are ours, not Avantio's: stored on `bookings`
(`needsCrib`, `separateBeds`), never pushed to the PMS, never touched by the
sync (`processBooking` writes only PMS-owned columns). The cleaner sees them
as labelled chips on the turnover card next to the guest count, in all four
languages.

**Planning shows the party.** Guest count per row in the cleaner's own
reading (`2+1` = two adults, one child). Time inputs widened so `00:00` and
the clock glyph no longer overlap.

*Migrations:* `20260921200000_booking_setup_requests` (two boolean columns,
default false). *Env:* None.

### 2026-09-21 · PR #33

**Check-in Planning: typed times are the times Avantio gets.** Editing a
check-in to 15:10 pushed 17:10 to Avantio and showed 17:10 in the list — the
page built the instant as `${date}T${HH:mm}:00.000Z`, Prague wall-clock
labelled as UTC (the same fault as §2.1 of the July script review, in a second
place). The page now sends plain `HH:mm`; the backend resolves it on the
booking's own day in Europe/Prague with `atTimeInAppZone`, the one helper the
sync already uses. `PATCH /integrations/planning/bookings/:id` accepts `HH:mm`
or an ISO instant.

**Times display in Europe/Prague everywhere.** `formatTime()` no longer follows
the device's zone, so a phone set to another zone shows the same arrival time
as the desk. Fixes the "Frontend timezone" item from the runbook's Still open.

**Planning view for the front desk.** *Next 24 / 48 / 72 h* quick filters,
measured from now; check-in and check-out editable inline on every row, with a
sticky *N changes → Push to Avantio* bar (three at a time, per-row result,
failed rows stay marked) and per-row push / undo; the guest's name under the
unit; ref search also matches the guest. The edit modal is gone.

**Arrival date range fixed.** A bare date bound was midnight UTC, so
`To = 30 Sep` silently dropped nearly every arrival on the 30th. Bare dates now
mean the whole Prague day; ISO instants (the quick filters) are taken as-is.

*Migrations:* None. *Env:* None.

### 2026-09-15 · PR #32

**Bookings lost at the cron boundary — fixed.** Seven bookings Avantio had
and we never created (one found by a cleaner) all carried an `updatedAt`
0–22 s after a `*/30` sync firing; the population is uniform. The watermark
(our clock) and the filter (`updatedAt_from`, Avantio's clock) had no
overlap, so a booking not yet queryable at the instant of the list call was
skipped and then excluded by every later window. The same race dropped
cancellations (3 ghosts) and modifications (107 stale rows). Two changes: the
window now starts 15 min behind `pmsLastSyncAt`
(`BookingSyncService.SYNC_OVERLAP_MS`; the watermark itself is unchanged and
`processBooking` is idempotent), and the cron fires at `:07` and `:37` instead
of on the half hour, when Avantio's own job stamps `updatedAt`. Operator-visible
effect: none, except that the "why is this booking missing" call stops coming.
Data already repaired on 15 Sep by `backfill:bookings` + `reconcile:turnovers`
(runbook operation log, 13–15 Sep).

**Read-only diagnostics:** `pnpm diag:booking`, `pnpm diag:boundary`,
`pnpm diag:list-sort` (see `backend/docs/SYNC-BACKFILL-RUNBOOK.md`).

*Migrations:* None. *Env:* None — but every maintenance script that talks to
Avantio now needs Railway's `CREDENTIALS_ENCRYPTION_KEY` in
`backend/.env.production` (runbook §0).

### 2026-09-04 · PR #31

**PMS credential encrypted at rest.** `tenants.pmsApiKey` was a plaintext
column, and `GET /tenant` returned it to the browser so the Settings input
could be pre-filled — putting the key in every Neon backup and any HAR file.
It is now AES-256-GCM under `CREDENTIALS_ENCRYPTION_KEY`, decrypted in one
place (`pmsConfigFor`), and the API returns only whether a key is set and its
last four characters. The Settings key field became write-only: blank means
"keep the current key", so saving the sync toggle no longer touches the
credential. Rotations are audited (`tenant.pms_credentials.rotated`). Legacy
plaintext still decrypts, so there was no migration — a key encrypts itself
the next time it is saved. The seed encrypts too, since its upsert refreshes
the key on every run.

**Saved table views.** The datasets table remembers hidden columns, value
filters, sort, frozen rows and columns, and the group tint, per dataset, per
user, in the `preferences` JSON. Search deliberately not remembered.

**Dated change notifications.** Cleaner change cards gained an explicit
received date in all four languages, replacing a chat-style stamp that showed
a time with no day; the list sorts newest-first on the client.

*Migrations:* None.
*Env:* **`CREDENTIALS_ENCRYPTION_KEY` — new, required.** Set on the backend
service before this deploy. Without it the app still boots and still reads an
existing plaintext key; only *saving* a credential fails.

### 2026-09-01 · PR #29
`feeAdmin` settled as a number; four more columns typed correctly; the CDM tab
found by how it is actually spelled; import refuses a repeated column name.
The two `feeAdmin` migrations that cancelled each other out were dropped
before deploy.
*Migrations:* `20260901010000_accommodation_text_columns`. *Env:* None.

### 2026-09-01 · PR #28
Datasets export to CSV and XLSX, through the same read as the screen, so the
file matches the table rather than the whole dataset.
*Migrations:* None. *Env:* None.

### 2026-09-01 · PR #27
Accommodation migrated in from the CDM sheet: column families tinted,
per-role ordering, link columns at 72px instead of 190. Diacritics in a column
name are no longer a broken identifier. `--show-keys` on the importer.
*Migrations:* `20260831020000_cdm_accommodations`. *Env:* None.

### 2026-08-31 · PR #26
The service-account JSON needs single quotes; `prod.sh` now says so.
*Migrations:* None. *Env:* None.

### 2026-08-31 · PR #25
The User list moved into Postgres, with "Add new". `typecheck:scripts` stopped
reporting two phantom errors on every run.
*Migrations:* `20260830090000_cdm_datasets_and_roles`. *Env:* None.

### 2026-08-31 · PR #24
Stream filters by unit and date range, and opens on the first unit.
*Migrations:* None. *Env:* None.

### 2026-08-29 · PR #23
The frozen band is measured rather than guessed, closing the seam rows showed
through. A repeated column name was eating its own label.
*Migrations:* None. *Env:* None.

### 2026-08-29 · PR #22
Freeze panes and sortable headers; the mapping tab is found by asking.
*Migrations:* None. *Env:* None.

### 2026-08-29 · PR #21
Survive the pre-mapping API shape during a rollout; tab bar stopped floating.
*Migrations:* None. *Env:* None.

### 2026-08-29 · PR #20
Operator vocabulary from the sheet's mapping tab, row filters, frozen columns.
*Migrations:* None. *Env:* None.

### 2026-08-29 · PR #19
**Boot fix** — the datasets module never imported AuthModule, so the app died
at startup.
*Migrations:* None. *Env:* None.

### 2026-08-29 · PR #18
Lockfile committed for `google-auth-library`; rebuild trigger.
*Migrations:* None. *Env:* None.

### 2026-08-29 · PR #17
Datasets reads the CDM spreadsheet instead of promising to. Frozen panes,
sortable headers, row filters, operator vocabulary.
*Migrations:* `20260829140000_datasets_sheet_id`. *Env:* None.

### 2026-08-25 · PR #16
Reconcile: a midnight arrival only explains a window inverted by hours; the
actionability test was hiding the one shape that mattered.
*Migrations:* None. *Env:* None.

### 2026-08-25 · PR #15
Avantio connection test now asks the question the sync actually asks.
*Migrations:* None. *Env:* None.

### 2026-08-25 · PR #14
Sync watermark stopped discarding the windows it failed to read; failures
are recorded rather than lost. Reconcile stopped flagging the whole archive
as IMPOSSIBLE_WINDOW and stopped claiming work that isn't there.
*Migrations:* `20260825030000_pms_sync_failures`. *Env:* None.

### 2026-08-22 · PR #13
Check-in ties break the same way on both sides. Reconcile stopped reporting
every old cleaning as an orphan and shows progress, because silence reads
as a hang. Script `--` argument forwarding fixed.
*Migrations:* None. *Env:* None.

### 2026-08-22 · PR #12
Stop trusting Avantio's "0:00" check-in, and remember who set the time.
*Migrations:* `20260818090000_time_source`. *Env:* None.

### 2026-08-21 · PR #11
**Airchat** — the front-desk console, and the first real permission split.
Inbox & Notifications with three tabs, conversations on a turnover, turnover
chats split from direct chats, chats on the Stream timeline with star and
30-day archive, six new roles in the model plus operation manager.
*Migrations:* `20260817030000_more_user_roles`,
`20260817040000_conversations`,
`20260817050000_turnover_chats_star_archive`,
`20260817060000_direct_chats`,
`20260817070000_operation_manager_role` — order matters, `050000` renames
tables that `040000` creates. *Env:* None.
See `airchat-deploy-runbook.md` for the post-deploy role assignment steps.

### 2026-08-17 · PR #10
Cleaner Notifikace tab with two badges — blue for messages, red for today's
arrivals.
*Migrations:* None. *Env:* None.

### 2026-08-17 · PR #9
Select the whole team in one tap when composing a message. A refreshed token
now carries the role from the database rather than the stale one.
*Migrations:* None. *Env:* None.

### 2026-08-17 · PR #8
**Production crash fix** — body limit set through Nest instead of a direct
express import.
*Migrations:* None. *Env:* None.

### 2026-08-17 · PR #7
In-app manual, and a session that survives an always-open tab (silent token
refresh plus a stale-bundle guard). Build-id route moved out of a gitignored
path.
*Migrations:* `20260817010000_help_docs`. *Env:* None.

### 2026-08-17 · PR #6
Manager message composer with mandatory confirmation, property notes,
WhatsApp numbers, cleaner message band, property note on the card, and a
socket that survives sleep.
*Migrations:* `20260816200000_manager_notes`. *Env:* None.

### 2026-08-03 · PR #5
Reject writes to superseded turnover rows; broadcast PMS-driven changes.
*Migrations:* None. *Env:* None.

### 2026-08-03 · PR #4
Count Avantio children by group amount, not array length.
*Migrations:* None. *Env:* None.

### 2026-07-31 · PR #3
Today and HH:mm resolve in Europe/Prague. Turnover photos and manager
assignment.
*Migrations:* `20260731120000_turnover_photos`. *Env:* None.

### 2026-07-31 · PR #2
Cast the `make_interval` days argument to int.
*Migrations:* None. *Env:* None.

### 2026-07-31 · PR #1
Chain-integrity reconciler, ID-driven backfill API, notification
suppression, bounded reconcile, owner-stay flag and property moves in chain
sync, `reconcile-turnovers` and `backfill-bookings` scripts.
*Migrations:* `20260729190000_turnover_skip_reason_and_indexes`.
*Env:* None.

---

## Before pull requests (2026-03-26 → 2026-06-30)

60 commits went straight to `main`, so there is no merge to hang an entry
on and no reliable record of when each reached production. Reconstructed
from history, by month:

- **June** — cleaner calendar tab with a multi-unit booking timeline,
  continuous day lanes, diagonal changeover seam, sticky day strip; explicit
  start step with `startedAt`; cleaner stats in the Mine header; PMS sync
  cadence cut from 5 to 30 minutes to reduce Neon compute.
- **May** — turnovers replace cleanings as the cleaner-facing model, with
  carry-forward grouping and a three-state pill; rolling 5-day pool cutoff;
  repairs; incidents; owner-stay flag; GCS per-folder property markers;
  `preferences` sourced from Postgres everywhere.
  *Migrations:* `20260512152516_split_booking_cleaning`,
  `20260512195620_add_booking_ref_to_cleaning`, `20260513120346_repairs`,
  `20260515084043_cleaning_previous_guest_checkout`,
  `20260515112018_add_owner_stay_flag`, `20260519112928_add_turnover_model`,
  `20260520223328_drop_turnover_superseded_unique`.
- **April** — first commit of the portal (2026-04-27) carrying the schema
  as it then stood: `20260326163917_init`,
  `20260407222810_staff_sync_and_audit`,
  `20260412175848_cleaning_pool_max_cleaners`, `20260421215454_incidents`.
  GCP staff sync from BigQuery `cdm_user`, daily at 03:00 Europe/Prague.
