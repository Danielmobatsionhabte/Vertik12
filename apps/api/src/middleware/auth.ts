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
