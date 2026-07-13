/**
 * Switch the Prisma datasource provider between sqlite (zero-config local
 * dev) and postgresql (production / AWS RDS). Prisma cannot read the
 * provider from an env var, so this rewrites the one line in schema.prisma.
 *
 *   npm run db:use:postgres   → provider = "postgresql"
 *   npm run db:use:sqlite     → provider = "sqlite"
 *
 * Remember to point DATABASE_URL at the matching database and re-run
 * `npm run db:push` (or `prisma migrate deploy` in production).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const target = process.argv[2];
if (!["sqlite", "postgresql"].includes(target)) {
  console.error("Usage: node set-db-provider.mjs <sqlite|postgresql>");
  process.exit(1);
}

const schemaPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../prisma/schema.prisma");
const schema = fs.readFileSync(schemaPath, "utf8");
const updated = schema.replace(
  /(datasource db \{[^}]*provider\s*=\s*)"(sqlite|postgresql)"/,
  `$1"${target}"`,
);
if (schema === updated) {
  console.log(`Provider already set to "${target}" (or pattern not found).`);
} else {
  fs.writeFileSync(schemaPath, updated);
  console.log(`Prisma datasource provider set to "${target}".`);
  console.log(`Next: set DATABASE_URL in apps/api/.env, then run "npm run db:push" and "npm run db:seed".`);
}
