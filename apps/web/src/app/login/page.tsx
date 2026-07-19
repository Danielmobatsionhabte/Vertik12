"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { initTheme } from "@/lib/theme";
import { useRouter } from "next/navigation";
import { BRAND, ROLE_HOME, type AuthResponse } from "@vertik12/shared";
import { post, setSession, ApiClientError } from "@/lib/api";
import { Button, Field, Input } from "@/components/ui";
import { Icon } from "@/components/icons";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@vertik12.school");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Rate-limit lockout: when the API returns 429 it includes retryAfter
  // (seconds). We block the form and count down so the user isn't left
  // guessing, and repeated attempts can't be fired off in the meantime.
  const [lockedFor, setLockedFor] = useState(0);
  const [lockMessage, setLockMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    initTheme(); // respect the saved light/dark choice
    const reason = new URLSearchParams(window.location.search).get("reason");
    if (reason === "session-ended") {
      setNotice("You were signed out: your session ended or your access was changed by an administrator.");
    } else if (reason === "idle") {
      setNotice("You were signed out after 2 hours of inactivity. Please sign in again.");
    }
  }, []);

  useEffect(() => {
    if (lockedFor <= 0) return;
    timer.current = setInterval(() => setLockedFor((s) => Math.max(0, s - 1)), 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [lockedFor > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (lockedFor > 0) return;
    setError(null);
    setLoading(true);
    try {
      const data = await post<AuthResponse>("/auth/login", { email, password });
      setSession({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
      router.replace(ROLE_HOME[data.user.role] ?? "/dashboard"); // parents land on the portal
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 429) {
        const retry = (err.details as unknown as { retryAfter?: number } | undefined)?.retryAfter ?? 900;
        setLockedFor(retry);
        setLockMessage(err.message);
        setError(null);
      } else {
        setError(err instanceof ApiClientError ? err.message : "Unable to reach the server. Is the API running?");
      }
    } finally {
      setLoading(false);
    }
  }

  const mm = String(Math.floor(lockedFor / 60)).padStart(2, "0");
  const ss = String(lockedFor % 60).padStart(2, "0");

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-brand-night p-4">
      {/* animated gradient glows */}
      <div aria-hidden className="pointer-events-none absolute -left-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-brand-500/30 blur-3xl animate-gradient-pan" />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 -right-40 h-[32rem] w-[32rem] rounded-full bg-accent-500/30 blur-3xl animate-gradient-pan" />
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/3 h-72 w-72 -translate-x-1/2 rounded-full bg-fuchsia-500/20 blur-3xl" />

      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient bg-[length:150%_150%] text-2xl font-bold text-white shadow-brand-glow ring-1 ring-white/20 animate-gradient-pan bg-gradient-animated">
            V
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">{BRAND.appName}</h1>
          <p className="mt-1.5 text-sm text-brand-200">{BRAND.tagline}</p>
        </div>

        {/* glassy card */}
        <div className="overflow-hidden rounded-2xl border border-white/15 bg-white/95 shadow-2xl backdrop-blur-xl dark:bg-slate-900/80">
          <div aria-hidden className="h-1.5 w-full bg-brand-gradient" />
          <div className="p-8">
            {notice && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{notice}</div>
            )}

            {lockedFor > 0 ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-rose-100"><Icon name="lock" className="h-6 w-6 text-rose-600" /></div>
                <p className="text-sm font-semibold text-rose-800">Sign-in temporarily locked</p>
                <p className="mt-1 text-xs text-rose-700">{lockMessage}</p>
                <p className="mt-3 font-mono text-2xl font-bold tabular-nums text-rose-900">{mm}:{ss}</p>
                <p className="mt-1 text-xs text-rose-600">Too many attempts were blocked to protect the account.</p>
              </div>
            ) : (
              <form onSubmit={onSubmit} className="space-y-4">
                <Field label="Email address">
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required maxLength={254} />
                </Field>
                <Field label="Password" hint="Demo password: Vertik12!demo">
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required minLength={8} maxLength={128} />
                </Field>
                {error && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
                )}
                <Button type="submit" loading={loading} className="w-full">
                  Sign in
                </Button>
              </form>
            )}
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-brand-300/70">
          Powered by <span className="font-semibold text-brand-200">{BRAND.poweredBy}</span>
        </p>
      </div>
    </div>
  );
}
