import jwt, { type SignOptions } from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import type { AuthTokenPayload } from "@vertik12/shared";
import { env } from "../config/env";
import { ApiError } from "./errors";

// ---------- passwords ----------

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

// ---------- JWTs ----------

export function signAccessToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL,
  } as SignOptions);
}

export function signRefreshToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_TTL,
    jwtid: crypto.randomUUID(),
  } as SignOptions);
}

/**
 * `iat` (issued-at, seconds) comes back alongside the payload we signed. The
 * auth middleware compares it against the user's session cut-off, so an
 * administrator resetting a password invalidates tokens already in the wild.
 */
export function verifyAccessToken(token: string): AuthTokenPayload & { iat?: number } {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET) as AuthTokenPayload & { iat?: number };
  } catch {
    throw ApiError.unauthorized("Invalid or expired access token");
  }
}

export function verifyRefreshToken(token: string): { sub: string } {
  try {
    return jwt.verify(token, env.JWT_REFRESH_SECRET) as { sub: string };
  } catch {
    throw ApiError.unauthorized("Invalid or expired refresh token");
  }
}

/** Refresh tokens are stored hashed so a DB leak cannot be replayed. */
export const hashToken = (token: string) =>
  crypto.createHash("sha256").update(token).digest("hex");
