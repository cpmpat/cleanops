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

## Unreleased — branch `feat/airchat-inbox`

Everything from 2026-08-30 onward. Not on `main`, not deployed.

**Saved table views + dated change notifications** (2026-08-31)
The datasets table remembers hidden columns, value filters, sort, frozen
rows and columns, and the group tint, per dataset, per user — stored in the
`preferences` JSON the cleaner pool filter already uses. Search is
deliberately not remembered. Cleaner change cards gained an explicit
received date in all four languages, replacing a chat-style stamp that
showed a time with no day, and the list sorts newest-first on the client.
*Migrations:* None. *Env:* None. Frontend only.

**CDM datasets** (2026-08-30 → 08-31)
The User list moved into Postgres; Accommodation migrated in from the CDM
spreadsheet with column families tinted, per-role column ordering, operator
vocabulary from the sheet's own mapping tab, link columns at 72px, row
filters, frozen panes, sortable headers, and CSV/XLSX export through the
same read as the screen. Stream gained unit and date-range filters.
*Migrations:* `20260830090000_cdm_datasets_and_roles`,
`20260831020000_cdm_accommodations`,
`20260901010000_accommodation_text_columns` — in that order.
*Env:* None.

> Two `feeAdmin` migrations were written and then dropped (they cancelled
> each other out). They are in `_to_delete/migrations/` and must **not** be
> deployed.

---

## Deployed

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
