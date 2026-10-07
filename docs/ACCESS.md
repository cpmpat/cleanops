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
| Notifications → Data | Yes (notify matrix: all columns at start) | Yes (notify matrix; nothing until loaded) | No |
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

## Newsfeed

MANAGER, ADMIN, FRONT_DESK_MANAGER, FRONT_DESK, DIRECTOR, FINANCE,
REVENUE_MANAGER, MARKETING_MANAGER (`NEWSFEED_ROLES`). An item shows only to a
role that may view the field it is about (access matrix). DIRECTOR, FINANCE,
REVENUE_MANAGER and MARKETING_MANAGER: menu = Newsfeed + Data, start on the
Newsfeed.

## DIRECTOR, TERENAK

Data only (menu and start page), since 7 Oct 2026. Columns are the access
matrix's. TERENAK additionally sees only some rows (`dataset_row_filters`):
Accommodation where source = "Avantio", User where validity = "Valid". The
filter applies to reading, saving, history and export. Neither role has
Notifications yet.

## Notifications → Data

Changes to the CDM lists (app saves and sheet reloads). Open to ADMIN,
MANAGER, FRONT_DESK_MANAGER and EVIDENCE (menu: Notifications → Data). A role
sees a change only when the notify matrix (`dataset_field_notify`,
`docs/notify-matrix/`) says so AND the access matrix lets it view the field.
Changes to sensitive fields carry no values and are listed for ADMIN only.

## EVIDENCE

Data only — the menu shows nothing else and every other screen redirects to
Data. Which lists and columns it sees, and whether it may edit any, is the
access matrix alone (`docs/access-matrix/`). Accommodation: view 42 columns
(identity, channels, contract, city tax, Ubyport, evidence folders), edit the
five Ubyport columns. Owner: view 8 (id, treatment, displayName, language,
email1, email2, mobile, city). No export.

RESOLUTIONS still has no screen defined:
after login they see a "no screens yet" page (`/no-access`); the cleaner app
admits only CLEANER and AGENT. Define them before any
account gets one of those roles.

## Known gaps

- Several read endpoints carry no role check and answer any signed-in
  account (e.g. `GET /turnovers`, `GET /bookings/:id`, `GET /incidents`,
  `GET /properties`, `GET /users/:id`). The screens do not expose them to the
  wrong roles, but the API does. Not yet audited endpoint by endpoint.
- New dataset columns and lists (OX Point) are invisible to every role,
  MANAGER and ADMIN included, until granted. Grants are loaded from the
  matrix CSV with `import:access-matrix` (dry run by default); there is no
  admin screen yet.
