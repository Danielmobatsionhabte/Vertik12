# Vertik12 API — production container (deploy to AWS App Runner / ECS Fargate).
# Build from the REPO ROOT so workspace packages are included:
#   docker build -f apps/api/Dockerfile -t vertik12-api .
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev --ignore-scripts

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
# Generate the Prisma client for the container's platform (schema should be
# set to postgresql before building: npm run db:use:postgres).
RUN npx prisma generate --schema apps/api/prisma/schema.prisma

EXPOSE 4000
# Run migrations then start. DATABASE_URL, JWT secrets etc. come from the
# task definition / App Runner environment (use AWS Secrets Manager).
CMD ["sh", "-c", "npx prisma migrate deploy --schema apps/api/prisma/schema.prisma; npx tsx apps/api/src/index.ts"]
