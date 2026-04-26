# CleanOps — Setup Guide

## What's been built so far

The entire backend is scaffolded and ready to run. Here's the inventory:

### Backend (46 files)
```
cleanops/
├── .env.example                  ← Copy to .env, paste your Avantio API key here
├── .gitignore
├── docker-compose.yml            ← PostgreSQL + Redis + Backend containers
├── package.json                  ← Monorepo root
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   ├── nest-cli.json
│   ├── prisma/
│   │   ├── schema.prisma         ← Full data model (11 tables, all relations)
│   │   └── seed.ts               ← Demo data: 1 tenant, 1 manager, 5 cleaners, 8 properties, 10 events
│   └── src/
│       ├── main.ts               ← NestJS entry + Swagger docs
│       ├── app.module.ts          ← Root module wiring
│       ├── common/
│       │   ├── prisma.service.ts  ← Multi-tenant Prisma middleware
│       │   ├── prisma.module.ts
│       │   ├── guards/auth.guard.ts      ← JWT + role-based guards
│       │   ├── middleware/tenant.middleware.ts
│       │   └── interfaces/pms-adapter.interface.ts  ← Adapter contract
│       ├── auth/                  ← Magic link login, JWT, sessions
│       ├── users/                 ← CRUD + workload queries
│       ├── tenants/               ← Settings + PMS config
│       ├── properties/            ← Property CRUD
│       ├── cleaning-events/       ← Full lifecycle, date queries, stats, calendar
│       ├── assignments/           ← Assign/start/complete/reject/reassign
│       ├── notifications/         ← Push/email/in-app + convenience methods
│       ├── tags/                  ← Manager-defined tags on events
│       ├── uploads/               ← Photo upload (S3-ready)
│       ├── websocket/             ← Socket.io gateway for real-time
│       ├── integrations/
│       │   ├── avantio/avantio.adapter.ts  ← Exact Avantio API field mappings
│       │   ├── booking-sync.service.ts     ← Orchestrates PMS → PostgreSQL
│       │   └── integrations.controller.ts  ← Manual sync trigger
│       └── jobs/                  ← Cron: PMS sync (5min), overdue (15min), morning email (6am)
```

---

## Step-by-step: Get it running

### Prerequisites
- **Node.js 20+** (https://nodejs.org)
- **Docker Desktop** (https://docker.com/products/docker-desktop)
- **Git**

---

### Step 1: Clone and configure environment

```bash
# Create the project directory and copy all the files there
# (or clone from your Git repo once you push)

cd cleanops

# Create your environment file
cp .env.example .env
```

**Edit `.env`** and fill in:
```
AVANTIO_API_KEY=your-real-avantio-api-key
JWT_SECRET=a-random-string-at-least-32-characters-long
MAGIC_LINK_SECRET=another-random-string-at-least-32-chars
```

For now, the email/S3/FCM keys can stay as placeholders — the app works without them in dev mode.

---

### Step 2: Start PostgreSQL and Redis

```bash
docker-compose up -d postgres redis
```

Wait 5 seconds for them to be healthy, then verify:
```bash
docker-compose ps
# Both should show "healthy"
```

---

### Step 3: Install dependencies

```bash
cd backend
npm install
```

---

### Step 4: Generate Prisma client and run migrations

```bash
# Generate the TypeScript client from the schema
npx prisma generate

# Create all database tables
npx prisma migrate dev --name init
```

This creates all 11 tables in PostgreSQL with the exact schema from `prisma/schema.prisma`.

---

### Step 5: Seed the database

```bash
npx prisma db seed
```

This creates:
- 1 tenant: "Prague Stays"
- 1 manager: admin@praguestays.cz
- 5 cleaners with different languages (UK, CS, RU, EN, CS)
- 8 properties in Prague
- 10 cleaning events (today + next 2 days)
- 5 manager tags

---

### Step 6: Start the backend

```bash
npm run start:dev
```

You should see:
```
🧹 CleanOps API running on port 3001
📚 Swagger docs: http://localhost:3001/api/docs
```

**Open Swagger UI** at http://localhost:3001/api/docs to test all endpoints.

---

### Step 7: Test the login flow

```bash
# Request a magic link
curl -X POST http://localhost:3001/api/v1/auth/magic-link \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@praguestays.cz"}'

# Response (dev mode shows token):
# { "message": "Magic link sent", "_dev_token": "abc123...", "_dev_verifyUrl": "..." }

# Verify the token to get JWT
curl -X POST http://localhost:3001/api/v1/auth/verify \
  -H "Content-Type: application/json" \
  -d '{"token": "abc123..."}'

# Response: { "accessToken": "eyJ...", "user": { ... } }
```

Use the `accessToken` as `Authorization: Bearer <token>` for all subsequent requests.

---

### Step 8: Test core endpoints

```bash
TOKEN="eyJ..."  # from step 7

# Get today's events (manager sees all)
curl http://localhost:3001/api/v1/cleaning-events?date=2026-03-26 \
  -H "Authorization: Bearer $TOKEN"

# Get stats
curl http://localhost:3001/api/v1/cleaning-events/stats?date=2026-03-26 \
  -H "Authorization: Bearer $TOKEN"

# Get cleaners with workload
curl http://localhost:3001/api/v1/users/cleaners/workload?date=2026-03-26 \
  -H "Authorization: Bearer $TOKEN"

# Trigger manual PMS sync (requires valid Avantio API key in .env)
curl -X POST http://localhost:3001/api/v1/integrations/sync \
  -H "Authorization: Bearer $TOKEN"
```

---

### Step 9: Inspect the database

```bash
npx prisma studio
```

Opens a visual browser at http://localhost:5555 where you can inspect all tables and data.

---

## What's next (Frontend)

The frontend (Next.js) is the next step. You already have the interactive prototype
from the previous step. The real frontend will:

1. Connect to these API endpoints
2. Use Socket.io for real-time updates
3. Implement proper i18n with next-intl
4. PWA support for mobile install

---

## API Reference (Quick)

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| POST | /auth/magic-link | public | Request login email |
| POST | /auth/verify | public | Verify token → JWT |
| GET | /auth/me | any | Current user |
| POST | /auth/logout | any | Destroy session |
| GET | /cleaning-events?date=YYYY-MM-DD | any | Events for date |
| GET | /cleaning-events/stats?date= | MANAGER | Stats for date |
| GET | /cleaning-events/overdue | MANAGER | Overdue events |
| GET | /cleaning-events/calendar/:year/:month | any | Month summary |
| GET | /cleaning-events/:id | any | Event detail |
| POST | /cleaning-events | MANAGER | Create event |
| PATCH | /cleaning-events/:id | MANAGER | Update event |
| DELETE | /cleaning-events/:id | MANAGER | Cancel event |
| GET | /assignments/my?date= | CLEANER | My assignments |
| POST | /assignments/assign | MANAGER | Assign cleaner |
| POST | /assignments/reassign | MANAGER | Reassign |
| PATCH | /assignments/:id/start | CLEANER | Start cleaning |
| PATCH | /assignments/:id/complete | CLEANER | Complete cleaning |
| PATCH | /assignments/:id/reject | CLEANER | Reject assignment |
| GET | /users | MANAGER | List users |
| POST | /users | MANAGER | Create user |
| GET | /users/cleaners/workload?date= | MANAGER | Staff workload |
| GET | /properties | MANAGER | List properties |
| POST | /properties | MANAGER | Create property |
| GET | /tags | MANAGER | List tags |
| POST | /tags | MANAGER | Create tag |
| POST | /tags/event/:id/tag/:tagId | MANAGER | Tag an event |
| GET | /notifications | any | My notifications |
| GET | /notifications/unread/count | any | Unread count |
| PATCH | /notifications/:id/read | any | Mark read |
| POST | /integrations/sync | MANAGER | Manual PMS sync |
| GET | /tenant | MANAGER | Tenant info |
| PATCH | /tenant/pms-config | MANAGER | Update PMS config |
| POST | /uploads/event/:id/photo | any | Upload photo |

---

## Avantio Integration Details

The adapter maps these exact fields from the Avantio API response:

```
Avantio field                → CleanOps field
─────────────────────────────────────────────
data.id                      → pmsBookingId
data.reference               → bookingRef (e.g. "A203-HMFWCCJ3WZ")
data.stayDates.arrival       → date part of checkInTime
data.checkInTime             → time part of checkInTime (e.g. "15:00")
data.stayDates.departure     → date part of checkOutTime
data.checkOutTime            → time part of checkOutTime (e.g. "10:00")
data.accommodation.id        → pmsPropertyId (e.g. "701772")
data.occupancy.adults        → numAdults
data.occupancy.children.length → numChildren
data.salesChannel.name       → channel (e.g. "Airbnb")
data.status                  → active/cancelled
data.customer.name + surnames → guestName
```

For **PUT /bookings/{id}**, we only send:
- `checkInTime`: HH:mm format (e.g. "14:30")
- `checkOutTime`: HH:mm format (e.g. "10:00")

Auth header: `X-Avantio-Auth: <your-api-key>`
