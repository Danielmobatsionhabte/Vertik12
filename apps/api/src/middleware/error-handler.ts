import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { ApiError } from "../lib/errors";
import { isProd } from "../config/env";

/** Global error handler — every thrown/next()ed error funnels through here. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  // Map common Prisma errors to friendly HTTP responses.
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return res.status(409).json({ success: false, message: "A record with that unique value already exists" });
    }
    if (err.code === "P2025") {
      return res.status(404).json({ success: false, message: "Record not found" });
    }
  }

  console.error("[unhandled]", err);
  return res.status(500).json({
    success: false,
    message: isProd ? "Internal server error" : `Internal error: ${(err as Error)?.message ?? String(err)}`,
  });
}

/** Wraps async route handlers so rejections reach the error handler (Express 4). */
export const asyncHandler =
  <T extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>>(fn: T) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res, next).catch(next);
