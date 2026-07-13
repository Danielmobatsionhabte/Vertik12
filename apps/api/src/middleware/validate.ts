import type { NextFunction, Request, Response } from "express";
import type { ZodTypeAny } from "zod";
import { ApiError } from "../lib/errors";

/**
 * Validates and *replaces* req.body / req.query with the parsed result,
 * so handlers downstream get coerced, defaulted, typed data.
 */
export const validateBody = (schema: ZodTypeAny) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next(ApiError.badRequest("Validation failed", result.error.flatten().fieldErrors));
    }
    req.body = result.data;
    next();
  };

export const validateQuery = (schema: ZodTypeAny) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return next(ApiError.badRequest("Invalid query parameters", result.error.flatten().fieldErrors));
    }
    // req.query is a getter in Express 4 — stash parsed values separately.
    (req as Request & { parsedQuery: unknown }).parsedQuery = result.data;
    next();
  };

/** Read back the parsed query with the right type. */
export function parsedQuery<T>(req: Request): T {
  return ((req as Request & { parsedQuery?: T }).parsedQuery ?? req.query) as T;
}
