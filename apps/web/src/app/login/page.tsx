"use client";

import { useEffect, useState, type FormEvent } from "react";
import { initTheme } from "@/lib/theme";
import { useRouter } from "next/navigation";
import { BRAND, ROLE_HOME, type AuthResponse } from "@vertik12/shared";
import { post, setSession, ApiClientError } from "@/lib/api";
import { Button, Card, ErrorNote, Field, Input } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@vertik12.school");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    initTheme(); // respect the saved light/dark choice
    // Set when api() force-signs the user out (session revoked / account
    // deactivated by an administrator, or the refresh token expired).
    if (new URLSearchParams(window.location.search).get("reason") === "session-ended") {
      setNotice("You were signed out: your session ended or your access was changed by an administrator.");
    }
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await post<AuthResponse>("/auth/login", { email, password });
      setSession({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
      router.replace(ROLE_HOME[data.user.role] ?? "/dashboard"); // parents land on the portal
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Unable to reach the server. Is the API running?");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-950 via-brand-900 to-slate-900 p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 text-xl font-bold text-white ring-1 ring-white/20">
            V
          </div>
          <h1 className="text-2xl font-semibold text-white">{BRAND.appName}</h1>
          <p className="mt-1 text-sm text-brand-200">{BRAND.tagline}</p>
        </div>

        <Card className="p-8">
          {notice && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{notice}</div>
          )}
          <form onSubmit={onSubmit} className="space-y-4">
            <Field label="Email address">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required maxLength={254} />
            </Field>
            <Field label="Password" hint="Demo password: Vertik12!demo">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required minLength={8} maxLength={128} />
            </Field>
            <ErrorNote message={error} />
            <Button type="submit" loading={loading} className="w-full">
              Sign in
            </Button>
          </form>
        </Card>

        <p className="mt-6 text-center text-xs text-brand-300/70">
          Powered by <span className="font-semibold text-brand-200">{BRAND.poweredBy}</span>
        </p>
      </div>
    </div>
  );
}
