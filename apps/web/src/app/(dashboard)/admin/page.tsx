"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Paginated } from "@vertik12/shared";
import { GRADE_LEVELS, ROLES } from "@vertik12/shared";
import { get, post, patch, put, ApiClientError } from "@/lib/api";
import { formatDate, humanize } from "@/lib/format";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Select, cx } from "@/components/ui";
import { DataTable, Pager } from "@/components/data-table";

/**
 * Super Admin › Administration: user management, audit & activity logs,
 * and school configuration — per the Super Admin responsibility list.
 */

type Tab = "users" | "audit" | "subjects" | "grading" | "settings";

const TAB_LABELS: Record<Tab, string> = {
  users: "Users",
  audit: "Audit logs",
  subjects: "Subjects",
  grading: "Grading",
  settings: "School settings",
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
      {tab === "subjects" && <SubjectsTab />}
      {tab === "grading" && <GradingTab />}
      {tab === "settings" && <SettingsTab />}
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
              {GRADE_LEVELS.map((g) => <option key={g} value={g}>{g === "K" ? "Kindergarten" : `Grade ${g}`}</option>)}
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
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-6 py-2 font-medium">Letter</th>
              <th className="px-4 py-2 font-medium">Minimum %</th>
              <th className="px-4 py-2 font-medium">GPA points</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {bands.map((b, i) => (
              <tr key={i} className="border-b border-slate-50">
                <td className="px-6 py-1.5">
                  <Input value={b.letter} onChange={(e) => update(i, "letter", e.target.value)} className="!w-20" maxLength={3} required />
                </td>
                <td className="px-4 py-1.5">
                  <Input type="number" min={0} max={100} step="0.5" value={b.minPercent} onChange={(e) => update(i, "minPercent", e.target.value)} className="!w-28" required />
                </td>
                <td className="px-4 py-1.5">
                  <Input type="number" min={0} max={5} step="0.1" value={b.points} onChange={(e) => update(i, "points", e.target.value)} className="!w-28" required />
                </td>
                <td className="px-4 py-1.5 text-right">
                  <button type="button" className="text-xs text-rose-600 hover:underline"
                    onClick={() => setBands((bs) => bs?.filter((_, idx) => idx !== i) ?? null)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
