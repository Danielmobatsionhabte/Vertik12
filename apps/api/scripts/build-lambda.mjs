/**
 * Build the Lambda deployment bundle into apps/api/dist-lambda/:
 *
 *   node scripts/build-lambda.mjs
 *
 * - Bundles src/lambda.ts (and everything it imports, including the
 *   generated Prisma client and @vertik12/shared) into a single CJS file.
 * - Copies the Linux Prisma query engine next to the bundle; the Lambda
 *   runs with PRISMA_QUERY_ENGINE_LIBRARY pointing at it (set in the
 *   CloudFormation template), so engine resolution is deterministic.
 *
 * Prerequisites: `prisma generate` must have run with schema.prisma set to
 * provider "postgresql" and binaryTargets including "rhel-openssl-3.0.x"
 * (run `npm run db:use:postgres` first).
 */
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(apiRoot, "dist-lambda");

const ENGINE = "libquery_engine-rhel-openssl-3.0.x.so.node";
// npm workspaces hoist the generated client to the repo root node_modules.
const enginePath = [
  path.join(apiRoot, "node_modules", ".prisma", "client", ENGINE),
  path.join(apiRoot, "..", "..", "node_modules", ".prisma", "client", ENGINE),
].find((p) => fs.existsSync(p));

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [path.join(apiRoot, "src", "lambda.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: path.join(outDir, "index.js"),
  // mongodb is a lazily-imported optional driver (DOCUMENT_STORE=mongodb);
  // production uses DynamoDB, so keep it out of the bundle.
  external: ["mongodb"],
  logLevel: "info",
  sourcemap: false,
  minify: false,
});

if (!enginePath) {
  console.error(
    `\nPrisma engine "${ENGINE}" not found in node_modules/.prisma/client.\n` +
      `Run "prisma generate" first (schema.prisma lists rhel-openssl-3.0.x in binaryTargets).\n`,
  );
  process.exit(1);
}
fs.copyFileSync(enginePath, path.join(outDir, ENGINE));
fs.copyFileSync(path.join(apiRoot, "prisma", "schema.prisma"), path.join(outDir, "schema.prisma"));
// apps/api is "type": "module"; the bundle is CJS — pin the module type so
// Node (local smoke tests and the Lambda runtime) never misreads it.
fs.writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ type: "commonjs" }, null, 2));

const size = (f) => (fs.statSync(path.join(outDir, f)).size / 1024 / 1024).toFixed(1);
console.log(`\ndist-lambda ready: index.js ${size("index.js")} MB, engine ${size(ENGINE)} MB`);
