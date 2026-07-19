# Vertik12 — AWS Production Deployment Guide

This guide takes you from a fresh AWS account to a fully working production
deployment with CI/CD. Follow the steps in order; each builds on the previous.

## Architecture

```
                       ┌────────────────────────────────────────────────┐
  Browser ──────────►  │  CloudFront  ──►  S3 (web bucket)              │
     │                 │  + URL-rewrite function (pretty URLs → HTML)   │
     │                 └────────────────────────────────────────────────┘
     │  fetch (JWT)
     ▼
  API Gateway (HTTP API)
     │
     ▼
  Lambda  (Express via serverless-http, bundled with esbuild)
     ├──►  RDS PostgreSQL        relational data (Prisma)
     ├──►  DynamoDB              document store (submissions, photos…)
     └──►  S3 (documents bucket) payloads > 350 KB (DynamoDB item limit)
```

- **Web**: Next.js built with `NEXT_OUTPUT=export` → pure static files on S3,
  served by CloudFront. A CloudFront Function maps URLs like
  `/students/abc123/` onto the pre-rendered placeholder page
  (`/students/__id__/index.html`); the browser reads the real id from the URL
  (see `apps/web/src/lib/use-route-id.ts`).
- **API**: the exact same Express app as local dev (`apps/api/src/app.ts`),
  wrapped by `apps/api/src/lambda.ts`. Built by
  `apps/api/scripts/build-lambda.mjs` into `apps/api/dist-lambda/`.
- **Everything except RDS** lives in one CloudFormation stack:
  [infra/template.yaml](../infra/template.yaml). RDS is created once, outside
  the stack, so stack operations can never touch your database.

Local commands below are **PowerShell** (Windows). CI runs the same steps on
Linux via [.github/workflows/deploy.yml](../.github/workflows/deploy.yml).

---

## 0. Prerequisites

1. An AWS account with admin access.
2. [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
   installed, then:

   ```powershell
   aws configure          # access key, secret, default region, output json
   aws sts get-caller-identity   # sanity check — note the Account ID
   ```

3. Node.js 20+ and the repo pushed to GitHub.
4. Pick a region and stick to it (examples use `eu-central-1`):

   ```powershell
   $env:AWS_DEFAULT_REGION = "eu-central-1"
   ```

Throughout the guide replace:

| Placeholder      | Meaning                                    |
| ---------------- | ------------------------------------------ |
| `<ACCOUNT_ID>`   | 12-digit AWS account id                    |
| `<REGION>`       | your region, e.g. `eu-central-1`           |
| `<DB_PASSWORD>`  | strong password you generate in step 2     |

---

## 1. One-time setup: artifacts bucket + secrets

CloudFormation needs an S3 bucket to stage the Lambda zip:

```powershell
aws s3 mb "s3://vertik12-cfn-artifacts-<ACCOUNT_ID>"
```

Generate the two JWT secrets (run twice, save both — they go into the stack
in step 4 and into GitHub secrets in step 7):

```powershell
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## 2. Create the PostgreSQL database (RDS)

> RDS is intentionally **not** in the CloudFormation stack: deleting or
> replacing the stack must never be able to delete the database.

```powershell
# Security group in your default VPC
aws ec2 create-security-group --group-name vertik12-db --description "Vertik12 PostgreSQL"
# note the returned GroupId (sg-xxxx)

aws ec2 authorize-security-group-ingress --group-name vertik12-db --protocol tcp --port 5432 --cidr 0.0.0.0/0

# The database itself (~$13/month). Use a long, URL-safe password
# (letters + digits only avoids URL-encoding headaches).
aws rds create-db-instance `
  --db-instance-identifier vertik12-db `
  --db-instance-class db.t4g.micro `
  --engine postgres --engine-version 16.4 `
  --master-username vertik12 `
  --master-user-password "<DB_PASSWORD>" `
  --allocated-storage 20 --storage-type gp3 `
  --db-name vertik12 `
  --publicly-accessible `
  --vpc-security-group-ids sg-xxxx `
  --backup-retention-period 7

# Takes 5–10 minutes:
aws rds wait db-instance-available --db-instance-identifier vertik12-db
aws rds describe-db-instances --db-instance-identifier vertik12-db --query "DBInstances[0].Endpoint.Address" --output text
```

Your connection string (save it — used everywhere below):

```
postgresql://vertik12:<DB_PASSWORD>@<RDS_ENDPOINT>:5432/vertik12?sslmode=require
```

> **Why publicly accessible?** The Lambda runs outside a VPC (no NAT gateway
> cost, direct access to DynamoDB/S3/Stripe/SMTP), so it reaches RDS over TLS
> with a strong password — same model as hosted Postgres (Neon, Supabase).
> RDS PostgreSQL 16 enforces SSL by default (`rds.force_ssl=1`). The
> hardening path (VPC + RDS Proxy) is in §9.

---

## 3. Apply the schema and seed the first users

The repo uses SQLite locally; production is PostgreSQL. Switch, push the
schema, and seed — all from your machine:

```powershell
npm run db:use:postgres        # rewrites the provider line in schema.prisma

$env:DATABASE_URL = "postgresql://vertik12:<DB_PASSWORD>@<RDS_ENDPOINT>:5432/vertik12?sslmode=require"
npm run db:push                # creates all tables
npm run db:seed                # demo school incl. admin login
```

The seed creates `admin@vertik12.school` / `Vertik12!demo` (SUPER_ADMIN) plus
demo staff/students/parents. **Change the admin password after first login**
(the seed is also destructive — it wipes existing rows, so never run it again
against production once you have real data).

To keep developing locally with SQLite afterwards:

```powershell
Remove-Item Env:DATABASE_URL
npm run db:use:sqlite
```

> `db:use:postgres` / `db:use:sqlite` edit `prisma/schema.prisma` in place.
> Committing the file with `provider = "sqlite"` is fine — CI switches to
> postgresql itself before deploying.

---

## 4. First backend deploy (Lambda + API Gateway + DynamoDB + S3 + CloudFront)

Build the Lambda bundle:

```powershell
node apps/api/scripts/set-db-provider.mjs postgresql
npm run db:generate -w @vertik12/api
npm run build:lambda -w @vertik12/api      # → apps/api/dist-lambda/
```

Package and deploy the stack (one command each; the `deploy` takes ~5–10 min
the first time because of CloudFront):

```powershell
aws cloudformation package --template-file infra/template.yaml --s3-bucket "vertik12-cfn-artifacts-<ACCOUNT_ID>" --output-template-file packaged.yaml

aws cloudformation deploy --template-file packaged.yaml --stack-name vertik12 --capabilities CAPABILITY_IAM --parameter-overrides "DatabaseUrl=postgresql://vertik12:<DB_PASSWORD>@<RDS_ENDPOINT>:5432/vertik12?sslmode=require" "JwtAccessSecret=<SECRET_1>" "JwtRefreshSecret=<SECRET_2>"
```

Read the outputs — you'll use all of them:

```powershell
aws cloudformation describe-stacks --stack-name vertik12 --query "Stacks[0].Outputs" --output table
```

| Output               | What it is                                             |
| -------------------- | ------------------------------------------------------ |
| `ApiBaseUrl`         | `https://xxxx.execute-api.<REGION>.amazonaws.com/api/v1` |
| `WebUrl`             | `https://dxxxx.cloudfront.net` — your app URL          |
| `WebBucketName`      | where the static site is uploaded                      |
| `DistributionId`     | for cache invalidations                                |

Smoke-test the API (note: `/health` is at the domain root, not under /api/v1):

```powershell
Invoke-RestMethod "https://xxxx.execute-api.<REGION>.amazonaws.com/health"
# → status: ok, app: Vertik12 …
```

Now that the CloudFront domain exists, point the API's CORS at it
(only changed parameters need to be passed — the rest keep their values):

```powershell
aws cloudformation deploy --template-file packaged.yaml --stack-name vertik12 --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset --parameter-overrides "CorsOrigin=https://dxxxx.cloudfront.net"
```

---

## 5. First frontend deploy (S3 + CloudFront)

```powershell
$env:NEXT_OUTPUT = "export"
$env:NEXT_PUBLIC_API_URL = "<ApiBaseUrl output from step 4>"
npm run build -w @vertik12/web             # → apps/web/out/

aws s3 sync apps/web/out "s3://<WebBucketName>" --delete
aws cloudfront create-invalidation --distribution-id <DistributionId> --paths "/*"
```

Open **`https://dxxxx.cloudfront.net`** and sign in with
`admin@vertik12.school` / `Vertik12!demo`.

---

## 6. Verify production end-to-end

Work through this once; it exercises every infrastructure piece:

1. **Login** (API + RDS + JWT) — sign in, change the admin password.
2. **Deep-link refresh** (CloudFront rewrite function) — open a student
   profile, press F5. The URL like `/students/cm1abc…/` must reload correctly.
3. **Photo upload** (DynamoDB + S3 spill) — upload/capture a student photo,
   reload the profile and confirm it renders. A photo > 350 KB lands in the
   documents S3 bucket; smaller ones live directly in DynamoDB.
4. **Assignment with attachment** (document store, larger payloads).
5. **Finance** — create an invoice, record a payment, open the printable
   receipt and refresh it (second dynamic route).
6. **Report card + payslip** pages (remaining dynamic routes).
7. `aws logs tail /aws/lambda/vertik12-api --since 15m` — no unexpected errors.

If a dynamic route 404s on refresh, the S3 sync or the CloudFront function is
off; check `aws s3 ls s3://<WebBucketName>/students/__id__/` exists.

---

## 7. CI/CD (GitHub Actions, keyless via OIDC)

Pushes to `main` then deploy automatically: schema push → Lambda/stack deploy
→ web build/upload/invalidation. Pull requests run typecheck + both builds
([ci.yml](../.github/workflows/ci.yml)).

### 7.1 Let GitHub authenticate to AWS (no stored keys)

```powershell
aws iam create-open-id-connect-provider --url "https://token.actions.githubusercontent.com" --client-id-list "sts.amazonaws.com"
```

Edit the two files in `infra/`:

- [github-deploy-trust.json](../infra/github-deploy-trust.json) — replace
  `<ACCOUNT_ID>`, `<GITHUB_OWNER>`, `<REPO_NAME>`.
- [github-deploy-policy.json](../infra/github-deploy-policy.json) — review;
  tighten resources later if you wish.

```powershell
aws iam create-role --role-name vertik12-github-deploy --assume-role-policy-document file://infra/github-deploy-trust.json
aws iam put-role-policy --role-name vertik12-github-deploy --policy-name deploy --policy-document file://infra/github-deploy-policy.json
```

Note the role ARN: `arn:aws:iam::<ACCOUNT_ID>:role/vertik12-github-deploy`.

### 7.2 Configure the repository

GitHub → repo → **Settings → Secrets and variables → Actions**:

**Secrets**

| Name                  | Value                                    |
| --------------------- | ---------------------------------------- |
| `AWS_DEPLOY_ROLE_ARN` | the role ARN above                       |
| `DATABASE_URL`        | the full `postgresql://…?sslmode=require` string |
| `JWT_ACCESS_SECRET`   | secret 1 from step 1                     |
| `JWT_REFRESH_SECRET`  | secret 2 from step 1                     |

**Variables**

| Name               | Value                                   |
| ------------------ | --------------------------------------- |
| `AWS_REGION`       | e.g. `eu-central-1`                     |
| `ARTIFACTS_BUCKET` | `vertik12-cfn-artifacts-<ACCOUNT_ID>`   |
| `CORS_ORIGIN`      | `https://dxxxx.cloudfront.net`          |

### 7.3 Ship it

```powershell
git add -A
git commit -m "Production deployment: Lambda API, static web on S3/CloudFront, CI/CD"
git push origin main
```

Watch the **Actions** tab: `deploy-api` then `deploy-web`. From now on every
merge to `main` is a production deploy; use branches + PRs for review, and
the CI workflow keeps them honest.

---

## 8. Day-2 operations

| Task              | How                                                                  |
| ----------------- | -------------------------------------------------------------------- |
| API logs          | `aws logs tail /aws/lambda/vertik12-api --follow`                    |
| Schema changes    | edit `schema.prisma`, merge to main — CI runs `prisma db push`. Destructive changes make the deploy fail on purpose; run them manually with care. |
| Redeploy by hand  | repeat steps 4–5, or Actions → Deploy → "Run workflow"               |
| Roll back         | `git revert` the bad commit and push — CI deploys the previous state |
| DB backups        | automated daily (7-day retention); restore via RDS console snapshots |
| Enable Stripe     | redeploy the stack adding `"StripeSecretKey=sk_live_…" "StripeWebhookSecret=whsec_…"`; point the Stripe webhook at `<ApiBaseUrl>/finance/payments/webhook` |
| Enable email      | redeploy adding `"SmtpHost=…" "SmtpUser=…" "SmtpPass=…" "SmtpFrom=…"` (e.g. Amazon SES SMTP credentials) |
| Custom domain     | ACM certificate **in us-east-1** → add `Aliases` + `ViewerCertificate` to the CloudFront distribution in `infra/template.yaml`, update `CORS_ORIGIN` |

**Cost at low traffic (rough):** RDS db.t4g.micro ≈ $13/mo + storage; Lambda,
API Gateway, DynamoDB (on-demand), S3 and CloudFront are effectively pennies
until you have real load. Set a budget alarm:
`AWS Console → Billing → Budgets → create a $25/mo alert`.

---

## 9. Hardening checklist (when you're ready)

- [ ] Restrict the DB security group: replace `0.0.0.0/0` with your office IP
      for admin access, and move the Lambda into the VPC with an RDS Proxy +
      NAT gateway (adds ~$40/mo) or at minimum rotate the DB password regularly.
- [ ] Move secrets from CloudFormation parameters to AWS Secrets Manager.
- [ ] Turn on DynamoDB point-in-time recovery and S3 versioning on the
      documents bucket.
- [ ] Add AWS WAF on CloudFront and API Gateway (the app's in-memory rate
      limiter is per-Lambda-container, so a WAF rate rule is the real guard).
- [ ] Switch `prisma db push` to migration files (`prisma migrate dev` /
      `migrate deploy`) once the schema stabilises.
- [ ] Move the refresh token from localStorage to an httpOnly cookie
      (already noted in `apps/web/src/lib/api.ts`).
- [ ] RDS Multi-AZ + deletion protection for real high availability.

## Known limits of this architecture

- **Lambda response cap (6 MB)**: student photos are served through the API;
  photos up to ~4 MB are safe. Webcam captures (~100–300 KB) are no issue.
  If you ever need bigger media, switch the photo endpoint to S3 presigned URLs.
- **Cold starts**: first request after idle takes ~1–2 s. Negligible for a
  school back-office; add provisioned concurrency if it ever matters.
- **API Gateway timeout**: 30 s per request — fine for every current endpoint.
