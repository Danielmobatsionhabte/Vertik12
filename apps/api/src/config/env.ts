import { z } from "zod";

// Load apps/api/.env into process.env (Node ≥20.12 built-in; no dotenv needed).
// npm workspace scripts run with apps/api as the cwd, so the bare call finds it.
try {
  process.loadEnvFile();
} catch {
  // no .env file — fall back to the defaults below
}

/**
 * Fail-fast environment validation: the process refuses to boot with a
 * missing/invalid configuration instead of failing mysteriously later.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default("file:./dev.db"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  JWT_ACCESS_SECRET: z.string().default("dev-access-secret-change-me"),
  JWT_REFRESH_SECRET: z.string().default("dev-refresh-secret-change-me"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  // Idle session lifetime — the refresh token rotates on activity, so this
  // is how long a user can stay away before being signed out.
  JWT_REFRESH_TTL: z.string().default("2h"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  DEFAULT_CURRENCY: z.string().length(3).default("USD"),
});

export const env = envSchema.parse(process.env);

export const isProd = env.NODE_ENV === "production";

if (isProd && env.JWT_ACCESS_SECRET.startsWith("dev-")) {
  throw new Error("Refusing to start in production with default JWT secrets. Set JWT_ACCESS_SECRET / JWT_REFRESH_SECRET.");
}
