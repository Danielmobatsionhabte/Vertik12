import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma";

/**
 * Audit trail (Super Admin › Audit & Activity Logs).
 *
 * Records every mutating request (POST/PUT/PATCH/DELETE) after the response
 * is sent — who, what route, and the resulting status. Fire-and-forget: an
 * audit write failure never breaks the request itself.
 */
export function auditLogger(req: Request, res: Response, next: NextFunction) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();

  res.on("finish", () => {
    // Skip noise: failed logins are tracked by status anyway, health checks aren't mutating.
    const path = req.originalUrl.split("?")[0] ?? req.originalUrl;
    const action = deriveAction(req.method, path);
    prisma.auditLog
      .create({
        data: {
          userId: req.user?.sub,
          userEmail: req.user?.email,
          role: req.user?.role,
          method: req.method,
          path,
          action,
          status: res.statusCode,
          ip: req.ip,
        },
      })
      .catch(() => undefined);
  });
  next();
}

/** "/api/v1/students/abc" + POST → "students.create"; PATCH → "students.update"… */
function deriveAction(method: string, path: string): string {
  const parts = path.replace(/^\/api\/v1\//, "").split("/").filter(Boolean);
  const resource = parts.filter((p) => !/^[a-z0-9]{20,}$/i.test(p)).join(".") || "root";
  const verb =
    method === "POST" ? (parts.length > 1 ? "action" : "create")
    : method === "DELETE" ? "delete"
    : "update";
  return `${resource}.${verb}`;
}
