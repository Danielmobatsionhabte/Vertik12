"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Paginated } from "@vertik12/shared";
import { ROLES } from "@vertik12/shared";
import { useGrades } from "@/lib/grades";
import { get, post, patch, put, ApiClientError } from "@/lib/api";
import { formatDate, humanize } from "@/lib/format";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Select, cx } from "@/components/ui";
import { DataTable, Pager } from "@/components/data-table";

/**
 * Super Admin › Administration: user management, audit & activity logs,
 * and school configuration — per the Super Admin responsibility list.
 */

type Tab = "users" | "audit" | "visitors" | "subjects" | "grading" | "settings" | "email";

const TAB_LABELS: Record<Tab, string> = {
  users: "Users",
  audit: "Audit logs",
  visitors: "Visitors",
  subjects: "Subjects",
  grading: "Grading",
  settings: "School settings",
  email: "Email",
};

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("users");
  return (
    <div>
      <PageHeader title="Administration" subtitle="User management, audit trail, grading scale and school configuration (Super Admin)" />
      <div className="mb-6 flex gap-1 rounded-lg bg-slate-100 p-1 text-sm font-medium text-slate-600 w-fit">
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cx("rounded-md px-4 py-1.5 transition-colors", tab === t ? "bg-white text-slate-900 shadow-sm" : "hover:text-slate-800")}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>
      {tab === "users" && <UsersTab />}
      {tab === "audit" && <AuditTab />}
      {tab === "visitors" && <VisitorsTab />}
      {tab === "subjects" && <SubjectsTab />}
      {tab === "grading" && <GradingTab />}
      {tab === "settings" && <SettingsTab />}
      {tab === "email" && <EmailTab />}
    </div>
  );
}

// ============================== subjects ==============================
// The subject catalogue is a Super Admin privilege: subjects are created
// per grade (e.g. Calculus only in Grade 12) or offered school-wide.

interface SubjectRow {
  id: string;
  code: string;
  name: string;
  gradeLevel: string | null;
  description?: string | null;
  _count: { classSubjects: number };
}

function SubjectsTab() {
  const grades = useGrades();
  const [subjects, setSubjects] = useState<SubjectRow[] | null>(null);
  const [form, setForm] = useState({ code: "", name: "", gradeLevel: "", description: "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => get<SubjectRow[]>("/academics/subjects").then(setSubjects), []);
  useEffect(() => {
    void load();
  }, [load]);

  async function createSubject(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await post("/academics/subjects", {
        code: form.code,
        name: form.name,
        gradeLevel: form.gradeLevel || undefined,
        description: form.description || undefined,
      });
      setForm({ code: "", name: "", gradeLevel: "", description: "" });
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to create subject");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <h2 className="border-b border-slate-100 px-6 py-4 text-sm font-semibold text-slate-700">Subject catalogue</h2>
        <DataTable
          loading={!subjects}
          rows={subjects ?? []}
          keyFor={(s) => s.id}
          emptyTitle="No subjects yet"
          columns={[
            { header: "Code", cell: (s) => <span className="font-mono text-xs">{s.code}</span> },
            { header: "Subject", cell: (s) => <span className="font-medium text-slate-900">{s.name}</span> },
            {
              header: "Grade",
              cell: (s) => s.gradeLevel
                ? <Badge tone="brand">{s.gradeLevel === "K" ? "Kindergarten" : `Grade ${s.gradeLevel}`}</Badge>
                : <Badge tone="gray">All grades</Badge>,
            },
            { header: "Assigned to classes", align: "right", cell: (s) => s._count.classSubjects },
          ]}
        />
      </Card>

      <form onSubmit={createSubject}>
        <Card className="space-y-4 p-6">
          <h2 className="text-sm font-semibold text-slate-700">Add a subject</h2>
          <Field label="Code" hint="Short unique code, e.g. CALC">
            <Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} required minLength={2} />
          </Field>
          <Field label="Name">
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required minLength={2} />
          </Field>
          <Field label="Grade level" hint="Grade-specific subjects can only be assigned to classes of that grade">
            <Select value={form.gradeLevel} onChange={(e) => setForm((f) => ({ ...f, gradeLevel: e.target.value }))}>
              <option value="">All grades</option>
              {grades.map((g) => <option key={g.code} value={g.code}>{g.name}</option>)}
            </Select>
          </Field>
          <Field label="Description (optional)">
            <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>
          <ErrorNote message={error} />
          <Button type="submit" loading={saving} className="w-full">Create subject</Button>
        </Card>
      </form>
    </div>
  );
}

// ============================== grading ==============================
// Country-specific grade bands: ≥95 = A+ in one system, ≥90 = A in another.
// Everything that generates a grade (exam entry, report cards) uses this scale.

interface Band { letter: string; minPercent: number; points: number }

function GradingTab() {
  const [bands, setBands] = useState<Band[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    get<Band[]>("/admin/grading").then(setBands).catch((e) => setError(e.message));
  }, []);

  function update(i: number, key: keyof Band, value: string) {
    setBands((bs) =>
      bs?.map((b, idx) => (idx === i ? { ...b, [key]: key === "letter" ? value : Number(value) } : b)) ?? null,
    );
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!bands) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const saved = await put<Band[]>("/admin/grading", { bands });
      setBands(saved);
      setMessage("Grading scale saved — new grades everywhere now use it.");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to save grading scale");
    } finally {
      setSaving(false);
    }
  }

  if (!bands) return error ? <ErrorNote message={error} /> : null;

  return (
    <form onSubmit={save} className="max-w-2xl space-y-4">
      <Card>
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="text-sm font-semibold text-slate-700">Grade bands</h2>
          <p className="mt-1 text-xs text-slate-500">
            A percentage maps to the highest band it reaches. Adjust the thresholds to your country's rules —
            e.g. set A+ at ≥95 and A at ≥90, or remove A+ entirely.
          </p>
        </div>
        <div className="table-scroll">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-6 py-1.5 font-medium">Letter</th>
              <th className="px-3 py-1.5 font-medium">Minimum %</th>
              <th className="px-3 py-1.5 font-medium">GPA points</th>
              <th className="px-3 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {bands.map((b, i) => (
              <tr key={i} className="border-b border-slate-50">
                <td className="px-6 py-1">
                  <Input value={b.letter} onChange={(e) => update(i, "letter", e.target.value)} className="!w-20" maxLength={3} required />
                </td>
                <td className="px-3 py-1">
                  <Input type="number" min={0} max={100} step="0.5" value={b.minPercent} onChange={(e) => update(i, "minPercent", e.target.value)} className="!w-28" required />
                </td>
                <td className="px-3 py-1">
                  <Input type="number" min={0} max={5} step="0.1" value={b.points} onChange={(e) => update(i, "points", e.target.value)} className="!w-28" required />
                </td>
                <td className="px-3 py-1 text-right">
                  <button type="button" className="text-xs text-rose-600 hover:underline"
                    onClick={() => setBands((bs) => bs?.filter((_, idx) => idx !== i) ?? null)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <div className="px-6 py-3">
          <button type="button" className="text-sm font-medium text-brand-600 hover:underline"
            onClick={() => setBands((bs) => [...(bs ?? []), { letter: "", minPercent: 0, points: 0 }])}>
            + Add band
          </button>
        </div>
      </Card>
      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>}
      <ErrorNote message={error} />
      <Button type="submit" loading={saving}>Save grading scale</Button>
    </form>
  );
}

// ============================== users ==============================

interface UserRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  staff?: { staffNo: string; designation: string } | null;
  student?: { admissionNo: string } | null;
  guardian?: { id: string } | null;
}

function UsersTab() {
  const [data, setData] = useState<Paginated<UserRow> | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", firstName: "", lastName: "", role: "ADMIN" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: "15" });
    if (search) params.set("search", search);
    try {
      setData(await get<Paginated<UserRow>>(`/admin/users?${params}`));
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  async function toggleActive(u: UserRow) {
    try {
      await patch(`/admin/users/${u.id}`, { isActive: !u.isActive });
      setNotice(`${u.email} ${u.isActive ? "deactivated — their sessions were revoked" : "re-activated"}.`);
      await load();
    } catch (err) {
      setNotice(err instanceof ApiClientError ? err.message : "Update failed");
    }
  }

  async function resetPassword(u: UserRow) {
    const result = await post<{ temporaryPassword: string }>(`/admin/users/${u.id}/reset-password`);
    setNotice(`Temporary password for ${u.email}: ${result.temporaryPassword} — share it securely.`);
  }

  async function changeRole(u: UserRow, role: string) {
    await patch(`/admin/users/${u.id}`, { role });
    setNotice(`${u.email} is now ${humanize(role)} (existing sessions revoked).`);
    await load();
  }

  async function createUser(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await post("/admin/users", form);
      setShowAdd(false);
      setForm({ email: "", password: "", firstName: "", lastName: "", role: "ADMIN" });
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to create user");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {notice && (
        <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          {notice} <button className="ml-2 underline" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
          <Input placeholder="Search email or name…" className="max-w-xs"
            value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          <Button onClick={() => setShowAdd(true)}>+ Create user</Button>
        </div>
        <DataTable
          loading={loading}
          rows={data?.items ?? []}
          keyFor={(u) => u.id}
          emptyTitle="No users match"
          columns={[
            { header: "Email", cell: (u) => <span className="font-medium text-slate-900">{u.email}</span> },
            { header: "Name", cell: (u) => `${u.firstName} ${u.lastName}` },
            {
              header: "Role",
              cell: (u) => (
                <select
                  className="rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                  value={u.role}
                  onChange={(e) => void changeRole(u, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                >
                  {ROLES.map((r) => <option key={r} value={r}>{humanize(r)}</option>)}
                </select>
              ),
            },
            {
              header: "Linked to",
              cell: (u) =>
                u.staff ? `${u.staff.staffNo} · ${u.staff.designation}`
                : u.guardian ? "Guardian"
                : u.student ? u.student.admissionNo
                : "—",
            },
            { header: "Status", cell: (u) => <Badge tone={u.isActive ? "green" : "red"}>{u.isActive ? "Active" : "Disabled"}</Badge> },
            {
              header: "",
              cell: (u) => (
                <span className="flex gap-2">
                  <button className="text-xs font-medium text-brand-600 hover:underline" onClick={() => void resetPassword(u)}>
                    Reset password
                  </button>
                  <button className={cx("text-xs font-medium hover:underline", u.isActive ? "text-rose-600" : "text-emerald-600")}
                    onClick={() => void toggleActive(u)}>
                    {u.isActive ? "Deactivate" : "Activate"}
                  </button>
                </span>
              ),
            },
          ]}
        />
        {data && <Pager page={data.page} totalPages={data.totalPages} onPage={setPage} />}
      </Card>

      <Modal open={showAdd} title="Create user account" onClose={() => setShowAdd(false)}>
        <form onSubmit={createUser} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name"><Input value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} required /></Field>
            <Field label="Last name"><Input value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} required /></Field>
          </div>
          <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} required /></Field>
          <Field label="Password" hint="Min 8 characters; user should change it on first login">
            <Input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} required minLength={8} />
          </Field>
          <Field label="Role">
            <Select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
              {ROLES.map((r) => <option key={r} value={r}>{humanize(r)}</option>)}
            </Select>
          </Field>
          <ErrorNote message={error} />
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button type="submit" loading={saving}>Create user</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ============================== audit logs ==============================

interface AuditRow {
  id: string;
  userEmail?: string | null;
  role?: string | null;
  method: string;
  path: string;
  action: string;
  status: number;
  createdAt: string;
}

function AuditTab() {
  const [data, setData] = useState<Paginated<AuditRow> | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (search) params.set("search", search);
    try {
      setData(await get<Paginated<AuditRow>>(`/admin/audit-logs?${params}`));
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  return (
    <Card>
      <div className="border-b border-slate-100 p-4">
        <Input placeholder="Filter by action, email or path…" className="max-w-sm"
          value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      </div>
      <DataTable
        loading={loading}
        rows={data?.items ?? []}
        keyFor={(l) => l.id}
        emptyTitle="No activity recorded yet"
        emptyHint="Every create/update/delete call is logged automatically."
        columns={[
          { header: "When", cell: (l) => <span className="whitespace-nowrap text-xs">{new Date(l.createdAt).toLocaleString()}</span> },
          { header: "User", cell: (l) => l.userEmail ?? <span className="text-slate-400">anonymous</span> },
          { header: "Role", cell: (l) => (l.role ? <Badge tone="gray">{l.role}</Badge> : "—") },
          { header: "Action", cell: (l) => <span className="font-mono text-xs">{l.action}</span> },
          { header: "Route", cell: (l) => <span className="font-mono text-xs text-slate-500">{l.method} {l.path}</span> },
          { header: "Status", cell: (l) => <Badge tone={l.status < 400 ? "green" : "red"}>{String(l.status)}</Badge> },
        ]}
      />
      {data && <Pager page={data.page} totalPages={data.totalPages} onPage={setPage} />}
    </Card>
  );
}

// ============================== visitors ==============================
// One row per user per day: who signed in, from which IP/country, and on
// what browser & device (captured from the day's first request).

interface VisitRow {
  id: string;
  date: string;
  role: string;
  ip?: string | null;
  country?: string | null;
  browser?: string | null;
  os?: string | null;
  device?: string | null;
  userAgent?: string | null;
  user: { email: string; firstName: string; lastName: string };
}

function VisitorsTab() {
  const [data, setData] = useState<Paginated<VisitRow> | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [date, setDate] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (search) params.set("search", search);
    if (date) params.set("date", date);
    try {
      setData(await get<Paginated<VisitRow>>(`/admin/visits?${params}`));
    } finally {
      setLoading(false);
    }
  }, [page, search, date]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  return (
    <Card>
      <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
        <Input placeholder="Filter by name or email…" className="max-w-sm"
          value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <Input type="date" className="!w-44"
          value={date} onChange={(e) => { setDate(e.target.value); setPage(1); }} />
      </div>
      <DataTable
        loading={loading}
        rows={data?.items ?? []}
        keyFor={(v) => v.id}
        emptyTitle="No visits recorded yet"
        emptyHint="A row is added the first time each user is active on a given day."
        columns={[
          { header: "Date", cell: (v) => <span className="whitespace-nowrap">{formatDate(v.date)}</span> },
          {
            header: "Visitor",
            cell: (v) => (
              <div>
                <p className="font-medium text-slate-800">{v.user.firstName} {v.user.lastName}</p>
                <p className="text-slate-400">{v.user.email}</p>
              </div>
            ),
          },
          { header: "Role", cell: (v) => <Badge tone="gray">{humanize(v.role)}</Badge> },
          { header: "IP address", cell: (v) => <span className="font-mono text-xs">{v.ip ?? "—"}</span> },
          { header: "Country", cell: (v) => v.country ?? "—" },
          { header: "Browser", cell: (v) => <span title={v.userAgent ?? undefined}>{v.browser ?? "—"}</span> },
          { header: "OS", cell: (v) => v.os ?? "—" },
          { header: "Device", cell: (v) => v.device ?? "—" },
        ]}
      />
      {data && <Pager page={data.page} totalPages={data.totalPages} onPage={setPage} />}
    </Card>
  );
}

// ============================== settings ==============================

interface Settings {
  schoolName: string;
  motto?: string | null;
  logoUrl?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  currency: string;
  timezone: string;
  passwordMinLength: number;
  sessionTimeoutMinutes: number;
  yearlyDiscountPercent: number;
  onlineRegistrationOpen: boolean;
  onlineRegistrationNote?: string | null;
}

function SettingsTab() {
  const [form, setForm] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    get<Settings>("/admin/settings").then(setForm).catch((e) => setError(e.message));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      await put("/admin/settings", {
        ...form,
        motto: form.motto ?? "",
        logoUrl: form.logoUrl ?? "",
        address: form.address ?? "",
        phone: form.phone ?? "",
        email: form.email ?? "",
        onlineRegistrationNote: form.onlineRegistrationNote ?? "",
      });
      setMessage("School settings saved.");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  if (!form) return <ErrorNote message={error} />;

  const set = (key: keyof Settings) => (e: { target: { value: string } }) =>
    setForm((f) => (f ? { ...f, [key]: e.target.value } : f));

  return (
    <form onSubmit={save} className="max-w-2xl space-y-6">
      <Card className="space-y-4 p-6">
        <h2 className="text-sm font-semibold text-slate-700">School profile</h2>
        <Field label="School name"><Input value={form.schoolName} onChange={set("schoolName")} required /></Field>
        <Field label="Motto"><Input value={form.motto ?? ""} onChange={set("motto")} /></Field>
        <Field label="Logo URL"><Input value={form.logoUrl ?? ""} onChange={set("logoUrl")} placeholder="https://…" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone"><Input value={form.phone ?? ""} onChange={set("phone")} /></Field>
          <Field label="Office email"><Input type="email" value={form.email ?? ""} onChange={set("email")} /></Field>
        </div>
        <Field label="Address"><Input value={form.address ?? ""} onChange={set("address")} /></Field>
      </Card>

      <Card className="space-y-4 p-6">
        <h2 className="text-sm font-semibold text-slate-700">Locale & security policies</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Currency (ISO 4217)"><Input value={form.currency} onChange={set("currency")} maxLength={3} required /></Field>
          <Field label="Timezone"><Input value={form.timezone} onChange={set("timezone")} required /></Field>
          <Field label="Minimum password length">
            <Input type="number" min={8} max={64} value={form.passwordMinLength}
              onChange={(e) => setForm((f) => (f ? { ...f, passwordMinLength: Number(e.target.value) } : f))} />
          </Field>
          <Field label="Session timeout (minutes)">
            <Input type="number" min={5} max={720} value={form.sessionTimeoutMinutes}
              onChange={(e) => setForm((f) => (f ? { ...f, sessionTimeoutMinutes: Number(e.target.value) } : f))} />
          </Field>
        </div>
      </Card>

      {/* The admission window. Closing it takes the public form and the
          landing page's "Register" button away in one switch — the school
          controls exactly when families can register their children. */}
      <Card className="space-y-4 p-6">
        <h2 className="text-sm font-semibold text-slate-700">Online registration (admissions)</h2>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-4">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4"
            checked={form.onlineRegistrationOpen}
            onChange={(e) => setForm((f) => (f ? { ...f, onlineRegistrationOpen: e.target.checked } : f))}
          />
          <span>
            <span className="block text-sm font-medium text-slate-800">Allow parents to register their children online</span>
            <span className="mt-0.5 block text-xs text-slate-500">
              While this is on, a “Register” button appears on the public home page and the registration form accepts
              submissions. Every submission lands as a <span className="font-medium">Pending</span> student for the
              registrar or an admin to review — it counts nowhere until its status is changed. Turn this off when the
              registration period is over.
            </span>
          </span>
        </label>
        <div className={cx("flex items-center gap-2 text-xs", form.onlineRegistrationOpen ? "text-emerald-700" : "text-slate-500")}>
          <Badge tone={form.onlineRegistrationOpen ? "green" : "gray"}>
            {form.onlineRegistrationOpen ? "OPEN" : "CLOSED"}
          </Badge>
          {form.onlineRegistrationOpen
            ? "Families can register right now."
            : "The public form turns visitors away and tells them to contact the office."}
        </div>
        <Field
          label="Message shown to families (optional)"
          hint="Displayed on the public form and next to the home page's Register button — deadlines, which documents to have ready, who to call. Shown on the “closed” screen too."
        >
          <textarea
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            rows={3}
            maxLength={1000}
            value={form.onlineRegistrationNote ?? ""}
            onChange={(e) => setForm((f) => (f ? { ...f, onlineRegistrationNote: e.target.value } : f))}
            placeholder="e.g. Registration for the 2026/27 year closes on 30 August. Please have your child's birth certificate ready."
          />
        </Field>
      </Card>

      <Card className="space-y-4 p-6">
        <h2 className="text-sm font-semibold text-slate-700">Payment discounts</h2>
        <Field
          label="Yearly payment discount (%)"
          hint="Applied automatically when the registrar collects a full year's fees at once. Set 0 to disable."
        >
          <Input type="number" min={0} max={100} step="0.5" value={form.yearlyDiscountPercent}
            onChange={(e) => setForm((f) => (f ? { ...f, yearlyDiscountPercent: Number(e.target.value) } : f))} />
        </Field>
      </Card>

      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>}
      <ErrorNote message={error} />
      <Button type="submit" loading={saving}>Save settings</Button>
    </form>
  );
}

// ============================== email ==============================
// Each school runs Vertik12 on its own domain and sends from its own mail
// server, so SMTP is configured here rather than in the deployment's
// environment. Nothing else in the app needs to change: every welcome,
// password-reset, invoice and payslip email starts using it immediately.

interface MailSettings {
  enabled: boolean;
  host: string | null;
  port: number;
  secure: boolean;
  username: string | null;
  fromName: string | null;
  fromEmail: string | null;
  replyTo: string | null;
  hasPassword: boolean;
  effectiveSource: "database" | "environment" | "none";
  problem: string | null;
  dedicatedEncryptionKey: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
}

/** Common providers, so an admin doesn't have to look up host/port. */
const MAIL_PRESETS: Record<string, { host: string; port: number; secure: boolean; hint: string }> = {
  "Google Workspace": { host: "smtp.gmail.com", port: 587, secure: false, hint: "Use a 16-character App Password, not the account password." },
  "Microsoft 365": { host: "smtp.office365.com", port: 587, secure: false, hint: "The mailbox must have SMTP AUTH enabled by your tenant admin." },
  "Zoho Mail": { host: "smtp.zoho.com", port: 465, secure: true, hint: "Generate an app-specific password if 2FA is on." },
  "Amazon SES": { host: "email-smtp.us-east-1.amazonaws.com", port: 587, secure: false, hint: "Use SES SMTP credentials (not your AWS access keys) and verify your domain first." },
  "SendGrid": { host: "smtp.sendgrid.net", port: 587, secure: false, hint: "The username is literally 'apikey'; the password is your API key." },
  "Mailgun": { host: "smtp.mailgun.org", port: 587, secure: false, hint: "Use the SMTP credentials shown under your sending domain." },
};

function EmailTab() {
  const [form, setForm] = useState<MailSettings | null>(null);
  const [password, setPassword] = useState("");
  const [clearPassword, setClearPassword] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () => get<MailSettings>("/admin/mail-settings").then(setForm).catch((e) => setError(e.message)),
    [],
  );
  useEffect(() => { void load(); }, [load]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const saved = await put<MailSettings>("/admin/mail-settings", {
        enabled: form.enabled,
        host: form.host ?? "",
        port: form.port,
        secure: form.secure,
        username: form.username ?? "",
        // Omitted entirely when untouched, so the stored password survives
        // an edit to any other field.
        ...(password ? { password } : {}),
        ...(clearPassword ? { clearPassword: true } : {}),
        fromName: form.fromName ?? "",
        fromEmail: form.fromEmail ?? "",
        replyTo: form.replyTo ?? "",
      });
      setForm(saved);
      setPassword("");
      setClearPassword(false);
      setMessage("Mail server settings saved. New emails will use this server.");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to save mail settings");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    setMessage(null);
    setError(null);
    try {
      const result = await post<{ message: string; host: string }>("/admin/mail-settings/test", { to: testTo });
      setMessage(`${result.message} — check that inbox (and the spam folder) to confirm delivery.`);
      await load(); // refresh the recorded test outcome
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to send the test email");
      await load();
    } finally {
      setTesting(false);
    }
  }

  if (!form) return <ErrorNote message={error} />;

  const set = <K extends keyof MailSettings>(key: K, value: MailSettings[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  function applyPreset(name: string) {
    const preset = MAIL_PRESETS[name];
    if (!preset) return;
    setForm((f) => (f ? { ...f, host: preset.host, port: preset.port, secure: preset.secure } : f));
  }

  const activePreset = Object.entries(MAIL_PRESETS).find(([, p]) => p.host === form.host)?.[0];

  const sourceNote =
    form.effectiveSource === "database"
      ? { tone: "emerald", text: "Emails are being sent through the server configured below." }
      : form.effectiveSource === "environment"
      ? { tone: "amber", text: "Emails are currently sent through the SMTP_* variables set on the server. Configure and enable a mail server below to manage it from here instead." }
      : { tone: "amber", text: "No mail server is configured — emails are only written to the server log, not delivered. Fill in your school's SMTP details below to start sending." };

  return (
    <div className="max-w-2xl space-y-6">
      {/* What is actually in effect right now */}
      <div
        className={cx(
          "rounded-lg border px-4 py-3 text-sm",
          sourceNote.tone === "emerald" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800",
        )}
      >
        {sourceNote.text}
      </div>

      {form.problem && <ErrorNote message={form.problem} />}

      <form onSubmit={save} className="space-y-6">
        <Card className="space-y-4 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-700">Outgoing mail server (SMTP)</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Your school&apos;s own server, so account, invoice and payslip emails come from your domain.
              </p>
            </div>
            <label className="flex shrink-0 items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} />
              Enabled
            </label>
          </div>

          <Field label="Provider" hint="Fills in the host and port — or choose Custom and enter your own.">
            <Select value={activePreset ?? ""} onChange={(e) => applyPreset(e.target.value)}>
              <option value="">Custom / other</option>
              {Object.keys(MAIL_PRESETS).map((name) => <option key={name} value={name}>{name}</option>)}
            </Select>
          </Field>
          {activePreset && (
            <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">{MAIL_PRESETS[activePreset]!.hint}</p>
          )}

          <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
            <Field label="Host">
              <Input value={form.host ?? ""} onChange={(e) => set("host", e.target.value)} placeholder="smtp.yourschool.edu" />
            </Field>
            <Field label="Port">
              <Input
                type="number" min={1} max={65535} value={form.port}
                onChange={(e) => {
                  const port = Number(e.target.value);
                  // 465 is implicit TLS, 587/25 use STARTTLS — keep the
                  // toggle honest so a wrong combination can't be saved by
                  // accident (the commonest SMTP misconfiguration there is).
                  setForm((f) => (f ? { ...f, port, secure: port === 465 } : f));
                }}
              />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={form.secure} onChange={(e) => set("secure", e.target.checked)} />
            Use implicit TLS (SSL) — usually only for port 465
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Username">
              <Input value={form.username ?? ""} onChange={(e) => set("username", e.target.value)} autoComplete="off" />
            </Field>
            <Field
              label="Password"
              hint={form.hasPassword && !password && !clearPassword ? "A password is saved. Leave blank to keep it." : "Stored encrypted; never shown again."}
            >
              <Input
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setClearPassword(false); }}
                placeholder={form.hasPassword ? "••••••••  (unchanged)" : ""}
                autoComplete="new-password"
              />
            </Field>
          </div>
          {form.hasPassword && (
            <label className="flex items-center gap-2 text-xs text-slate-500">
              <input
                type="checkbox"
                checked={clearPassword}
                onChange={(e) => { setClearPassword(e.target.checked); if (e.target.checked) setPassword(""); }}
              />
              Remove the saved password (server needs no authentication)
            </label>
          )}
        </Card>

        <Card className="space-y-4 p-6">
          <h2 className="text-sm font-semibold text-slate-700">Sender identity</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="From name" hint="Shown as the sender">
              <Input value={form.fromName ?? ""} onChange={(e) => set("fromName", e.target.value)} placeholder="St Mary's Academy" />
            </Field>
            <Field label="From address" hint="Must be a mailbox your server may send as">
              <Input type="email" value={form.fromEmail ?? ""} onChange={(e) => set("fromEmail", e.target.value)} placeholder="no-reply@yourschool.edu" />
            </Field>
          </div>
          <Field label="Reply-to" hint="Optional — where replies should go, e.g. the school office">
            <Input type="email" value={form.replyTo ?? ""} onChange={(e) => set("replyTo", e.target.value)} placeholder="office@yourschool.edu" />
          </Field>
        </Card>

        {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>}
        <ErrorNote message={error} />
        <Button type="submit" loading={saving}>Save mail settings</Button>
      </form>

      {/* Proving it works is the whole point — bad SMTP details fail silently otherwise */}
      <Card className="space-y-4 p-6">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">Test delivery</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Connects to the server, authenticates, and sends a real message. Save your settings first.
          </p>
        </div>
        {form.lastTestAt && (
          <div
            className={cx(
              "rounded-lg border px-3 py-2 text-xs",
              form.lastTestOk ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-700",
            )}
          >
            Last test {formatDate(form.lastTestAt)} — {form.lastTestOk ? "delivered successfully" : `failed: ${form.lastTestError}`}
          </div>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <Field label="Send a test email to">
              <Input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@yourschool.edu" />
            </Field>
          </div>
          <Button type="button" variant="secondary" loading={testing} disabled={!testTo} onClick={sendTest}>
            Send test email
          </Button>
        </div>
      </Card>

      {!form.dedicatedEncryptionKey && (
        <p className="text-xs text-slate-500">
          The saved password is encrypted with a key derived from the server&apos;s JWT secret. Set
          <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5">MAIL_ENCRYPTION_KEY</code>
          on the API so rotating JWT secrets does not invalidate it.
        </p>
      )}
    </div>
  );
}
