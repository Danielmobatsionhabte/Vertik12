import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../lib/errors";

/**
 * Small in-memory fixed-window rate limiter with a progressive lockout — no
 * external dependency. Slows credential-stuffing / brute-force attacks on
 * the auth endpoints. For a multi-instance deployment move this state to
 * Redis; the middleware interface stays the same.
 *
 * Progressive lockout: once the limit trips, the key is blocked for
 * `blockMs`, and every further attempt made *while blocked* pushes the
 * unlock time out again. A bot that keeps hammering therefore stays locked
 * out indefinitely, while a human who backs off is let back in on schedule.
 */
interface Window {
  count: number;
  resetAt: number;
  blockedUntil?: number;
}

const buckets = new Map<string, Window>();

// Drop expired windows occasionally so the map can't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [key, w] of buckets) {
    if ((w.blockedUntil ?? w.resetAt) <= now) buckets.delete(key);
  }
}, 60_000).unref();

interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyPrefix: string;
  message?: string;
  /** How long to lock the key out once the limit trips. Defaults to windowMs. */
  blockMs?: number;
  /** Build the throttle key. Defaults to prefix + IP + email-in-body. */
  keyFn?: (req: Request) => string;
}

function reject(res: Response, next: NextFunction, remainingMs: number, message?: string) {
  const retryAfter = Math.max(1, Math.ceil(remainingMs / 1000));
  res.setHeader("Retry-After", String(retryAfter)); // standard HTTP hint
  const minutes = Math.ceil(retryAfter / 60);
  next(
    new ApiError(
      429,
      message ?? `Too many attempts. Please wait about ${minutes} minute(s) and try again.`,
      { retryAfter },
    ),
  );
}

export function rateLimit(options: RateLimitOptions) {
  const blockMs = options.blockMs ?? options.windowMs;
  return (req: Request, res: Response, next: NextFunction) => {
    const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase() : "";
    const key = options.keyFn ? options.keyFn(req) : `${options.keyPrefix}:${req.ip}:${email}`;
    const now = Date.now();
    const win = buckets.get(key);

    // Inside an active lockout: keep blocking, and extend the lockout on
    // every fresh attempt so persistent abuse never gets back in.
    if (win?.blockedUntil && win.blockedUntil > now) {
      win.blockedUntil = now + blockMs;
      return reject(res, next, win.blockedUntil - now, options.message);
    }

    if (!win || win.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }

    win.count += 1;
    if (win.count > options.max) {
      win.blockedUntil = now + blockMs;
      return reject(res, next, blockMs, options.message);
    }
    next();
  };
}

/**
 * Sign-in: 10 attempts / 15 min per IP+email, then a 15-minute lockout that
 * extends while abuse continues. Generous for humans, hostile to bots.
 */
export const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  blockMs: 15 * 60 * 1000,
  keyPrefix: "login",
  message: "Too many sign-in attempts. Please wait 15 minutes and try again.",
});

/**
 * Token refresh: 60 rotations / 5 min per IP. Well above any legitimate
 * client's cadence, but caps a flood of stolen/guessed refresh tokens.
 */
export const refreshRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  keyPrefix: "refresh",
  message: "Too many requests. Please wait a few minutes and try again.",
});

/**
 * Password change verifies the CURRENT password, so it's a brute-force
 * surface too: 5 attempts / 15 min, keyed by the signed-in user (falls back
 * to IP before auth runs).
 */
export const changePasswordRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  blockMs: 15 * 60 * 1000,
  keyPrefix: "pwchange",
  keyFn: (req) => `pwchange:${req.user?.sub ?? req.ip}`,
  message: "Too many password-change attempts. Please wait 15 minutes and try again.",
});
