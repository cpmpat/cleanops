# Who can open what

The current access of each role, as the code enforces it. Update this file in
the same PR as any change to role checks, the desk-path list in the manager
layout, or the dataset access matrix.

Three layers decide access:

1. **API** — `AuthGuard` admits an active account only, with its current role
   (database, cached 60 s — a deactivation or role change applies within a
   minute). Then `@Roles(...)` + `RolesGuard` per endpoint; `ADMIN` passes
   every role check. Endpoints with no `@Roles` are open to any signed-in
   account.
2. **Screens** — `ROLE_PATHS` in the manager layout lists what each role other
   than MANAGER may open (anything else is absent from the menu and
   redirects): ADMIN → Planning, Dashboard, Data;
   FRONT_DESK_MANAGER and FRONT_DESK → Planning, Data; OPERATION_MANAGER and
   ASSIST → Airchat, Data; EVIDENCE → Data only. Login sends ADMIN,
   FRONT_DESK_MANAGER and FRONT_DESK to Planning, EVIDENCE to Data, MANAGER to
   the Dashboard, agents to Availability.
3. **Data** — the dataset access matrix (`dataset_field_access`), per role ×
   list × column: none / view / edit. No row = no access.

## ADMIN, FRONT_DESK_MANAGER, FRONT_DESK — as of `feat/dataset-access-matrix`

| Area | ADMIN | FRONT_DESK_MANAGER | FRONT_DESK |
|---|---|---|---|
| Lands on after login | Planning | Planning | Planning |
| Manager app menu | Dashboard, Planning, Data | Planning, Data | Planning, Data |
| Dashboard | Yes | No | No |
| Schedule, Stream, Incidents, Repairs, Airchat, Messages, Staff, Properties, Settings | No (hidden; the API still admits ADMIN) | No | No |
| Planning — view, push check-in/out times, crib/separate beds | Yes | Yes | Yes |
| Planning — assign / reassign cleaners | Yes | Yes | Yes |
| Planning → Agents | Yes | Yes | Yes |
| Airchat | Not in the menu | Not in the menu (the API still admits them; chats they are members of open from notifications) | Same |
| Data → Accommodation | View all 169 columns, edit none | View 116, edit 15 | View 116, edit 13 |
| Data → User | View all, edit none | Hidden | Hidden |
| Data → OX Point | Hidden until granted | Hidden until granted | Hidden until granted |
| Data → Owner | View all columns | View 16 (matrix) | View 16 (matrix) |
| Notifications → Data | Yes (notify matrix: all columns at start) | No (since 15 Oct 2026; has the Newsfeed) | No |
| Data export (CSV/XLSX) | Yes | No | No |
| Change history in the record drawer | All fields, incl. sensitive (who/when only) | Fields they can view, sensitive excluded | Same |
| Create records in Data | No (off for everyone) | No | No |
| Cleaner app (pool, claim, mine) | Redirected | Redirected | Redirected |

Accommodation edit rights (from `matrixFieldsAccessRoles.csv`, 29 Sep 2026):

- **Both:** capacity, bedrooms, bathrooms, floor, elevator, bed, bed2,
  propertyFactWifiName, propertyFactWifiPassword, buildingUnderConstruction,
  contactBuildingManagement, accommodationStandard.
- **FRONT_DESK_MANAGER only:** maximumTimeRelease, bellLabel,
  allowedSpendingForRepairs.
- **FRONT_DESK only:** sizeM2.

Both desk roles may view the channel credentials (passwordGmail,
passwordAirbnb, passwordBooking, email columns) and the lockbox codes
(lockboxCode) — confirmed 29 Sep 2026. (codeLockBox was renamed
urlFolderPPUklid on 7 Oct 2026: it held folder links, not codes.)

Owner (`docs/access-matrix/owner.csv`, 1 Oct 2026), both desk roles view:
id, treatment, displayName, language, email1, email2, mobile, city, country,
vatPayer, identifiedVatPayer, ICO, birthNumber, cityTaxSubject,
cityTaxVariableSymbol, validity. Hidden: name, surnames, address, IBAN, the
document serials. birthNumber is a personal identifier — granted on purpose.

Owner moved from the sheet into Postgres on 6 Oct 2026; it works like
Accommodation now. Sheet-backed lists (none left) would follow the matrix for
every role but MANAGER and ADMIN, matched on the sheet's header names, view
only.

## MANAGER in Data

View and edit on every column of every CDM list, outside the matrix
(`FULL_EDIT_ROLES`, 8 Oct 2026); the record key stays read-only.

## Newsfeed

MANAGER, ADMIN, FRONT_DESK_MANAGER, OPERATIONS_ASSISTANT, FRONT_DESK, EVIDENCE,
DIRECTOR, FINANCE, REVENUE_MANAGER, MARKETING_MANAGER, MARKETING_SPECIALIST
(`NEWSFEED_ROLES`). Since 15 Oct 2026 every one of them (and ADMIN) starts
on the Newsfeed after signing in (`frontend/lib/home.ts`). An item shows only
to a role that may view the field it is about (access matrix). DIRECTOR, FINANCE,
REVENUE_MANAGER and MARKETING_MANAGER: menu = Newsfeed + Data, start on the
Newsfeed.

## OPERATIONS_ASSISTANT, MARKETING_SPECIALIST (15 Oct 2026)

OPERATIONS_ASSISTANT has FRONT_DESK_MANAGER's modules: Planning, Newsfeed,
Data, office role for Airchat's API; starts on Planning. (Notifications →
Data was removed from both on 15 Oct 2026.) MARKETING_SPECIALIST has MARKETING_MANAGER's: Newsfeed +
Data, starts on the Newsfeed. Their Data columns are the matrices' — granted
on Accommodation and OX Point; none yet on Owner and User.

## Lookup and key columns

Accommodation's OX Point columns (oxpointCity … oxpointAccessibilitysummary)
are view-only for every role, MANAGER included: they are copied from the OX
Point chosen in `oxPointId` (a pick list of OX Point codes, `id`) and follow it.
A list's record key (idAvantio, OX Point `id`, …) is view-only for every role,
whatever the matrix says.

## DIRECTOR, TERENAK

Data only (menu and start page), since 7 Oct 2026. Columns are the access
matrix's. TERENAK additionally sees only some rows (`dataset_row_filters`):
Accommodation where source = "Avantio", User where validity = "Valid". The
filter applies to reading, saving, history and export. Neither role has
Notifications yet.

## Notifications → Data

Changes to the CDM lists (app saves and sheet reloads). Open to ADMIN and
MANAGER only (menu: Notifications → Data) since 15 Oct 2026, when
FRONT_DESK_MANAGER, OPERATIONS_ASSISTANT and EVIDENCE moved to the Newsfeed.
Their notify-matrix rows are kept, unused, so turning it back on is a code
change only. A role
sees a change only when the notify matrix (`dataset_field_notify`,
`docs/notify-matrix/`) says so AND the access matrix lets it view the field.
Changes to sensitive fields carry no values and are listed for MANAGER and ADMIN only (MANAGER added 16 Oct 2026).

## EVIDENCE

Data and Newsfeed (since 15 Oct 2026; Notifications removed) — starts on
the Newsfeed; every other screen redirects there. Which lists and columns it sees, and whether it may edit any, is the
access matrix alone (`docs/access-matrix/`). Accommodation: view 42 columns
(identity, channels, contract, city tax, Ubyport, evidence folders), edit the
five Ubyport columns. Owner: view 8 (id, treatment, displayName, language,
email1, email2, mobile, city). No export.

RESOLUTIONS still has no screen defined:
after login they see a "no screens yet" page (`/no-access`); the cleaner app
admits only CLEANER and AGENT. Define them before any
account gets one of those roles.

## What the API enforces (audit of 15 Oct 2026, `fix/access-audit`)

Every controller was read endpoint by endpoint. The rule now: a screen being
hidden is not the protection — the API refuses on its own.

| Endpoint | Who |
|---|---|
| `GET /users`, `/users/:id`, workload | MANAGER (ADMIN passes every check). No user response ever carries `passwordHash`, `magicLinkToken` or `pushSubscription`. |
| `PATCH /users/:id` | MANAGER; only name, role, language, isActive, mobileNumber |
| `POST /admin/staff-sync/:tenantId/run` | MANAGER (the company's administrator), own tenant only (was open to the internet) |
| `GET /turnovers`, `/turnovers/:id` | office roles (OFFICE_ROLES) |
| `GET /turnovers/pool`, `/pool/today-arrivals/count` | CLEANER (own filter) + office roles |
| `GET /turnovers/mine`, `/me/stats` | self |
| `GET /cleanings`, `/cleanings/:id`, `/calendar/:y/:m` (legacy) | MANAGER; `/pool` CLEANER + MANAGER; `/mine` self |
| `GET /bookings/:id`, `GET /streams` | MANAGER |
| `GET /incidents`, `/incidents/:id` | MANAGER/ADMIN all; anyone else only incidents they reported |
| `GET /repairs/:id`, comments | MANAGER/ADMIN; anyone else only if assigned |
| `GET /properties` | everyone; non-office roles get id, name, address, pmsPropertyId, type only |
| `GET /properties/:id` | office roles |
| `POST /uploads/read-url` | key must be `{pmsPropertyId}/{file}` of a unit in the caller's tenant; ≤ 60 min |
| `POST /uploads/event/:id/photo` (legacy) | MANAGER, cleaning in caller's tenant |
| conversations | members; office roles any thread (unchanged) |
| Data: lists, read, history, save | access matrix + row filters (unchanged); export MANAGER |
| `GET /datasets/search` | one column per list (Accommodation titleAvantio, Owner displayName, OX Point street), only if the role may view it, within its row filter |
| Live updates (socket) | office roles get full payloads; every other socket only `{id, status, source, at…}` and reloads through the endpoints above |

## Tasks (16 Oct 2026)

| Who | May |
|---|---|
| Every office-app role (MANAGER, ADMIN, OPERATION_MANAGER, FRONT_DESK_MANAGER, OPERATIONS_ASSISTANT, FRONT_DESK, ASSIST, EVIDENCE, TERENAK, DIRECTOR, FINANCE, REVENUE_MANAGER, MARKETING_MANAGER, MARKETING_SPECIALIST) | see the board, open any task, comment, tag (@), watch, set "waiting on" |
| MANAGER, FRONT_DESK_MANAGER, DIRECTOR, REVENUE_MANAGER (+ ADMIN) | create, edit, assign, clear anyone's "waiting on", remove any record link |
| The task's creator | close (Done / Won't do) and reopen — nobody else, unless the creator's account is deactivated (then any role above) |
| Assignees of a task | move it between the open stages, suggest closing (move to Review), link records |
| Linking records | only lists, rows (row filter) and attributes the linker may view; each viewer sees a link named by their own access, else "Restricted record" |
| Whoever set a "waiting on" | clear it (the waited-on person clears it by replying) |

Only office-app users can be assigned or tagged. CLEANER, AGENT and
REPAIRMAN have no access yet; when they do, they get only tasks they are
involved in (`TasksService.visibleWhere`). Roles: `TASK_ROLES` and
`TASK_MANAGER_ROLES` in `backend/src/common/roles.ts`.

## Known gaps

- Photo keys are scoped to the tenant, not to the person: a signed-in
  cleaner who knew another unit's photo key could still have it signed.
  Keys are timestamp + random and never listed to her, so this needs a
  leaked key, not a guess.
- The Newsfeed sentence names the record by its title column (titleAvantio
  etc.) even for a role whose matrix lacks that column; every Newsfeed role
  has it today.
- New dataset columns and lists (OX Point) are invisible to every role,
  MANAGER and ADMIN included, until granted. Grants are loaded from the
  matrix CSV with `import:access-matrix` (dry run by default); there is no
  admin screen yet.
