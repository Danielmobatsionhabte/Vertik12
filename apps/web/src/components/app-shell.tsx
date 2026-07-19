"use client";

import Link from "next/link";
import { notFound, usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { BRAND, ROLE_MODULES, type ModuleKey, type Role } from "@vertik12/shared";
import { get, getSession, setSession, post, touchActivity, idleMs, IDLE_TIMEOUT_MS, type Session, ApiClientError, SESSION_STORAGE_KEY } from "@/lib/api";
import { applyTheme, getTheme, initTheme, type Theme } from "@/lib/theme";
import { isSoundEnabled, setSoundEnabled, playNotificationChime } from "@/lib/sound";
import { Button, ErrorNote, Field, Input, Modal } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";

/**
 * Authenticated dashboard chrome: sidebar navigation + top bar.
 * Also the client-side auth guard — no session ⇒ redirect to /login.
 *
 * Navigation is generated from the shared role→module matrix, so a
 * teacher never sees Finance/HR and a parent only sees the portal.
 * (The API enforces the same matrix server-side — this is just UX.)
 */

interface NavLink { href: string; label: string; icon: IconName; module: ModuleKey }

const NAV: Array<{ section: string; links: NavLink[] }> = [
  {
    section: "Overview",
    links: [
      { href: "/dashboard", label: "Dashboard", icon: "grid", module: "dashboard" },
      { href: "/portal", label: "My Children", icon: "home", module: "portal" },
    ],
  },
  {
    section: "People",
    links: [
      { href: "/students", label: "Students", icon: "graduation-cap", module: "students" },
      { href: "/staff", label: "Staff & HR", icon: "users", module: "staff" },
    ],
  },
  {
    section: "Academics",
    links: [
      { href: "/classes", label: "Classes", icon: "building", module: "classes" },
      { href: "/attendance", label: "Attendance", icon: "calendar", module: "attendance" },
      { href: "/exams", label: "Exams & Grades", icon: "edit", module: "exams" },
      { href: "/assignments", label: "Assignments", icon: "book", module: "assignments" },
      { href: "/lesson-plans", label: "Lesson plans", icon: "book-open", module: "lessons" },
      { href: "/exams/approvals", label: "Result approvals", icon: "check-circle", module: "exams" },
    ],
  },
  {
    section: "Finance",
    links: [
      { href: "/finance", label: "Fees & Invoices", icon: "credit-card", module: "finance" },
      { href: "/payroll", label: "Payroll", icon: "briefcase", module: "payroll" },
    ],
  },
  {
    section: "School",
    links: [
      { href: "/messages", label: "Messages", icon: "mail", module: "messages" },
      { href: "/announcements", label: "Announcements", icon: "megaphone", module: "announcements" },
      { href: "/admin", label: "Administration", icon: "settings", module: "admin" },
    ],
  },
];

function navForRole(role: Role) {
  const allowed = new Set(ROLE_MODULES[role] ?? []);
  return NAV
    .map((group) => ({ ...group, links: group.links.filter((l) => allowed.has(l.module)) }))
    .filter((group) => group.links.length > 0);
}

/**
 * Route → module map for the client-side RBAC guard. Every dashboard route
 * belongs to a module; a role without that module gets a 404 — the page
 * "doesn't exist" for them, exactly like typing a random URL. The API
 * enforces the same matrix, so this is defense in depth, not the only wall.
 */
const ROUTE_MODULES: Array<{ prefix: string; module: ModuleKey }> = [
  { prefix: "/dashboard", module: "dashboard" },
  { prefix: "/students", module: "students" },
  { prefix: "/staff", module: "staff" },
  { prefix: "/classes", module: "classes" },
  { prefix: "/attendance", module: "attendance" },
  { prefix: "/exams", module: "exams" },
  { prefix: "/assignments", module: "assignments" },
  { prefix: "/lesson-plans", module: "lessons" },
  { prefix: "/finance", module: "finance" },
  { prefix: "/payroll", module: "payroll" },
  { prefix: "/announcements", module: "announcements" },
  { prefix: "/messages", module: "messages" },
  { prefix: "/admin", module: "admin" },
  { prefix: "/portal", module: "portal" },
];

function moduleForPath(pathname: string): ModuleKey | null {
  const match = ROUTE_MODULES.find((r) => pathname === r.prefix || pathname.startsWith(r.prefix + "/"));
  return match?.module ?? null;
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setLocal] = useState<Session | null>(null);
  const [checked, setChecked] = useState(false);
  const [theme, setTheme] = useState<Theme>("light");
  const [showAccount, setShowAccount] = useState(false);
  const [unread, setUnread] = useState({ messages: 0, announcements: 0 });
  // Previous unread counts — a RISE means something new arrived → chime.
  // null until the first poll so loading an already-full inbox stays silent.
  const prevUnread = useRef<{ messages: number; announcements: number } | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  // Mobile: the sidebar becomes a slide-in drawer (parents/teachers on phones).
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    setSoundOn(isSoundEnabled());
  }, []);

  // Navigating closes the drawer so the next page is immediately visible.
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    initTheme();
    setTheme(getTheme());
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    setLocal(s);
    setChecked(true);
  }, [router]);

  // 2-hour inactivity sign-out. Real interactions (click/type/scroll/touch)
  // stamp a shared last-activity marker; a minute-ticker ends the session
  // once the user has been away for IDLE_TIMEOUT_MS. The API enforces the
  // same window server-side (refresh tokens live 2h), so this is the UX
  // half of the rule, not the only wall.
  useEffect(() => {
    if (!session) return;
    touchActivity(); // signing in / opening the app counts as activity
    const mark = () => touchActivity();
    const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"];
    events.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    const check = () => {
      if (idleMs() > IDLE_TIMEOUT_MS) {
        setSession(null); // storage event signs out every other tab too
        router.replace("/login?reason=idle");
      }
    };
    const timer = setInterval(check, 60_000);
    check();
    return () => {
      events.forEach((e) => window.removeEventListener(e, mark));
      clearInterval(timer);
    };
  }, [session, router]);

  // Unread badges (messages + announcements) for EVERY portal (staff,
  // parents, students); refreshed on navigation + every minute, and
  // immediately when a page signals it (e.g. Announcements marks itself
  // seen and dispatches "vertik12:badges-refresh").
  const refreshUnread = useCallback(() => {
    if (!session) return;
    void Promise.all([
      get<{ unread: number }>("/messages/unread-count").catch(() => ({ unread: 0 })),
      get<{ unread: number }>("/announcements/unread-count").catch(() => ({ unread: 0 })),
    ]).then(([m, a]) => {
      const next = { messages: m.unread, announcements: a.unread };
      // New message or announcement since the last poll → play the chime
      // (first poll only sets the baseline, so a full inbox stays quiet).
      const prev = prevUnread.current;
      if (prev && (next.messages > prev.messages || next.announcements > prev.announcements)) {
        playNotificationChime();
      }
      prevUnread.current = next;
      setUnread(next);
    });
  }, [session]);

  useEffect(() => {
    refreshUnread();
    const t = setInterval(refreshUnread, 60_000);
    window.addEventListener("vertik12:badges-refresh", refreshUnread);
    return () => {
      clearInterval(t);
      window.removeEventListener("vertik12:badges-refresh", refreshUnread);
    };
  }, [refreshUnread, pathname]);

  // Live access revocation. The API re-checks the account on every request,
  // so when the Super Admin deactivates this user the next call 401s, the
  // refresh is rejected and api() clears the session + redirects to /login.
  // This heartbeat guarantees that "next call" happens within seconds even if
  // the user is just sitting on a page, and the storage listener signs out
  // every other open tab the moment one of them is kicked.
  useEffect(() => {
    if (!session) return;
    const ping = () => {
      if (document.visibilityState === "visible") void get("/auth/me").catch(() => undefined);
    };
    const timer = setInterval(ping, 15_000);
    window.addEventListener("focus", ping);
    document.addEventListener("visibilitychange", ping);
    const onStorage = (e: StorageEvent) => {
      if (e.key === SESSION_STORAGE_KEY && !e.newValue) router.replace("/login?reason=session-ended");
    };
    window.addEventListener("storage", onStorage);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", ping);
      document.removeEventListener("visibilitychange", ping);
      window.removeEventListener("storage", onStorage);
    };
  }, [session, router]);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  }

  async function logout() {
    const s = getSession();
    if (s) await post("/auth/logout", { refreshToken: s.refreshToken }).catch(() => undefined);
    setSession(null);
    router.replace("/login");
  }

  if (!checked) return null; // avoid flashing protected content pre-guard

  // Unauthorized module for this role ⇒ 404. A parent poking at /staff, a
  // registrar trying /payroll, a teacher opening /admin — all get the same
  // "page not found" as a URL that never existed.
  if (session) {
    const module = moduleForPath(pathname);
    if (module && !(ROLE_MODULES[session.user.role] ?? []).includes(module)) {
      notFound();
    }
  }

  return (
    <div className="app-backdrop flex min-h-screen">
      {/* Mobile drawer backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm lg:hidden print:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      )}

      {/* Sidebar — blue-black chrome. Fixed on desktop; slide-in drawer on
          mobile (parents/teachers use their phones). Stripped from printouts. */}
      <aside
        className={
          "fixed inset-y-0 left-0 z-50 flex w-60 transform flex-col border-r border-white/10 " +
          "bg-gradient-to-b from-[#070b17] via-[#0b1226] to-[#151038] transition-transform duration-200 print:hidden " +
          (sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0")
        }
      >
        <div className="flex h-16 items-center gap-2.5 border-b border-white/10 px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-gradient bg-[length:150%_150%] font-bold text-white shadow-brand-glow animate-gradient-pan bg-gradient-animated">
            V
          </div>
          <div className="flex-1">
            <p className="bg-gradient-to-r from-brand-300 via-accent-300 to-fuchsia-300 bg-clip-text text-sm font-bold text-transparent">
              {BRAND.appName}
            </p>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">School OS</p>
          </div>
          <button
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
          >
            <Icon name="x" className="h-4 w-4 text-white" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {(session ? navForRole(session.user.role) : []).map((group) => (
            <div key={group.section} className="mb-4">
              <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{group.section}</p>
              {group.links.map((link) => {
                const active = pathname === link.href || pathname.startsWith(link.href + "/");
                const badgeCount =
                  link.module === "messages" ? unread.messages
                  : link.module === "announcements" ? unread.announcements
                  : 0;
                const showBadge = badgeCount > 0;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={
                      "mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-all " +
                      (active
                        ? "bg-brand-gradient-soft font-semibold text-white shadow-brand-glow"
                        : "text-slate-300 hover:bg-white/10 hover:text-white")
                    }
                  >
                    <Icon name={link.icon} className="h-4 w-4 text-white" />
                    <span className="flex-1">{link.label}</span>
                    {showBadge && (
                      <span
                        className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
                        title={`${badgeCount} unread ${link.module === "messages" ? "message(s)" : "announcement(s)"}`}
                      >
                        {badgeCount}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 px-5 py-3">
          <p className="text-[11px] text-slate-500">
            Powered by <span className="font-semibold text-slate-400">{BRAND.poweredBy}</span>
          </p>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-h-screen flex-1 flex-col lg:ml-60 print:ml-0">
        {/* Header — matching blue-black band that frames the content */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-white/10 bg-[#0a0f1f]/95 px-4 backdrop-blur sm:px-6 print:hidden">
          <div className="flex items-center gap-3">
            <button
              className="rounded-lg border border-white/15 px-2.5 py-1.5 text-slate-300 hover:bg-white/10 hover:text-white lg:hidden"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
            >
              <Icon name="menu" className="h-4 w-4 text-white" />
            </button>
            <div className="hidden text-sm text-slate-400 lg:block">{BRAND.tagline}</div>
          </div>
          {session && (
            <div className="flex items-center gap-2 sm:gap-3">
              <button
                onClick={() => {
                  const next = !soundOn;
                  setSoundEnabled(next);
                  setSoundOn(next);
                  if (next) playNotificationChime(); // preview the chime
                }}
                className="rounded-lg border border-white/15 px-2.5 py-1.5 text-sm text-slate-300 hover:bg-white/10"
                title={soundOn ? "Notification sound on — click to mute" : "Notification sound off — click to enable"}
                aria-label="Toggle notification sound"
              >
                <Icon name={soundOn ? "bell" : "bell-off"} className="h-4 w-4 text-white" />
              </button>
              <button
                onClick={toggleTheme}
                className="rounded-lg border border-white/15 px-2.5 py-1.5 text-sm text-slate-300 hover:bg-white/10"
                title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                aria-label="Toggle dark mode"
              >
                <Icon name={theme === "dark" ? "sun" : "moon"} className="h-4 w-4 text-white" />
              </button>
              <button
                onClick={() => setShowAccount(true)}
                className="flex items-center gap-2.5 rounded-lg px-2 py-1 text-left hover:bg-white/10"
                title="Account settings"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-gradient text-sm font-semibold text-white shadow-brand-glow">
                  {session.user.firstName[0]}
                </span>
                <span className="hidden sm:block">
                  <span className="block text-sm font-medium text-white">
                    {session.user.firstName} {session.user.lastName}
                  </span>
                  <span className="block text-xs text-slate-400">{session.user.role.replaceAll("_", " ")}</span>
                </span>
              </button>
              <button
                onClick={logout}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/10"
              >
                Sign out
              </button>
            </div>
          )}
        </header>
        <main className="flex-1 p-4 sm:p-6 print:p-0">{children}</main>
      </div>

      {session && (showAccount || session.user.mustChangePassword) && (
        <AccountModal
          session={session}
          forced={session.user.mustChangePassword === true}
          onClose={() => setShowAccount(false)}
          onPasswordChanged={() => {
            const next: Session = { ...session, user: { ...session.user, mustChangePassword: false } };
            setSession(next);
            setLocal(next);
          }}
        />
      )}
    </div>
  );
}

/**
 * Account settings — available to every user in every portal (admin,
 * teacher, registrar, accountant, parent, student). Users who received a
 * temporary password change it here; changing revokes all other sessions.
 *
 * `forced` = the account still has a temporary password: the dialog cannot
 * be dismissed until a new password is set (first-sign-in flow).
 */
function AccountModal({ session, forced, onClose, onPasswordChanged }: {
  session: Session;
  forced?: boolean;
  onClose: () => void;
  onPasswordChanged: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (newPassword === currentPassword) {
      setError("The new password must be different from the temporary one");
      return;
    }
    if (newPassword !== confirm) {
      setError("New passwords do not match");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await post("/auth/change-password", { currentPassword, newPassword });
      onPasswordChanged();
      setMessage("Password changed. Other devices were signed out; use the new password next time.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      if (forced) onClose(); // gate lifted — continue into the portal
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to change password");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title={forced ? "Set your own password" : "Account settings"}
      onClose={forced ? () => undefined : onClose}
      dismissable={!forced}
    >
      <div className="space-y-5">
        {forced && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            You signed in with a temporary password. Please choose your own password to continue — you&apos;ll use it from now on.
          </div>
        )}
        <div className="rounded-lg bg-slate-50 p-4 text-sm">
          <p className="font-medium text-slate-800">{session.user.firstName} {session.user.lastName}</p>
          <p className="text-slate-500">{session.user.email}</p>
          <p className="mt-1 text-xs text-slate-400">Role: {session.user.role.replaceAll("_", " ")}</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          {!forced && <p className="text-sm font-semibold text-slate-700">Change password</p>}
          <Field label={forced ? "Temporary password" : "Current password"} hint={forced ? "The password you just signed in with" : "The temporary password if this is your first sign-in"}>
            <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required minLength={8} autoComplete="current-password" />
          </Field>
          <Field label="New password" hint="At least 8 characters">
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
          </Field>
          <Field label="Confirm new password">
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} autoComplete="new-password" />
          </Field>
          {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">{message}</div>}
          <ErrorNote message={error} />
          <div className="flex justify-end gap-3">
            {!forced && <Button type="button" variant="secondary" onClick={onClose}>Close</Button>}
            <Button type="submit" loading={saving}>{forced ? "Save new password" : "Change password"}</Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
