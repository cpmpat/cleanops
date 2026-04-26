# CleanOps — Session Summary (April 7–13, 2026)

Paste this at the start of the next conversation so Claude has full context.

---

## What CleanOps is

Multi-tenant cleaning operations portal for Prague Stays (short-term rental management, ~50 cleaning staff). Two interfaces: mobile-first for cleaners, desktop admin for managers. Avantio PMS is the source of truth for bookings.

**Tenant:** Prague Stays, slug `prague-stays`, ID `c944937a-10a9-4380-abe6-754c3de756b6`
**Admin account:** `cpm@airstayprague.cz` (Patrik Neto), `isSyncManaged: false` — protected from GCP sync

---

## Tech stack

**Backend:** NestJS + TypeScript, Prisma + PostgreSQL (Docker `cleanops-db`), Redis (Docker `cleanops-redis`), `@nestjs/schedule`, bcrypt (rounds: 12), Resend (email), `@google-cloud/bigquery`
**Frontend:** Next.js 14 (App Router), Tailwind CSS, Zustand (auth store), Socket.io, i18n (EN/CS/RU/UK)
**Infra:** Docker, GCP BigQuery (`avantio-intergation` project — intentional misspelling, must be preserved)
**PMS:** Avantio PMS API v2, base URL `https://api.avantio.pro/pms/v2`, auth via `X-Avantio-Auth` header
**Ports:** Backend 3001, Frontend 3000

---

## What was built this session

### 1. GCP Staff Sync

**Files:**
- `backend/src/staff-sync/position-mapping.ts` — maps cdm_user.position → UserRole
- `backend/src/staff-sync/bigquery.client.ts` — queries `avantio-intergation.airstay_data.cdm_user`
- `backend/src/staff-sync/staff-sync.service.ts` — upsert logic, disable-missing, audit logging
- `backend/src/staff-sync/staff-sync.job.ts` — daily cron at 03:00 Europe/Prague
- `backend/src/staff-sync/staff-sync.controller.ts` — manual trigger `POST /admin/staff-sync/:tenantId/run`
- `backend/src/staff-sync/staff-sync.module.ts`
- `backend/scripts/reconcile-staff.ts` — standalone CSV reconciliation tool

**Position → Role mapping:**
- Housekeeper → CLEANER
- Front desk manager, Front desk assist, Housekeeping manager, Operation manager → MANAGER
- All other positions are ignored

**Behavior:**
- Syncs all Valid users with matching positions from BigQuery
- Creates new users, updates email/name/position/role on existing ones
- Disables users (isActive=false) who disappear from the Valid set
- Re-enables if they reappear
- Skips users with `isSyncManaged: false` (admin escape hatch)
- Writes AuditEvent rows for sync completions and user disables
- `isSyncing` in-memory lock prevents overlap (single-instance only)

**Key data points:**
- 29 syncable users: 20 cleaners + 9 managers
- Veronika Chytilová (VCH101) has no email — unreachable, flagged
- cdm_user.userId is the stable join key (stored as User.cdmUserId)

### 2. Auth Overhaul

**Files:**
- `backend/src/auth/auth.service.ts` — password login, magic-link, verify → setupToken, set-password
- `backend/src/auth/auth.controller.ts` — POST /login, /magic-link, /verify, /set-password, /refresh, /logout, GET /me
- `backend/src/auth/email.service.ts` — Resend wrapper, sends magic-link emails (first-time setup vs password reset)
- `backend/src/auth/auth.module.ts` — registers EmailService
- `frontend/app/(auth)/login/page.tsx` — password login + "First time / forgot password?" magic-link flow
- `frontend/app/auth/verify/page.tsx` — magic-link landing → set-password form (NOTE: lives at `app/auth/verify/`, NOT inside `app/(auth)/verify/`)
- `frontend/lib/locale-storage.ts` — persists pre-login language choice

**Auth flow:**
1. First-time user: email → magic-link → verify → setupToken → set-password → logged in
2. Returning user: email + password → logged in
3. Forgot password: email → magic-link → verify → setupToken → set-password → logged in
4. Magic-link verify does NOT auto-log-in; always returns setupToken for set-password
5. Resend email: currently using sandbox sender `onboarding@resend.dev` (domain `airstayprague.cz` pending verification)

**Env vars for email:**
- `RESEND_API_KEY` — Resend API key
- `RESEND_FROM_EMAIL` — currently `Airstay Portal <onboarding@resend.dev>`

### 3. Schema Changes

**New/modified models (in `backend/prisma/schema.prisma`):**

**User** — added:
- `cdmUserId String? @unique` — stable GCP join key
- `position String?` — raw cdm_user.position
- `isSyncManaged Boolean @default(true)` — false = sync ignores this user
- `lastSyncedAt DateTime?`
- `disabledAt DateTime?`
- `passwordHash String?`
- `emailVerifiedAt DateTime?`
- `preferences Json @default("{}")`
- Indexes on `[tenantId, isActive]` and `[cdmUserId]`
- Relation to `AuditEvent[]`

**CleaningEvent** — added:
- `maxCleaners Int @default(1)` — manager sets how many cleaners can claim

**AuditEvent** — new model:
- `id, tenantId, category (AuditCategory enum), action, actorId, actorEmail, targetType, targetId, metadata, createdAt`
- Categories: CLEANING_LIFECYCLE, INCIDENT_LIFECYCLE, USER_LIFECYCLE, SYNC, SYSTEM
- Indexed on `[tenantId, createdAt]`, `[tenantId, category, createdAt]`, `[targetType, targetId]`

**Migrations applied:**
1. `20260326163917_init` (original)
2. `20260407222810_staff_sync_and_audit` (User fields + AuditEvent)
3. `20260412_cleaning_pool_max_cleaners` (maxCleaners on CleaningEvent) — name may vary

### 4. Seed Script

**File:** `backend/prisma/seed.ts`

Creates:
- Prague Stays tenant with Avantio credentials from env (`AVANTIO_API_BASE_URL`, `AVANTIO_API_KEY`)
- Admin user `cpm@airstayprague.cz` with `isSyncManaged: false`, password from `ADMIN_SEED_PASSWORD` env (default: `changeme`)

Runs on `prisma migrate reset` and `prisma db seed`.

### 5. Cleanings Pool Backend

**Modified files:**
- `backend/src/cleaning-events/cleaning-events.service.ts` — added getPool, getMine, claim, drop, markDone, releaseToPool
- `backend/src/cleaning-events/cleaning-events.controller.ts` — added 6 new endpoints
- `backend/src/cleaning-events/cleaning-events.module.ts` — imports WebsocketModule

**New endpoints:**
```
GET    /api/v1/cleaning-events/pool                    — PENDING future events (any authed user)
GET    /api/v1/cleaning-events/mine?from=&to=          — user's assigned events (any authed user)
POST   /api/v1/cleaning-events/:id/claim               — CLEANER only, atomic via Serializable isolation
POST   /api/v1/cleaning-events/:id/drop                — CLEANER only, 12h cutoff before timeSlot
PATCH  /api/v1/cleaning-events/:id/done                — CLEANER only, body: { allGood, note?, photoUrls? }
POST   /api/v1/cleaning-events/:id/release-to-pool     — MANAGER only, removes all assignments, resets to PENDING
```

**Pool lifecycle:**
- PENDING = in pool (claimable)
- When assignments.length >= maxCleaners → status flips to ASSIGNED (leaves pool)
- Drop → status back to PENDING, assignment → REASSIGNED
- Done (allGood: true) → assignment COMPLETED, event COMPLETED when all assignments done
- Done (allGood: false) → same + cleanerNote + photos saved, returns `needsIncident: true`
- Release-to-pool → all assignments REASSIGNED, status → PENDING, notifications sent to affected cleaners

**Every mutation writes an AuditEvent and broadcasts via CleanOpsGateway (socket.io).**

### 6. Cleaner Frontend

**New files:**
- `frontend/app/(cleaner)/cleanings/page.tsx` — pool view with property filter + save-as-default
- `frontend/app/(cleaner)/mine/page.tsx` — claimed events with Today/This Week/This Month/Custom range picker
- `frontend/components/CleaningCard.tsx` — shared card for pool and mine views
- `frontend/components/MarkDoneSheet.tsx` — bottom sheet with All Good / Report Issue paths

**Modified files:**
- `frontend/components/BottomNav.tsx` — two tabs: Cleanings + Mine (was Today/Calendar/Notifications)
- `frontend/lib/api.ts` — added pool/claim/drop/done/releaseToPool methods, UserPreferences type
- `frontend/i18n/translations.ts` — added pool, mine, doneFlow sections in all 4 locales

**Deleted:**
- `frontend/app/(cleaner)/today/` — replaced by /cleanings
- `frontend/app/(cleaner)/notifications/` — removed (notifications will be a bell icon later)

**Other changes:**
- `frontend/app/(auth)/login/page.tsx` — redirects cleaners to `/cleanings` instead of `/today`
- `frontend/app/auth/verify/page.tsx` — same redirect change
- `backend/src/properties/properties.controller.ts` — removed class-level `@Roles('MANAGER')`, added per-method on write endpoints only (so cleaners can read properties for the filter)
- `backend/src/app.module.ts` — added StaffSyncModule, excluded `api/v1/admin/(.*)` from TenantMiddleware

---

## What's NOT done yet (deferred)

### Incidents feature (next priority)
- `Incident` model: type (CLEANING, BOILER_INSPECTION, ACCIDENT, PHOTO_SHOOT, REPAIR), status (OPEN, SCHEDULED, RESOLVED, CLOSED), priority (LOW/MEDIUM/HIGH)
- `IncidentAttachment` model for photos
- Manager Incidents page with filterable list (by creation date, unit, type, status)
- Auto-creation from cleaner Done flow (currently returns `needsIncident: true` but doesn't create the record)
- Fields ready for future: `pmsBlockId String?` (Avantio block), `guestNotifiedAt DateTime?`
- Link back to CleaningEvent when created via Done flow
- "General" bucket for incidents not tied to a specific property (propertyId nullable + isGeneral boolean)

### Monitor section
- AuditEvent rows already being written. Needs a manager-facing filterable page.
- Manager sees configurable subset of AuditCategories; admin sees everything via DB.

### Unitbook
- "Facebook for units" — timeline per property showing cleanings + incidents + bookings
- No new table — query-based union of existing tables
- Depends on Incidents existing first
- Manager-only access
- Windowed date range with scroll-further capability

### Manager-side pool UI
- Release-to-pool button on assigned events in Planning/Schedule
- maxCleaners setter per event in Planning

### Other TODOs
- `isActive` check in AuthGuard (disabled users still have valid JWTs until refresh)
- Resend domain verification for `airstayprague.cz`
- Web push notifications (VAPID + subscription)
- "Manager on shift" routing for incidents (currently all managers see all Open)
- Avantio block creation on incidents (pmsBlockId column exists, no logic)
- Guest notification on incidents (guestNotifiedAt column exists, no logic)
- Redis-based sync lock for multi-instance deployment
- User.language persistence from login-page locale choice to DB

---

## Key architectural decisions

1. `PENDING` status = "in pool" — no new enum value needed
2. `isSyncManaged: false` is the escape hatch protecting admin accounts from GCP sync
3. Atomic claim uses Prisma `$transaction` with `Serializable` isolation level
4. Drop cutoff: 12 hours before timeSlot (constant `DROP_CUTOFF_HOURS` in service)
5. Release-to-pool removes ALL assignments, not just primary
6. Done + incident are independent states — cleaning can be COMPLETED with an incident attached
7. Magic-link verify never auto-logs-in; always returns setupToken for set-password
8. Properties list endpoint open to both roles (cleaners need it for pool filter)
9. Unitbook will be a query/view, not a new table
10. `cdm_user.userId` is the stable join key; email is mutable
