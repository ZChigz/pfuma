# School Management System

A full-stack multi-tenant school management platform covering fee accounting, academic results, library management, and asset tracking.

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript 5 |
| Database | PostgreSQL 15 via Prisma 5 |
| Auth | NextAuth v5 (JWT, credentials) |
| Styling | Tailwind CSS |
| Forms | React Hook Form + Zod |
| Charts | Recharts |
| File uploads | UploadThing |
| PDF generation | @react-pdf/renderer |
| Unit/component tests | Vitest + Testing Library |
| E2E tests | Playwright |
| Containerisation | Docker (standalone build) |

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL 15 running locally
- `npm` 10+

### Steps

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill environment variables
cp .env.example .env
# Edit .env — set DATABASE_URL, NEXTAUTH_SECRET, NEXTAUTH_URL

# 3. Run database migrations
npm run db:migrate

# 4. Seed with demo data
npm run db:seed

# 5. Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Seed Credentials

All seed users share the password **`School@2026`**.

| Role | Email |
|---|---|
| Director | director@ruvimbo.co.zw |
| Head Teacher | head@ruvimbo.co.zw |
| Bursar | bursar@ruvimbo.co.zw |
| Teacher | teacher@ruvimbo.co.zw |
| Librarian | librarian@ruvimbo.co.zw |

## Project Structure

```
app/
  (auth)/           # Login page (no sidebar layout)
  (dashboard)/      # Authenticated app shell with sidebar
    accounting/     # Fee management, expenses, dashboard
    results/        # Marks entry, report cards
    library/        # Books, borrowing, members
    assets/         # Asset register, maintenance, disposal
  api/              # Route handlers (all wrapped with withApi)
  portal/[token]/   # Public student fee portal (no auth)
  error.tsx         # Root error boundary
  not-found.tsx     # 404 page
components/
  ui/               # Button, Badge, Modal, etc.
  accounting/       # PaymentModal, StudentTable, etc.
  results/          # ReportCardDocument, MarksTable
  library/          # BookCard, BorrowingTable
  assets/           # AssetCard, MaintenanceForm
lib/
  auth.ts           # NextAuth config
  prisma.ts         # Prisma client singleton
  permissions.ts    # RBAC guard functions
  utils.ts          # formatUSD, formatZiG, getDaysOverdue, etc.
  logger.ts         # Structured JSON logger
  api.ts            # apiSuccess/apiError helpers + withApi HOF
  audit.ts          # logAudit() for transaction audit trail
  validations/      # Zod schemas per domain
prisma/
  schema.prisma     # Database schema
  migrations/       # Migration history
  seed.ts           # Demo data seed
tests/
  unit/             # Pure function tests (Vitest)
  components/       # RTL component tests (Vitest + jsdom)
  e2e/              # Browser tests (Playwright)
```

## Module Overview

### Accounting
- **Students** — enrolment, per-student fee balances in USD and ZiG
- **Charges** — apply term fees to students
- **Payments** — record cash (auto-verified) or non-cash (PENDING → VERIFIED flow)
- **Expenses** — school expenditure tracking with void support
- **Dashboard** — aggregated KPIs, aging buckets, weekly trend chart, payment mix

### Results
- **Subjects** — subject catalogue per grade with type (CORE / ELECTIVE)
- **Assignments** — assign teachers to subjects per term
- **Marks** — upsert raw marks; percentage and letter grade computed automatically
- **Publish** — compute totals, assign class positions, lock term for editing
- **Report Cards** — downloadable PDF via @react-pdf/renderer

### Library
- **Books** — catalogue with copies (accession numbers auto-generated)
- **Members** — staff/students with borrowing limits
- **Borrowing** — checkout (3-copy limit), return with fine calculation

### Assets
- **Asset register** — tag numbers, acquisition cost, location, custodian
- **Maintenance** — log maintenance events; sets status to UNDER_MAINTENANCE
- **Disposal** — record disposal method and proceeds; sets status to DISPOSED

### Portal
- Public page at `/portal/[token]` — shows a student's fee balance. No login required. Tokens regenerated on demand by staff.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `NEXTAUTH_SECRET` | Yes | JWT signing secret (`openssl rand -base64 32`) |
| `NEXTAUTH_URL` | Yes | Base URL of the app (e.g. `http://localhost:3000`) |
| `UPLOADTHING_SECRET` | Yes | UploadThing API secret |
| `UPLOADTHING_APP_ID` | Yes | UploadThing app ID |
| `DAILY_FINE_RATE` | No | Library overdue fine per day in USD (default `0`) |
| `LOAN_PERIOD_DAYS` | No | Default loan period in days (default `14`) |

## npm Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | ESLint |
| `npm run db:migrate` | Run Prisma migrations (dev) |
| `npm run db:seed` | Seed demo data |
| `npm run db:studio` | Open Prisma Studio |
| `npm run db:reset` | Reset DB and re-seed |
| `npm run test` | Vitest (watch mode) |
| `npm run test -- --run` | Vitest (single run) |
| `npm run test:e2e` | Playwright E2E tests |

## Architecture Rules

1. **Multi-tenancy** — every Prisma query includes `schoolId: user.schoolId`. Never trust a `schoolId` from the request body.
2. **Balance invariant** — `balance = Σ charges − Σ VERIFIED payments`. PENDING and VOIDED payments do not reduce balance.
3. **Audit trail** — all mutations that change financial or student data call `logAudit()` inside the same Prisma transaction.
4. **RBAC** — every protected route calls a `can*()` function from `lib/permissions.ts` before mutating data. `guard()` throws a `Response(403)` which route handlers must catch and return.
5. **Error handling** — all route handlers are wrapped with `withApi(label, handler)`. Unhandled errors are logged with `logger.error` and return `{ success: false, message: 'Internal server error' }` with status 500.
6. **Currency** — monetary amounts are stored as Prisma `Decimal` and serialised to `number` (`.toNumber()`) before being sent in API responses.
7. **No client-side secrets** — environment variables that must remain server-side are never prefixed with `NEXT_PUBLIC_`.

## Running Tests

### Unit & component tests

```bash
# Run all Vitest tests
npm run test -- --run

# Watch mode during development
npm run test
```

### E2E tests (Playwright)

Playwright tests require a running app and a seeded database.

```bash
# 1. Seed the database
npm run db:seed

# 2. In one terminal, start the app
npm run dev

# 3. In another terminal, run Playwright
npm run test:e2e
```

To view the HTML report after a run:

```bash
npx playwright show-report
```

### Docker (production build)

```bash
docker build -f Dockerfile.prod -t school-ms .
docker run -p 3000:3000 \
  -e DATABASE_URL="..." \
  -e NEXTAUTH_SECRET="..." \
  -e NEXTAUTH_URL="http://localhost:3000" \
  school-ms
```
