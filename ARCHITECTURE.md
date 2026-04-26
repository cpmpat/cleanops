# CleanOps — Cleaning Management Platform

## Architecture Document v1.0 (MVP)

---

## 1. System Overview

CleanOps is a multi-tenant cleaning management platform for short-term rental operators. It connects to PMS (Property Management Systems) as the source of truth for bookings, and provides:

- **Staff App** — Mobile-first web app for cleaning staff to view, start, complete, and flag assignments
- **Admin Panel** — Desktop-first web app for managers to assign, reassign, schedule, and monitor cleaning events

---

## 2. Tech Stack

### Frontend
| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Framework | **Next.js 14+ (App Router)** | SSR, file-based routing, API routes, PWA-ready |
| Language | **TypeScript** | Type safety across the stack |
| Styling | **Tailwind CSS + shadcn/ui** | Utility-first, themeable, accessible components |
| State | **Zustand** | Lightweight, no boilerplate |
| Real-time | **Socket.io client** | Live updates for assignment changes |
| i18n | **next-intl** | 4 locales: en, cs, ru, uk |
| Calendar | **Custom + date-fns** | Full control over UX |
| Notifications | **Web Push API + Firebase Cloud Messaging** | Browser push notifications |
| Hosting | **Vercel** | Edge network, zero-config Next.js |

### Backend
| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Framework | **NestJS** | Modular, DI, guards, WebSocket gateway |
| Language | **TypeScript** | Shared types with frontend |
| ORM | **Prisma** | Type-safe queries, migrations, multi-tenant middleware |
| Database | **PostgreSQL 16** | OLTP, row-level operations, JSONB for metadata |
| Cache | **Redis** | Session store, pub/sub for real-time, job queue |
| Queue | **BullMQ (Redis-backed)** | Async jobs: notifications, PMS sync, email |
| Auth | **Custom JWT + Magic Link** | Passwordless, long-lived sessions |
| Email | **Resend or SendGrid** | Transactional emails (magic links, summaries) |
| File Storage | **S3-compatible (AWS S3 / GCS)** | Photo uploads from cleaners |
| Hosting | **Docker → Cloud Run / Railway / Fly.io** | Containerized, cloud-agnostic |

### Data Ingestion
| Layer | Technology | Rationale |
|-------|-----------|-----------|
| PMS Adapter | **NestJS module per PMS** | Pluggable adapter pattern |
| BigQuery Connector | **@google-cloud/bigquery SDK** | Pull bookings from BQ |
| Webhook Receiver | **NestJS controller** | Push from PMS systems |
| Message Bus | **Redis Pub/Sub** (MVP) → **Cloud Pub/Sub** (scale) | Decouple ingestion from processing |

---

## 3. Multi-Tenancy Model

**Strategy**: Shared database, `tenant_id` column on every table.

```
┌─────────────────────────────────────────┐
│              PostgreSQL                  │
│  ┌─────────┬─────────┬─────────┐       │
│  │tenant_id│tenant_id│tenant_id│  ...   │
│  │  = 1    │  = 2    │  = 3    │       │
│  └─────────┴─────────┴─────────┘       │
│     All tables filtered by tenant_id     │
└─────────────────────────────────────────┘
```

**Enforcement**: Prisma middleware automatically injects `tenant_id` into every query based on the authenticated user's tenant. No query can ever cross tenant boundaries.

---

## 4. Data Model (PostgreSQL)

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   tenants    │     │     users        │     │   properties     │
├──────────────┤     ├──────────────────┤     ├──────────────────┤
│ id (PK)      │◄────│ tenant_id (FK)   │     │ id (PK)          │
│ name         │     │ id (PK)          │     │ tenant_id (FK)   │
│ slug         │     │ email            │     │ name             │
│ settings     │     │ name             │     │ address          │
│ created_at   │     │ role (MANAGER|   │     │ location_lat     │
│ updated_at   │     │       CLEANER)   │     │ location_lng     │
└──────────────┘     │ language         │     │ default_cleaner  │
                     │ is_active        │     │   _id (FK→users) │
                     │ created_at       │     │ notes            │
                     └──────────────────┘     │ created_at       │
                                              └──────────────────┘
                                                      │
┌──────────────────────────────────────┐              │
│          cleaning_events             │              │
├──────────────────────────────────────┤              │
│ id (PK)                              │              │
│ tenant_id (FK)                       │              │
│ property_id (FK) ────────────────────┘              │
│ booking_ref (from PMS)               │
│ check_in_time (timestamp)            │
│ cleaning_time_slot (timestamp)       │
│ accommodation_name                   │
│ num_adults (int)                     │
│ num_children (int)                   │
│ channel (AIRBNB|BOOKING|VRBO|OTHER)  │
│ cleaning_type (CHECKOUT|MIDSTAY|DEEP)│
│ status (PENDING|ASSIGNED|STARTED|    │
│         COMPLETED|CANCELLED|FLAGGED) │
│ manager_note (text)                  │
│ cleaner_note (text)                  │
│ supply_note (text)                   │
│ tags (text[]) — manager-defined      │
│ started_at (timestamp, nullable)     │
│ completed_at (timestamp, nullable)   │
│ cancelled_at (timestamp, nullable)   │
│ pms_booking_id (external ref)        │
│ pms_last_synced_at (timestamp)       │
│ created_at                           │
│ updated_at                           │
└──────────────────────────────────────┘
                     │
                     │ 1:N
                     ▼
┌──────────────────────────────────────┐
│      cleaning_assignments            │
├──────────────────────────────────────┤
│ id (PK)                              │
│ cleaning_event_id (FK)               │
│ user_id (FK → users, cleaner)        │
│ is_primary (boolean)                 │
│ assigned_at (timestamp)              │
│ assigned_by (FK → users, manager)    │
│ status (ASSIGNED|STARTED|COMPLETED|  │
│         REJECTED|REASSIGNED)         │
│ started_at (timestamp, nullable)     │
│ completed_at (timestamp, nullable)   │
│ rejected_reason (text, nullable)     │
└──────────────────────────────────────┘
                     │
                     │ 1:N
                     ▼
┌──────────────────────────────────────┐
│        cleaning_photos               │
├──────────────────────────────────────┤
│ id (PK)                              │
│ cleaning_assignment_id (FK)          │
│ url (S3 path)                        │
│ uploaded_at (timestamp)              │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│      notification_log                │
├──────────────────────────────────────┤
│ id (PK)                              │
│ tenant_id (FK)                       │
│ user_id (FK)                         │
│ type (NEW_ASSIGNMENT|REASSIGNMENT|   │
│       CANCELLATION|REMINDER|OVERDUE) │
│ channel (PUSH|EMAIL)                 │
│ payload (jsonb)                      │
│ sent_at (timestamp)                  │
│ read_at (timestamp, nullable)        │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│      manager_tags                    │
├──────────────────────────────────────┤
│ id (PK)                              │
│ tenant_id (FK)                       │
│ label (varchar)                      │
│ color (varchar)                      │
│ created_by (FK → users)              │
└──────────────────────────────────────┘
```

### Key Design Decisions:
- **cleaning_assignments** is a separate table (not a column on cleaning_events) because one event can have up to 3 cleaners assigned (primary + secondary + tertiary)
- **tags** are manager-defined per tenant, stored as references. Manager can flag completed events with these tags (e.g., "Quality Issue", "Needs Reinspection")
- **pms_booking_id** links back to the external PMS for sync purposes
- **status** on cleaning_events is computed from the aggregate status of its assignments

---

## 5. Cleaning Event Lifecycle

```
                    ┌─────────────┐
     PMS Sync ─────►│   PENDING   │ (no cleaner assigned yet)
                    └──────┬──────┘
                           │ Manager assigns cleaner(s)
                    ┌──────▼──────┐
                    │  ASSIGNED   │ → Push + Email to cleaner(s)
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
      Cleaner rejects  Cleaner starts  Manager cancels
              │            │            │
       ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
       │  FLAGGED/   │ │  STARTED    │ │  CANCELLED  │
       │  REJECTED   │ │             │ │             │
       └──────┬──────┘ └──────┬──────┘ └─────────────┘
              │               │          → Notify cleaner
        Manager reassigns  Cleaner marks done
              │               │
              ▼        ┌──────▼──────┐
         (back to      │  COMPLETED  │ Manager can add tags
          ASSIGNED)    └─────────────┘

    ⏰ If not COMPLETED by (check_in_time - X hours):
       → Manager receives OVERDUE alert in UI
```

---

## 6. PMS Integration Architecture

```
┌─────────────────────────────────────────────────────┐
│                  PMS Sources                         │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐ │
│  │ BigQuery │ │ Guesty  │ │ Hostaway│ │ Webhook  │ │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬─────┘ │
└───────┼───────────┼───────────┼───────────┼────────┘
        │           │           │           │
        ▼           ▼           ▼           ▼
┌─────────────────────────────────────────────────────┐
│              Ingestion Adapter Layer                  │
│  Each adapter implements:                            │
│  - pullBookings(since: Date): Booking[]              │
│  - pushCleaningStatus(eventId, status): void         │
│  - handleWebhook(payload): Booking | null            │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│              Booking Sync Service                    │
│  - Deduplicates by pms_booking_id                   │
│  - Detects changes (check-in time, guest count...)  │
│  - Creates/updates/cancels cleaning_events          │
│  - Triggers notifications on changes                │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
              ┌───────────────┐
              │  PostgreSQL   │
              │  + Redis PubSub│
              │  → WebSocket  │
              └───────────────┘
```

### Sync Modes:
1. **Pull (polling)**: Cron job runs every 2-5 min, calls adapter's `pullBookings()` for new/modified bookings since last sync
2. **Push (webhook)**: PMS calls our webhook endpoint, adapter normalizes the payload, Sync Service processes immediately
3. **Manual**: Manager triggers a sync from the admin UI

### Conflict Resolution:
- PMS is source of truth for booking data (check-in, guests, channel, etc.)
- CleanOps is source of truth for assignment data (who cleans, status, photos)
- If PMS modifies a booking → cleaning event fields update, assignments stay, cleaners are notified of changes
- If PMS cancels a booking → cleaning event status → CANCELLED, all assigned cleaners notified

---

## 7. Real-time Architecture

```
┌────────────┐  WebSocket  ┌──────────────┐  Redis PubSub  ┌──────────────┐
│  Browser   │◄───────────►│  NestJS WS   │◄──────────────►│    Redis     │
│  (Staff/   │             │  Gateway     │                │              │
│   Admin)   │             └──────────────┘                └──────────────┘
└────────────┘                                                     ▲
                                                                   │
                                              ┌──────────────┐     │
                                              │  Sync Jobs   │─────┘
                                              │  (BullMQ)    │
                                              └──────────────┘
```

Events pushed to clients:
- `event:created` — new cleaning event from PMS sync
- `event:updated` — booking details changed
- `event:cancelled` — booking cancelled
- `assignment:new` — manager assigned cleaner
- `assignment:changed` — reassignment
- `assignment:status` — cleaner started/completed
- `alert:overdue` — cleaning not completed before threshold

---

## 8. Authentication Flow

```
1. Manager creates user (email + role + language)
2. System sends magic link email
3. User clicks link → verified, JWT issued
4. JWT stored in httpOnly cookie (long-lived: 30 days)
5. Refresh token mechanism extends session indefinitely
6. Explicit logout clears tokens
7. Each subsequent login: new magic link via email
```

JWT payload:
```json
{
  "sub": "user-uuid",
  "tenant_id": "tenant-uuid",
  "role": "CLEANER|MANAGER",
  "email": "user@example.com",
  "iat": 1234567890,
  "exp": 1237567890
}
```

---

## 9. Notification System

| Event | Push | Email | In-App |
|-------|------|-------|--------|
| New assignment | ✅ | ✅ | ✅ |
| Reassignment (old cleaner) | ✅ | ✅ | ✅ |
| Reassignment (new cleaner) | ✅ | ✅ | ✅ |
| Booking cancelled | ✅ | ✅ | ✅ |
| Booking modified | ✅ | — | ✅ |
| Morning summary (daily) | — | ✅ | — |
| Overdue alert (manager) | — | — | ✅ (badge) |

BullMQ jobs:
- `send-push-notification` — FCM web push
- `send-email` — via Resend/SendGrid
- `morning-summary` — cron: every day at 06:00 tenant timezone
- `overdue-check` — cron: every 15 min, checks events nearing check-in

---

## 10. API Structure (NestJS Modules)

```
src/
├── auth/              # Magic link, JWT, guards
├── tenants/           # Tenant CRUD, settings
├── users/             # User management (manager creates)
├── properties/        # Units/accommodations
├── bookings/          # PMS sync, booking ingestion
├── cleaning-events/   # Core: events + assignments
├── notifications/     # Push, email, in-app
├── uploads/           # Photo upload to S3
├── tags/              # Manager-defined tags
├── websocket/         # Socket.io gateway
├── integrations/      # PMS adapters (BigQuery, API, webhook)
│   ├── bigquery/
│   ├── guesty/
│   └── generic-webhook/
├── jobs/              # BullMQ processors
├── common/            # Tenant middleware, guards, DTOs
└── prisma/            # Schema, migrations, seed
```

---

## 11. Frontend Structure (Next.js)

```
app/
├── [locale]/                    # i18n: en, cs, ru, uk
│   ├── login/                   # Magic link login
│   ├── staff/                   # Cleaner views
│   │   ├── today/               # Day view (primary)
│   │   ├── calendar/            # Month view (secondary)
│   │   ├── event/[id]/          # Event detail + actions
│   │   └── notifications/       # Notification center
│   ├── admin/                   # Manager views
│   │   ├── dashboard/           # Overview + overdue alerts
│   │   ├── calendar/            # Month/Week/Day views
│   │   ├── staff/               # Staff management
│   │   ├── properties/          # Property management
│   │   ├── event/[id]/          # Event detail + assign
│   │   ├── tags/                # Tag management
│   │   └── settings/            # Tenant settings
│   └── layout.tsx               # Role-based layout switch
├── api/                         # Next.js API routes (BFF proxy)
└── components/
    ├── calendar/                # Shared calendar components
    ├── events/                  # Event cards, lists, detail
    ├── ui/                      # shadcn/ui components
    └── layout/                  # Navigation, sidebars
```

---

## 12. i18n Strategy

4 locales: `en`, `cs`, `ru`, `uk`

- All UI strings in JSON message files per locale
- User's `language` preference stored in DB, set during account creation
- URL prefix: `/en/staff/today`, `/cs/admin/dashboard`
- Date/time formatting respects locale (date-fns locales)
- Manager can set default language for new users

---

## 13. MVP Scope

### In Scope (Phase 1):
- [x] Auth (magic link, long-lived sessions)
- [x] Multi-tenant data model with tenant_id enforcement
- [x] User management (manager creates/deactivates staff)
- [x] Property management (CRUD with address, default cleaner)
- [x] Cleaning events (full lifecycle: Pending → Assigned → Started → Completed/Cancelled)
- [x] Assignments (primary + up to 2 secondary cleaners per event)
- [x] Calendar views (day for staff, month/week/day for manager)
- [x] Ordering by check-in time
- [x] Time slot assignment
- [x] Rejection/flagging by cleaner
- [x] Manager notes, supply notes
- [x] Manager-defined tags on completed events
- [x] Push notifications (web push via FCM)
- [x] Email notifications (new assignment, reassignment, cancellation, morning summary)
- [x] Overdue alerts in manager UI
- [x] Photo upload on completion
- [x] 4 language mutations (en, cs, ru, uk)
- [x] BigQuery adapter (pull mode)
- [x] Generic webhook adapter (push mode)
- [x] Real-time updates via WebSocket
- [x] Docker containerization
- [x] Vercel frontend deployment

### Out of Scope (Phase 2+):
- Offline/PWA support
- Reporting & analytics dashboard
- Cleaning checklists per property/type
- Supply inventory tracking
- Additional PMS-specific adapters
- Mobile app (native)
- Automated scheduling / optimization
- Guest communication integration

---

## 14. Deployment Architecture

```
┌─────────────────────────────────────────────┐
│                   Vercel                     │
│  ┌─────────────────────────────────────┐    │
│  │     Next.js Frontend (SSR/Edge)     │    │
│  │     + API Routes (BFF proxy)        │    │
│  └──────────────────┬──────────────────┘    │
└─────────────────────┼───────────────────────┘
                      │ HTTPS
┌─────────────────────┼───────────────────────┐
│              Docker Host                     │
│  ┌──────────────────▼──────────────────┐    │
│  │         NestJS Backend              │    │
│  │    (REST API + WebSocket Gateway)   │    │
│  └──────────┬──────────────┬───────────┘    │
│             │              │                 │
│  ┌──────────▼────┐  ┌─────▼──────────┐     │
│  │  PostgreSQL   │  │     Redis      │     │
│  │  (primary DB) │  │ (cache/queue)  │     │
│  └───────────────┘  └────────────────┘     │
└─────────────────────────────────────────────┘
```
