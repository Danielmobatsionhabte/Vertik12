import type { NextFunction, Request, Response } from "express";
import type { AuthTokenPayload, Role } from "@vertik12/shared";
import { verifyAccessToken } from "../lib/auth-tokens";
import { ApiError } from "../lib/errors";
import { prisma } from "../lib/prisma";

// Make the authenticated user available on req.user everywhere.
declare module "express-serve-static-core" {
  interface Request {
    user?: AuthTokenPayload;
  }
}

/**
 * Daily-visitor tracking for the admin dashboard: one row per user per day.
 * The in-process cache keeps it to a single DB write per user per day, so
 * the per-request overhead is a Set lookup. Fire-and-forget — a stats
 * write must never fail a real request.
 */
const visitCache = new Set<string>();
setInterval(() => visitCache.clear(), 6 * 60 * 60 * 1000).unref(); // guard the Set's size across day rollovers

function recordVisit(userId: string, role: string) {
  // Fully isolated from the request: any failure here — a stale Prisma
  // client without the DailyVisit model, a DB hiccup — must be swallowed,
  // never surfaced as a 500. Promise.resolve().then(...) also converts a
  // synchronous throw (e.g. prisma.dailyVisit undefined) into a caught
  // rejection instead of blowing up the auth chain.
  try {
    const today = new Date();
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const key = `${userId}:${date.toISOString().slice(0, 10)}`;
    if (visitCache.has(key)) return;
    visitCache.add(key);
    Promise.resolve()
      .then(() =>
        prisma.dailyVisit.upsert({
          where: { userId_date: { userId, date } },
          create: { userId, role, date },
          update: {},
        }),
      )
      .catch(() => visitCache.delete(key)); // retry on the next request
  } catch {
    /* visitor tracking is best-effort — never let it break a request */
  }
}

/**
 * Requires a valid `Authorization: Bearer <token>` header.
 *
 * The JWT alone is not trusted for account status: the user row is checked on
 * every request so that deactivating an account (Super Admin › User
 * Management) locks the user out immediately — mid-session — instead of when
 * their access token expires. The DB role also overrides the token role, so a
 * role change applies instantly too.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(ApiError.unauthorized());
  }
  const payload = verifyAccessToken(header.slice("Bearer ".length));

  prisma.user
    .findUnique({ where: { id: payload.sub }, select: { isActive: true, role: true } })
    .then((user) => {
      if (!user || !user.isActive) {
        // Same error the refresh endpoint uses — the client signs the user out.
        throw ApiError.unauthorized("Account is disabled");
      }
      req.user = { ...payload, role: user.role as Role };
      recordVisit(payload.sub, user.role);
      next();
    })
    .catch(next);
}

/**
 * Role-based access control. SUPER_ADMIN implicitly passes every check.
 * Usage: router.post("/", requireRoles("ADMIN", "ACCOUNTANT"), handler)
 */
export function requireRoles(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (req.user.role === "SUPER_ADMIN" || roles.includes(req.user.role)) return next();
    next(ApiError.forbidden());
  };
}
