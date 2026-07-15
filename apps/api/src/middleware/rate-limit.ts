import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../lib/errors";

/**
 * Small in-memory fixed-window rate limiter — no external dependency.
 * Used to slow credential-stuffing / brute-force attacks on the auth
 * endpoints. For a multi-instance deployment move this state to Redis;
 * the middleware interface stays the same.
 */
interface Window {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Window>();

// Drop expired windows occasionally so the map can't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [key, w] of buckets) {
    if (w.resetAt <= now) buckets.delete(key);
  }
}, 60_000).unref();

export function rateLimit(options: { windowMs: number; max: number; keyPrefix: string; message?: string }) {
  return (req: Request, _res: Response, next: NextFunction) => {
    // Key on IP + (for logins) the attempted email, so one attacker can't
    // lock everyone out and one user can't be locked out by another IP.
    const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase() : "";
    const key = `${options.keyPrefix}:${req.ip}:${email}`;
    const now = Date.now();
    const window = buckets.get(key);
    if (!window || window.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }
    window.count += 1;
    if (window.count > options.max) {
      const retryIn = Math.ceil((window.resetAt - now) / 1000);
      return next(
        new ApiError(429, options.message ?? `Too many attempts. Try again in ${retryIn} seconds.`),
      );
    }
    next();
  };
}

/** 10 attempts / 15 minutes per IP+email — generous for humans, hostile to bots. */
export const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyPrefix: "login",
  message: "Too many sign-in attempts. Please wait 15 minutes and try again.",
});
