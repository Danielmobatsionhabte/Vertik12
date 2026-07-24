"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BRAND, ROLE_HOME } from "@vertik12/shared";
import { getSession, get } from "@/lib/api";
import { Icon, type IconName } from "@/components/icons";
import { CampusScene } from "@/components/campus-scene";

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: "users", title: "Students & admissions", text: "Enrol students, manage guardians and keep every record in one place." },
  { icon: "calendar", title: "Attendance", text: "Daily registers, absence alerts and printable attendance reports." },
  { icon: "book", title: "Exams & report cards", text: "Gradebooks, approvals and beautiful report cards for every term." },
  { icon: "file", title: "Finance & receipts", text: "Invoices, fee collection and instant printable payment receipts." },
  { icon: "briefcase", title: "Payroll", text: "Salaries, deductions and payslips for teaching and support staff." },
  { icon: "megaphone", title: "Messages & announcements", text: "Reach staff and parents with targeted announcements and messages." },
];

/** Public landing page. Signed-in visitors are sent straight to their portal. */
export default function Home() {
  const [portalHref, setPortalHref] = useState("/login");
  // Admissions are a season: the "Register" call to action only appears
  // while an administrator has the registration window open.
  const [registration, setRegistration] = useState<{ open: boolean; note?: string | null } | null>(null);

  useEffect(() => {
    const session = getSession();
    if (session) setPortalHref(ROLE_HOME[session.user.role] ?? "/dashboard");
  }, []);

  useEffect(() => {
    // A closed window (or an unreachable API) simply means no button — the
    // rest of the page never depends on this call.
    get<{ open: boolean; note?: string | null }>("/registration/status")
      .then(setRegistration)
      .catch(() => setRegistration({ open: false }));
  }, []);

  const registrationOpen = registration?.open === true;

  return (
    <main className="relative min-h-screen overflow-hidden bg-brand-night text-white">
      {/* floating gradient glows */}
      <div aria-hidden className="pointer-events-none absolute -left-40 -top-40 h-[36rem] w-[36rem] rounded-full bg-brand-500/30 blur-3xl animate-float" />
      <div aria-hidden className="pointer-events-none absolute -bottom-48 -right-40 h-[36rem] w-[36rem] rounded-full bg-accent-500/25 blur-3xl animate-float" style={{ animationDelay: "-3s" }} />
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/4 h-80 w-80 -translate-x-1/2 rounded-full bg-fuchsia-500/20 blur-3xl animate-float" style={{ animationDelay: "-6s" }} />

      {/* students walking across the hero, school things drifting behind them */}
      <CampusScene />

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-6">
        {/* top bar */}
        <header className="flex items-center justify-between py-6 animate-fade-up">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-gradient bg-gradient-animated text-lg font-bold shadow-brand-glow ring-1 ring-white/20 animate-gradient-pan">
              V
            </div>
            <span className="text-lg font-semibold tracking-tight">{BRAND.appName}</span>
          </div>
          <div className="flex items-center gap-2">
            {registrationOpen && (
              <Link
                href="/register"
                className="rounded-lg bg-brand-gradient bg-gradient-animated px-4 py-2 text-sm font-semibold shadow-brand-glow ring-1 ring-white/20 transition-transform hover:scale-105 animate-gradient-pan"
              >
                Register
              </Link>
            )}
            <Link href="/login" className="rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-brand-100 transition hover:border-white/30 hover:bg-white/10">
              Sign in
            </Link>
          </div>
        </header>

        {/* hero */}
        <section className="flex flex-1 flex-col items-center justify-center py-16 text-center">
          <p className="rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-medium tracking-wide text-brand-200 animate-fade-up" style={{ animationDelay: "0.1s" }}>
            {BRAND.appName} is powered by {BRAND.poweredBy}
          </p>

          <h1 className="mt-6 max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-6xl animate-fade-up" style={{ animationDelay: "0.2s" }}>
            Run your whole school from{" "}
            <span className="bg-brand-gradient bg-gradient-animated bg-clip-text text-transparent animate-gradient-pan">one place</span>
          </h1>

          <p className="mt-5 max-w-xl text-base text-brand-200/90 sm:text-lg animate-fade-up" style={{ animationDelay: "0.3s" }}>
            {BRAND.tagline} — students, attendance, exams, lesson plans, finance and payroll, together at last.
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3 animate-fade-up" style={{ animationDelay: "0.4s" }}>
            {registrationOpen && (
              <Link
                href="/register"
                className="group inline-flex items-center gap-2 rounded-xl bg-brand-gradient bg-gradient-animated px-8 py-4 text-base font-semibold shadow-brand-glow ring-1 ring-white/20 transition-transform hover:scale-105 animate-gradient-pan"
              >
                Register your child
                <span aria-hidden className="transition-transform group-hover:translate-x-1">→</span>
              </Link>
            )}
            <Link
              href={portalHref}
              className={
                registrationOpen
                  ? "group inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/5 px-8 py-4 text-base font-semibold text-brand-100 backdrop-blur-sm transition hover:border-white/35 hover:bg-white/10"
                  : "group inline-flex items-center gap-2 rounded-xl bg-brand-gradient bg-gradient-animated px-8 py-4 text-base font-semibold shadow-brand-glow ring-1 ring-white/20 transition-transform hover:scale-105 animate-gradient-pan"
              }
            >
              Go to your portal
              <span aria-hidden className="transition-transform group-hover:translate-x-1">→</span>
            </Link>
          </div>

          {registrationOpen && (
            <p className="mt-5 max-w-xl text-sm text-brand-200/80 animate-fade-up" style={{ animationDelay: "0.45s" }}>
              <span className="mr-1.5 inline-flex h-2 w-2 animate-pulse rounded-full bg-emerald-400 align-middle" aria-hidden />
              Admissions are open{registration?.note ? ` — ${registration.note}` : " — new and returning students welcome."}
            </p>
          )}
        </section>

        {/* feature grid */}
        <section className="grid gap-4 pb-16 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <div
              key={f.title}
              className="group rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm transition duration-300 hover:-translate-y-1 hover:border-white/25 hover:bg-white/10 hover:shadow-brand-glow animate-fade-up"
              style={{ animationDelay: `${0.5 + i * 0.08}s` }}
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-500/25 text-brand-200 ring-1 ring-white/10 transition-transform duration-300 group-hover:scale-110">
                <Icon name={f.icon} className="h-5 w-5" />
              </div>
              <h2 className="text-sm font-semibold">{f.title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-brand-200/80">{f.text}</p>
            </div>
          ))}
        </section>

        {/* footer */}
        <footer className="border-t border-white/10 py-8 text-center text-xs text-brand-300/70 animate-fade-up" style={{ animationDelay: "0.6s" }}>
          © {new Date().getFullYear()} {BRAND.appName} · Powered by <span className="font-semibold text-brand-200">{BRAND.poweredBy}</span>
          <span className="mx-1.5">· United States of America</span>
        </footer>
      </div>
    </main>
  );
}
