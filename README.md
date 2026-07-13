# Vertik12

**The global K-12 Student Information Management System** — built for private schools that need academics, billing and HR in one place.

*Powered by **CloudPunkt***

---

## What's inside

| Module | Capabilities |
| --- | --- |
| **Authentication & RBAC** | JWT access tokens + rotating refresh tokens, 7 roles (`SUPER_ADMIN`, `ADMIN`, `REGISTRAR`, `TEACHER`, `ACCOUNTANT`, `STUDENT`, `PARENT`), per-route role guards driven by a shared role→module matrix |
| **Administration (Super Admin)** ⚙️ | User management (create, edit roles, activate/deactivate, password resets with session revocation), **audit & activity logs** (every mutating API call recorded automatically), school configuration (profile, branding, currency/timezone, password & session policies) |
| **Parent Portal** 👪 | Parents sign in and see **only their own children** (multi-child support): per-child dashboard, grades, attendance history, weekly schedule, fee balances, and **online payment** — all view-only apart from paying |
| **Students** | Admissions with auto admission numbers (`VRT-2026-0001`), guardians, class enrolment, 360° profile (attendance %, finance summary, grades), soft withdrawal |
| **Staff & HR** | Staff profiles with auto staff numbers, login accounts with generated temp passwords, off-boarding that disables logins |
| **Academics** | Academic years & terms (one active year), K-12 class rooms with sections/capacity/homeroom teachers, subjects, class-subject-teacher assignment, timetable slots |
| **Attendance** | Daily class register (bulk upsert, correctable), per-student summaries, one record per student per day enforced by the DB |
| **Exams & Grades** | Weighted exams per term, bulk mark entry with server-computed letter grades, report cards with weighted subject averages and GPA |
| **Finance / Payments** 💳 | Fee structures (per grade / frequency), single + bulk invoicing per grade, manual payments (cash/bank/cheque/mobile money), **online card checkout via Stripe** with a zero-config mock gateway for demos, webhook confirmation, automatic invoice status (`ISSUED → PARTIALLY_PAID → PAID / OVERDUE`), collections overview |
| **Payroll** 💼 | Salary structures (basic + allowance/deduction components), monthly runs that **snapshot** each employee's structure into payslips, `DRAFT → APPROVED → PAID` workflow, gross/net totals, payslip history per employee |
| **Communication** | Audience-targeted announcements (all / staff / students / parents) with pinning |
| **Dashboard** | Live stats: enrolment by grade, attendance today, monthly invoiced vs collected, outstanding fees, last payroll run |

## Tech stack

- **TypeScript everywhere**, npm-workspaces monorepo
- **API** — Node.js + Express 4, Prisma ORM (SQLite in dev, PostgreSQL-ready), Zod validation, JWT (jsonwebtoken), bcryptjs, Helmet, CORS, Stripe SDK
- **Web** — Next.js 14 (App Router) + React 18 + Tailwind CSS
- **Shared package** — domain constants, Zod schemas and API types used by *both* apps, so the client and server can never drift apart

```
Vertik12/
├── package.json                  # workspace root: dev/build/db scripts
├── packages/shared/              # @vertik12/shared — single source of truth
│   └── src/
│       ├── constants.ts          # roles, grades, statuses, grade bands, money helper, BRAND
│       ├── schemas.ts            # Zod schemas: every API mutation is validated by these
│       └── types.ts              # ApiResponse, Paginated, AuthTokenPayload, DashboardStats…
├── apps/api/                     # @vertik12/api — Express REST API
│   ├── prisma/schema.prisma      # 23 models: identity, academics, finance, payroll…
│   ├── prisma/seed.ts            # realistic demo school (52 students, invoices, payroll)
│   └── src/
│       ├── config/env.ts         # fail-fast environment validation
│       ├── lib/                  # prisma client, ApiError, JWT/password utils, pagination
│       ├── middleware/           # authenticate, requireRoles, validateBody, errorHandler
│       └── modules/<domain>/     # <domain>.service.ts (logic) + <domain>.routes.ts (HTTP)
└── apps/web/                     # @vertik12/web — Next.js admin portal
    └── src/
        ├── lib/api.ts            # typed fetch client w/ auto token refresh
        ├── components/ui.tsx     # Button, Input, Card, Badge, Modal, StatCard…
        ├── components/data-table.tsx
        ├── components/app-shell.tsx  # sidebar/topbar + client-side auth guard
        └── app/                  # login + (dashboard)/ pages per module
```

## Quick start

Requires **Node.js ≥ 18.18**.

```bash
npm run setup     # install → generate Prisma client → create SQLite DB → seed demo data
npm run dev       # starts API (http://localhost:4000) + web (http://localhost:3000) together
```

Sign in at **http://localhost:3000** (all demo passwords are `Vertik12!demo`):

| Email | Role | Lands on |
| --- | --- | --- |
| `admin@vertik12.school` | Super Admin | Dashboard + Administration |
| `registrar@vertik12.school` | Registrar | Dashboard (records & enrolment) |
| `accounts@vertik12.school` | Accountant | Dashboard (finance & payroll) |
| `teacher1@vertik12.school` … `teacher5@` | Teacher | Dashboard (own classes) |
| `parent1@vertik12.school` … `parent3@` | Parent | Parent Portal (`parent1` has two children) |

> If port 3000 is busy: `npm run dev:web -- -- -p 3005` (and set `CORS_ORIGIN=http://localhost:3005` in `apps/api/.env`).

Useful scripts: `npm run db:seed` (reset demo data), `npm run db:studio -w @vertik12/api` (browse the DB), `npm run typecheck` (all workspaces).

## Architecture decisions — the "why"

**Monorepo with a shared contract package.** The Zod schemas in `packages/shared` are used by the API to validate requests *and* available to the web app for forms/types. Renaming a field breaks the build instead of production.

**Service / route split per module.** Routes are thin HTTP adapters (auth guard → validate → call service → envelope). Services hold all business logic and are plain async functions — easy to unit-test and to reuse (e.g. the students service is used by both the list and profile endpoints).

**RBAC via one middleware + a shared matrix.** `requireRoles("ADMIN", "ACCOUNTANT")` on any route; `SUPER_ADMIN` implicitly passes every check. The `ROLE_MODULES` matrix in `packages/shared` drives the web sidebar *and* documents the API guards, so the UI and server can't disagree about who sees what. Role summary:

| Role | Can | Cannot |
| --- | --- | --- |
| **Super Admin** | Everything + user management, audit logs, school configuration | — |
| **Admin** | Day-to-day school management (people, academics, finance, payroll) | System administration |
| **Registrar** | Student records & admissions, enrolment, attendance registers/reports, transcripts & report cards, class/timetable scheduling | Finance, payroll, HR, user management |
| **Teacher** | Own classes: attendance, exams & gradebook, announcements; student records **read-only** | Finance, payroll, HR, user management |
| **Accountant** | Fees, invoices, payments, payroll; people records read-only | Academic record changes, administration |
| **Parent** | Parent portal: own children's grades/attendance/schedule (view-only), fee balances, online payment | Everything else — enforced per-child, not just per-module |

**Audit trail by construction.** A single middleware records every mutating API call (user, role, action, route, status) into `AuditLog` after the response is sent — fire-and-forget, so auditing can never break a request. Super Admin browses it under Administration → Audit logs.

**Parent isolation at the data layer.** Every portal endpoint resolves the guardian from the JWT and verifies the student-guardian link before returning anything (`assertOwnChild`), so a parent can never read — or pay — another family's records, even with a crafted request.

**Money is integers.** All amounts are minor units (cents). No floating-point drift in invoices or payslips; formatting happens only at the edge (`formatMoney`).

**Payments behind a provider interface.** `finance/payment-provider.ts` defines `PaymentProvider`; `StripeProvider` implements real Stripe Checkout + webhook verification, `MockProvider` auto-approves so the demo runs with zero configuration. Swapping in PayPal/M-Pesa/Flutterwave touches one file. To enable Stripe, set `STRIPE_SECRET_KEY` (and `STRIPE_WEBHOOK_SECRET`, pointing the webhook at `POST /api/v1/finance/payments/webhook`).

**Invoice status is derived, never hand-set.** After every payment the API recomputes `PAID / PARTIALLY_PAID / OVERDUE` from items, successful payments and the due date — the numbers and the status can't disagree.

**Payroll snapshots.** A payroll run copies each employee's salary components into the payslip rows. Changing someone's salary next month never rewrites historical payslips. The run itself is a small state machine (`DRAFT → APPROVED → PAID`) with approval restricted to admins.

**Refresh-token rotation, hashed at rest.** Refresh tokens are stored as SHA-256 hashes and revoked on every use/logout/password change; a leaked DB can't mint sessions.

**SQLite in dev, PostgreSQL in prod.** Zero-setup local development. To switch: change `provider = "postgresql"` in `apps/api/prisma/schema.prisma`, set `DATABASE_URL`, run `prisma db push` (or proper `prisma migrate`). Enum-like fields are strings validated by Zod, so no schema surgery is needed — though you can promote them to native enums on Postgres.

**Soft deletes for people.** Students are *withdrawn* and staff *terminated/resigned* (login disabled) rather than deleted — grades, invoices and payslips remain auditable.

## API surface (v1)

All routes under `/api/v1`, JSON envelope `{ success, data, message? }`, auth via `Authorization: Bearer <accessToken>`.

```
POST /auth/login | /auth/refresh | /auth/logout | /auth/change-password     GET /auth/me
GET|POST /students          GET|PATCH|DELETE /students/:id
GET|POST /staff             GET|PATCH|DELETE /staff/:id
GET|POST /academics/years   POST /academics/years/:id/activate   POST /academics/terms
GET|POST /academics/classes GET /academics/classes/:id
GET|POST /academics/subjects  POST /academics/class-subjects  POST|DELETE /academics/timetable
POST /attendance/mark       GET /attendance/register   GET /attendance/students/:id/summary
GET|POST /exams             POST /exams/results        GET /exams/report-card/:studentId/:termId
GET|POST /finance/fee-structures
GET|POST /finance/invoices  GET /finance/invoices/:id  POST /finance/invoices/bulk|/:id/void
POST /finance/payments/manual | /payments/checkout | /payments/webhook (Stripe)
GET /finance/overview
GET /payroll/salaries       PUT /payroll/salaries
GET|POST /payroll/runs      GET /payroll/runs/:id      POST /payroll/runs/:id/approve|/pay
GET /payroll/staff/:staffId/payslips
GET|POST|DELETE /announcements          GET /dashboard/stats
GET|POST /admin/users       PATCH /admin/users/:id     POST /admin/users/:id/reset-password
GET /admin/audit-logs       GET|PUT /admin/settings                     (SUPER_ADMIN only)
GET /portal/children        GET /portal/children/:id   POST /portal/pay (PARENT only)
```

## Deployment

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for the full Vercel (web) + AWS (App Runner/ECS, RDS PostgreSQL, DynamoDB) guide. Quick facts:

- `npm run db:use:postgres` switches Prisma to PostgreSQL (`db:use:sqlite` switches back for zero-config dev); `docker compose up -d` runs local Postgres + MongoDB.
- Unstructured payloads (assignment submissions) live in a pluggable **document store**: `DOCUMENT_STORE=local | mongodb | dynamodb`.
- The API ships a production **Dockerfile** (`apps/api/Dockerfile`, health check `/health`); the web app deploys to Vercel with Root Directory `apps/web` and one env var (`NEXT_PUBLIC_API_URL`).

## Production checklist

- [ ] PostgreSQL + `prisma migrate deploy`
- [ ] Strong `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` (the API refuses to boot in production with the dev defaults)
- [ ] Real Stripe keys + webhook endpoint over HTTPS
- [ ] Move the refresh token from localStorage to an httpOnly cookie (`apps/web/src/lib/api.ts` documents the seam)
- [ ] Rate-limiting on `/auth/*` (e.g. `express-rate-limit`), request logging shipped to your aggregator
- [ ] Object storage (S3/GCS) for student photos & documents

---

**Vertik12** · Powered by **CloudPunkt** — © 2026
