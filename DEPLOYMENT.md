# Deploying Vertik12 — Vercel (web) + AWS (API, PostgreSQL, DynamoDB/MongoDB)

The recommended production topology:

```
┌───────────────┐   HTTPS    ┌─────────────────────┐        ┌──────────────────┐
│    Vercel     │──────────▶ │  AWS App Runner /   │──────▶ │  RDS PostgreSQL   │
│  apps/web     │            │  ECS Fargate        │        │  (primary DB)     │
│  (Next.js)    │            │  apps/api (Docker)  │──────▶ │  DynamoDB         │
└───────────────┘            └─────────────────────┘        │  (document store) │
                                                            └──────────────────┘
```

- **Web** → Vercel (it is the best host for Next.js; zero config, global CDN).
- **API** → AWS **App Runner** (simplest) or **ECS Fargate** (more control), built from `apps/api/Dockerfile`.
- **Relational data** → **Amazon RDS for PostgreSQL**.
- **Documents** (assignment submissions, unstructured payloads) → **DynamoDB** (native AWS, serverless) or **MongoDB Atlas** if you prefer Mongo. Both are supported via `DOCUMENT_STORE`.

---

## 0. One-time repo preparation

```bash
# Switch Prisma from the dev SQLite provider to PostgreSQL:
npm run db:use:postgres

# Create the initial migration against a local Postgres (docker compose up -d):
cd apps/api
npx prisma migrate dev --name init      # generates prisma/migrations/** — commit these
```

> Local dev keeps working: run `npm run db:use:sqlite` to switch back, or run
> real Postgres locally with `docker compose up -d` and
> `DATABASE_URL="postgresql://vertik12:vertik12@localhost:5432/vertik12"`.

Commit the repo to GitHub — both Vercel and AWS deploy from it.

---

## 1. Database — Amazon RDS (PostgreSQL)

1. AWS Console → **RDS → Create database** → *Standard create* → **PostgreSQL 16**.
2. Template: *Production* (or *Free tier* while testing). Instance: `db.t4g.micro` is fine to start.
3. Set master username/password → store them in **AWS Secrets Manager** (RDS offers this checkbox).
4. **Connectivity**: place it in your default VPC, *Public access: No*. Create a security group `vertik12-db-sg`.
5. After creation, note the endpoint. Your production `DATABASE_URL`:
   ```
   postgresql://<user>:<password>@<endpoint>:5432/vertik12?schema=public
   ```
6. Create the `vertik12` database (RDS Query Editor, or `psql` from a bastion/Cloud9).

Migrations run automatically on container start (`prisma migrate deploy` in the Dockerfile CMD). To seed demo data once, run a one-off task with `npx tsx apps/api/prisma/seed.ts` or temporarily set the CMD.

## 2. Document store — DynamoDB (or MongoDB Atlas)

**DynamoDB (recommended on AWS):**
1. Console → **DynamoDB → Create table**: name `vertik12-documents`, partition key `pk` (String). On-demand capacity.
2. API env: `DOCUMENT_STORE=dynamodb`, `DYNAMODB_TABLE=vertik12-documents`.
3. Give the API's IAM role `dynamodb:GetItem` + `dynamodb:PutItem` on that table (App Runner: instance role; ECS: task role).

**MongoDB Atlas (alternative):**
1. Create a free/shared cluster at cloud.mongodb.com, allow access from your API's egress IPs, create a DB user.
2. API env: `DOCUMENT_STORE=mongodb`, `MONGODB_URI=mongodb+srv://…`, `MONGODB_DB=vertik12`.

## 3. API — AWS App Runner (easiest path)

1. Push the image:
   ```bash
   aws ecr create-repository --repository-name vertik12-api
   aws ecr get-login-password | docker login --username AWS --password-stdin <acct>.dkr.ecr.<region>.amazonaws.com
   docker build -f apps/api/Dockerfile -t vertik12-api .        # run from the REPO ROOT
   docker tag vertik12-api:latest <acct>.dkr.ecr.<region>.amazonaws.com/vertik12-api:latest
   docker push <acct>.dkr.ecr.<region>.amazonaws.com/vertik12-api:latest
   ```
2. Console → **App Runner → Create service** → Source: that ECR image. Port: **4000**.
3. **Environment variables** (use Secrets Manager references for the secrets):
   ```
   NODE_ENV=production
   DATABASE_URL=postgresql://…             (from step 1)
   JWT_ACCESS_SECRET=<64+ random chars>
   JWT_REFRESH_SECRET=<64+ random chars>
   CORS_ORIGIN=https://<your-app>.vercel.app
   DEFAULT_CURRENCY=USD
   DOCUMENT_STORE=dynamodb
   DYNAMODB_TABLE=vertik12-documents
   STRIPE_SECRET_KEY=sk_live_…             (optional, for real card payments)
   STRIPE_WEBHOOK_SECRET=whsec_…           (Stripe dashboard → webhook → your API URL + /api/v1/finance/payments/webhook)
   ```
4. **Networking**: add a VPC connector so App Runner can reach RDS; put the connector's security group in `vertik12-db-sg`'s inbound rules (port 5432).
5. Instance role: attach the DynamoDB policy from step 2.
6. Health check path: `/health`. Deploy — App Runner gives you `https://xxxx.awsapprunner.com`.

**ECS Fargate alternative** (more knobs): create an ECS cluster → task definition with the same image/env/roles (task role = DynamoDB access, execution role = ECR+Secrets) → service with an **Application Load Balancer** (target port 4000, health check `/health`) → ACM certificate + Route 53 for `api.yourschool.com`. Prefer this when you need private subnets, autoscaling policies, or blue/green deploys.

## 4. Web — Vercel

1. vercel.com → **Add New → Project** → import the GitHub repo.
2. **Root Directory: `apps/web`** (enable "Include source files outside of the Root Directory" — default on; Vercel understands npm workspaces and installs from the repo root).
3. Framework preset: Next.js (auto-detected). No build overrides needed.
4. **Environment variable**:
   ```
   NEXT_PUBLIC_API_URL=https://<your-app-runner-or-alb-domain>/api/v1
   ```
5. Deploy. Then go back to the API's env and set `CORS_ORIGIN` to the final Vercel domain (comma-separate to also allow a custom domain):
   ```
   CORS_ORIGIN=https://vertik12.vercel.app,https://portal.yourschool.com
   ```
6. Custom domain: Vercel → Settings → Domains.

## 5. Post-deploy checklist

- [ ] `https://<api>/health` returns `{"status":"ok"}`
- [ ] Log in on the Vercel URL; check the browser console for CORS errors (means `CORS_ORIGIN` mismatch)
- [ ] Change every seeded password / reseed with real users; keep only your own SUPER_ADMIN
- [ ] Stripe webhook endpoint added and `STRIPE_WEBHOOK_SECRET` set (if using card payments)
- [ ] RDS automated backups on (default 7 days); consider point-in-time recovery
- [ ] CloudWatch alarms on App Runner 5xx and RDS CPU/storage
- [ ] Rotate `JWT_*` secrets via Secrets Manager on a schedule

## 6. Environment variable reference (API)

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | PostgreSQL connection string in production |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | ✅ | API refuses to boot in production with dev defaults |
| `CORS_ORIGIN` | ✅ | Comma-separated allowed web origins |
| `PORT` | — | Default 4000 |
| `DOCUMENT_STORE` | — | `local` \| `mongodb` \| `dynamodb` |
| `MONGODB_URI`, `MONGODB_DB` | if mongodb | Atlas connection string |
| `DYNAMODB_TABLE` | if dynamodb | plus IAM permissions on the role |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | — | omit to use the built-in mock gateway |
| `DEFAULT_CURRENCY` | — | ISO 4217, default USD |

Web needs only `NEXT_PUBLIC_API_URL`.
