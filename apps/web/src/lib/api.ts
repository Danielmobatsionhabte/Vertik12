"use client";

import type { AuthResponse } from "@vertik12/shared";

/**
 * Typed API client for the browser.
 *
 * - Attaches the JWT access token to every request.
 * - On a 401, transparently tries one refresh-token rotation and retries;
 *   if that fails the session is cleared and the user is sent to /login.
 *
 * Tokens live in localStorage for simplicity. For a hardened deployment,
 * move the refresh token into an httpOnly cookie set by the API.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

// Exported so the app shell can watch cross-tab sign-outs via storage events.
export const SESSION_STORAGE_KEY = "vertik12.session";
const STORAGE_KEY = SESSION_STORAGE_KEY;

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: AuthResponse["user"];
}

export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function setSession(session: Session | null) {
  if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  else localStorage.removeItem(STORAGE_KEY);
}

export class ApiClientError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: Record<string, string[]>,
  ) {
    super(message);
  }
}

async function rawRequest<T>(path: string, options: RequestInit, token?: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: T;
    message?: string;
    details?: Record<string, string[]>;
  };
  if (!res.ok) throw new ApiClientError(res.status, body.message ?? `Request failed (${res.status})`, body.details);
  return body.data as T;
}

let refreshing: Promise<Session | null> | null = null;

/** One shared refresh promise so parallel 401s trigger a single rotation. */
async function tryRefresh(): Promise<Session | null> {
  refreshing ??= (async () => {
    const session = getSession();
    if (!session) return null;
    try {
      const data = await rawRequest<AuthResponse>("/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
      const next: Session = { accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user };
      setSession(next);
      return next;
    } catch {
      setSession(null);
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const session = getSession();
  try {
    return await rawRequest<T>(path, options, session?.accessToken);
  } catch (err) {
    if (err instanceof ApiClientError && err.status === 401 && session) {
      const renewed = await tryRefresh();
      if (renewed) return rawRequest<T>(path, options, renewed.accessToken);
      // Refresh rejected — the account was disabled or the session revoked.
      // Kick the user out right away; the login page explains why.
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
        window.location.href = "/login?reason=session-ended";
      }
    }
    throw err;
  }
}

// Convenience verbs -----------------------------------------------------
export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
export const put = <T>(path: string, body: unknown) =>
  api<T>(path, { method: "PUT", body: JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown) =>
  api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const del = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: "DELETE", body: body === undefined ? undefined : JSON.stringify(body) });
