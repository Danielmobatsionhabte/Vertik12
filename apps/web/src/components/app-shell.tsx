"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { BRAND, ROLE_MODULES, type ModuleKey, type Role } from "@vertik12/shared";
import { get, getSession, setSession, post, type Session, ApiClientError, SESSION_STORAGE_KEY } from "@/lib/api";
import { applyTheme, getTheme, initTheme, type Theme } from "@/lib/theme";
import { Button, ErrorNote, Field, Input, Modal } from "@/components/ui";

/**
 * Authenticated dashboard chrome: sidebar navigation + top bar.
 * Also the client-side auth guard — no session ⇒ redirect to /login.
 *
 * Navigation is generated from the shared role→module matrix, so a
 * teacher never sees Finance/HR and a parent only sees the portal.
 * (The API enforces the same matrix server-side — this is just UX.)
 */

interface NavLink { href: string; label: string; icon: string; module: ModuleKey }

const NAV: Array<{ section: string; links: NavLink[] }> = [
  {
    section: "Overview",
    links: [
      { href: "/dashboard", label: "Dashboard", icon: "◧", module: "dashboard" },
      { href: "/portal", label: "My Children", icon: "🏠", module: "portal" },
    ],
  },
  {
    section: "People",
    links: [
      { href: "/students", label: "Students", icon: "🎓", module: "students" },
      { href: "/staff", label: "Staff & HR", icon: "🧑‍🏫", module: "staff" },
    ],
  },
  {
    section: "Academics",
    links: [
      { href: "/classes", label: "Classes", icon: "🏫", module: "classes" },
      { href: "/attendance", label: "Attendance", icon: "🗓", module: "attendance" },
      { href: "/exams", label: "Exams & Grades", icon: "📝", module: "exams" },
      { href: "/assignments", label: "Assignments", icon: "📚", module: "assignments" },
      { href: "/exams/approvals", label: "Result approvals", icon: "✔️", module: "exams" },
    ],
  },
  {
    section: "Finance",
    links: [
      { href: "/finance", label: "Fees & Invoices", icon: "💳", module: "finance" },
      { href: "/payroll", label: "Payroll", icon: "💼", module: "payroll" },
    ],
  },
  {
    section: "School",
    links: [
      { href: "/messages", label: "Messages", icon: "✉️", module: "messages" },
      { href: "/announcements", label: "Announcements", icon: "📣", module: "announcements" },
      { href: "/admin", label: "Administration", icon: "⚙️", module: "admin" },
    ],
  },
];

function navForRole(role: Role) {
  const allowed = new Set(ROLE_MODULES[role] ?? []);
  return NAV
    .map((group) => ({ ...group, links: group.links.filter((l) => allowed.has(l.module)) }))
    .filter((group) => group.links.length > 0);
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setLocal] = useState<Session | null>(null);
  const [checked, setChecked] = useState(false);
  const [theme, setTheme] = useState<Theme>("light");
  const [showAccount, setShowAccount] = useState(false);
  const [unread, setUnread] = useState(0);

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

  // Unread-message badge for EVERY portal (staff, parents, students);
  // refreshed on navigation + every minute.
  const refreshUnread = useCallback(() => {
    if (!session) return;
    get<{ unread: number }>("/messages/unread-count").then((d) => setUnread(d.unread)).catch(() => undefined);
  }, [session]);

  useEffect(() => {
    refreshUnread();
    const t = setInterval(refreshUnread, 60_000);
    return () => clearInterval(t);
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

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar (stripped from printouts) */}
      <aside className="fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-slate-200 bg-white print:hidden">
        <div className="flex h-16 items-center gap-2.5 border-b border-slate-100 px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 via-brand-600 to-brand-800 font-bold text-white shadow-md">
            V
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">{BRAND.appName}</p>
            <p className="text-[10px] uppercase tracking-wider text-slate-400">School OS</p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {(session ? navForRole(session.user.role) : []).map((group) => (
            <div key={group.section} className="mb-4">
              <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{group.section}</p>
              {group.links.map((link) => {
                const active = pathname === link.href || pathname.startsWith(link.href + "/");
                const showBadge = link.module === "messages" && unread > 0;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={
                      "mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors " +
                      (active
                        ? "bg-gradient-to-r from-brand-600 to-brand-500 font-medium text-white shadow-sm"
                        : "text-slate-600 hover:bg-slate-100")
                    }
                  >
                    <span aria-hidden>{link.icon}</span>
                    <span className="flex-1">{link.label}</span>
                    {showBadge && (
                      <span
                        className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
                        title={`${unread} unread message(s)`}
                      >
                        {unread}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-100 px-5 py-3">
          <p className="text-[11px] text-slate-400">
            Powered by <span className="font-semibold text-slate-500">{BRAND.poweredBy}</span>
          </p>
        </div>
      </aside>

      {/* Main column */}
      <div className="ml-60 flex min-h-screen flex-1 flex-col print:ml-0">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/80 px-6 backdrop-blur print:hidden">
          <div className="hidden text-sm text-slate-500 sm:block">{BRAND.tagline}</div>
          {session && (
            <div className="flex items-center gap-3">
              <button
                onClick={toggleTheme}
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                aria-label="Toggle dark mode"
              >
                {theme === "dark" ? "☀️" : "🌙"}
              </button>
              <button
                onClick={() => setShowAccount(true)}
                className="flex items-center gap-2.5 rounded-lg px-2 py-1 text-left hover:bg-slate-100"
                title="Account settings"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-semibold text-white">
                  {session.user.firstName[0]}
                </span>
                <span>
                  <span className="block text-sm font-medium text-slate-800">
                    {session.user.firstName} {session.user.lastName}
                  </span>
                  <span className="block text-xs text-slate-400">{session.user.role.replaceAll("_", " ")}</span>
                </span>
              </button>
              <button
                onClick={logout}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
              >
                Sign out
              </button>
            </div>
          )}
        </header>
        <main className="flex-1 p-6 print:p-0">{children}</main>
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
