"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Paginated } from "@vertik12/shared";
import { STAFF_TYPES, STAFF_STATUSES } from "@vertik12/shared";
import { get, post, put, del, getSession, ApiClientError } from "@/lib/api";
import { formatMoney, gradeLabel, humanize } from "@/lib/format";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner } from "@/components/ui";
import { DataTable, Pager } from "@/components/data-table";

interface StaffRow {
  id: string;
  staffNo: string;
  designation: string;
  department?: string | null;
  staffType: string;
  status: string;
  user: { firstName: string; lastName: string; email: string; role: string; isActive?: boolean };
  salaryStructure?: { basicSalary: number; currency: string; payFrequency?: string } | null;
}

const emptyForm = {
  firstName: "", lastName: "", email: "", role: "TEACHER", staffType: "TEACHING",
  designation: "", department: "", phone: "", joinDate: "",
};

/**
 * HR status management: the admin moves an employee between Active,
 * On leave, Terminated and Resigned. Portal access follows automatically —
 * termination/resignation revokes the login, re-activating restores it.
 */
function StaffStatusModal({ staff, onClose, onSaved }: {
  staff: StaffRow;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [status, setStatus] = useState(staff.status);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const hint =
    status === "TERMINATED" || status === "RESIGNED"
      ? "Their portal login is revoked and open sessions are signed out immediately."
      : status === "ACTIVE" && staff.status !== "ACTIVE"
        ? "Their portal login is restored."
        : status === "ON_LEAVE"
          ? "Employment continues — portal access is unchanged."
          : undefined;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await post(`/staff/${staff.id}/status`, { status });
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to update the status");
      setSaving(false);
    }
  }

  return (
    <Modal open title={`Employment status — ${staff.user.firstName} ${staff.user.lastName}`} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <p className="text-sm text-slate-500">
          {staff.staffNo} · {staff.designation} · currently <Badge>{staff.status}</Badge>
        </p>
        <Field label="New status" hint={hint}>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STAFF_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </Select>
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving} disabled={status === staff.status}>Save status</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function StaffPage() {
  const [data, setData] = useState<Paginated<StaffRow> | null>(null);
  const [page, setPage] = useState(1);
  // HR search & filters (name/email/staff no/designation/department + dropdowns).
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<StaffRow | null>(null);
  const [salaryFor, setSalaryFor] = useState<StaffRow | null>(null);
  const [statusFor, setStatusFor] = useState<StaffRow | null>(null);
  const isAdmin = ["SUPER_ADMIN", "ADMIN"].includes(getSession()?.user.role ?? "");

  async function toggleAccess(s: StaffRow) {
    try {
      await post(`/staff/${s.id}/access`, { isActive: !(s.user.isActive ?? true) });
      setTempPassword(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to change access");
    }
  }

  const set = (key: keyof typeof emptyForm) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (search) params.set("search", search);
    if (typeFilter) params.set("staffType", typeFilter);
    if (statusFilter) params.set("status", statusFilter);
    if (roleFilter) params.set("role", roleFilter);
    try {
      setData(await get<Paginated<StaffRow>>(`/staff?${params}`));
    } finally {
      setLoading(false);
    }
  }, [page, search, typeFilter, statusFilter, roleFilter]);

  useEffect(() => {
    // Debounce so typing in the search box doesn't fire a request per key.
    const t = setTimeout(() => void load(), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const result = await post<{ staff: StaffRow; temporaryPassword?: string }>("/staff", {
        ...form,
        department: form.department || undefined,
        phone: form.phone || undefined,
      });
      setTempPassword(result.temporaryPassword ?? null);
      setShowAdd(false);
      setForm(emptyForm);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to create staff member");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Staff & HR"
        subtitle={data ? `${data.total} employee(s)` : undefined}
        actions={
          // Only the admin hires staff; the accountant's view is read-only.
          ["SUPER_ADMIN", "ADMIN"].includes(getSession()?.user.role ?? "") ? (
            <Button onClick={() => setShowAdd(true)}>+ Add staff</Button>
          ) : undefined
        }
      />

      {tempPassword && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Staff account created. Temporary password: <code className="font-mono font-semibold">{tempPassword}</code>{" "}
          — share it securely; they should change it on first login.
          <button className="ml-3 underline" onClick={() => setTempPassword(null)}>Dismiss</button>
        </div>
      )}

      <Card>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <Input
            placeholder="Search name, email, staff no, designation, department…"
            className="max-w-xs"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
          <Select className="max-w-[170px]" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}>
            <option value="">All types</option>
            {STAFF_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
          </Select>
          <Select className="max-w-[170px]" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            {STAFF_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </Select>
          <Select className="max-w-[170px]" value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}>
            <option value="">All roles</option>
            {["ADMIN", "REGISTRAR", "TEACHER", "ACCOUNTANT"].map((r) => <option key={r} value={r}>{humanize(r)}</option>)}
          </Select>
        </div>
        <DataTable
          loading={loading}
          rows={data?.items ?? []}
          keyFor={(s) => s.id}
          emptyTitle="No staff match these filters"
          columns={[
            { header: "Staff No", cell: (s) => <span className="font-mono text-xs">{s.staffNo}</span> },
            { header: "Name", cell: (s) => <span className="font-medium text-slate-900">{s.user.firstName} {s.user.lastName}</span> },
            { header: "Designation", cell: (s) => s.designation },
            { header: "Department", cell: (s) => s.department ?? "—" },
            { header: "Type", cell: (s) => humanize(s.staffType) },
            { header: "Role", cell: (s) => <Badge tone="gray">{s.user.role}</Badge> },
            {
              header: "Monthly salary", align: "right",
              cell: (s) => (s.salaryStructure ? formatMoney(s.salaryStructure.basicSalary, s.salaryStructure.currency) : <span className="text-slate-400">not set</span>),
            },
            { header: "Status", cell: (s) => <Badge>{s.status}</Badge> },
            {
              header: "",
              cell: (s) =>
                isAdmin ? (
                  <span className="flex flex-wrap gap-2">
                    {/* Employment status is manageable in every state (re-hire too). */}
                    <button
                      className="text-xs font-medium text-brand-600 hover:underline"
                      onClick={(e) => { e.stopPropagation(); setStatusFor(s); }}
                    >
                      Status
                    </button>
                    {s.status === "ACTIVE" && (
                      <>
                        {s.staffType === "TEACHING" && (
                          <button
                            className="text-xs font-medium text-brand-600 hover:underline"
                            onClick={(e) => { e.stopPropagation(); setAssigning(s); }}
                          >
                            Assign subjects
                          </button>
                        )}
                        <button
                          className="text-xs font-medium text-brand-600 hover:underline"
                          onClick={(e) => { e.stopPropagation(); setSalaryFor(s); }}
                        >
                          Set salary
                        </button>
                        {/* Registrar access can only be revoked by the Super Admin. */}
                        <button
                          className={`text-xs font-medium hover:underline ${(s.user.isActive ?? true) ? "text-rose-600" : "text-emerald-600"}`}
                          onClick={(e) => { e.stopPropagation(); void toggleAccess(s); }}
                        >
                          {(s.user.isActive ?? true) ? "Revoke access" : "Grant access"}
                        </button>
                      </>
                    )}
                  </span>
                ) : null,
            },
          ]}
        />
        {data && <Pager page={data.page} totalPages={data.totalPages} onPage={setPage} />}
      </Card>

      <ErrorNote message={error} />
      {statusFor && (
        <StaffStatusModal
          staff={statusFor}
          onClose={() => setStatusFor(null)}
          onSaved={async () => {
            setStatusFor(null);
            await load();
          }}
        />
      )}
      {assigning && <AssignSubjectsModal teacher={assigning} onClose={() => setAssigning(null)} />}
      {salaryFor && (
        <SalaryModal
          staff={salaryFor}
          onClose={() => setSalaryFor(null)}
          onSaved={async () => {
            setSalaryFor(null);
            await load();
          }}
        />
      )}

      <AddStaffModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        form={form}
        set={set}
        onSubmit={onSubmit}
        error={error}
        saving={saving}
      />
    </div>
  );
}

// ============ admin: salary & payment setup for one staff member ============

/**
 * Admin sets the pay: basic salary per period (monthly or biweekly), plus
 * standard allowance/deduction components. Payroll runs snapshot these.
 */
function SalaryModal({ staff, onClose, onSaved }: {
  staff: StaffRow;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    basicSalary: staff.salaryStructure ? String(staff.salaryStructure.basicSalary / 100) : "",
    payFrequency: staff.salaryStructure?.payFrequency ?? "MONTHLY",
    housing: "", transport: "", tax: "", pension: "",
  });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Load existing components so editing doesn't wipe them.
  useEffect(() => {
    get<Array<{ staffId: string; basicSalary: number; payFrequency: string; allowances: string; deductions: string }>>("/payroll/salaries")
      .then((all) => {
        const mine = all.find((s) => s.staffId === staff.id);
        if (mine) {
          const allowances = JSON.parse(mine.allowances) as Array<{ name: string; amount: number }>;
          const deductions = JSON.parse(mine.deductions) as Array<{ name: string; amount: number }>;
          const find = (list: typeof allowances, name: string) => {
            const item = list.find((c) => c.name.toLowerCase().includes(name));
            return item ? String(item.amount / 100) : "";
          };
          setForm({
            basicSalary: String(mine.basicSalary / 100),
            payFrequency: mine.payFrequency,
            housing: find(allowances, "housing"),
            transport: find(allowances, "transport"),
            tax: find(deductions, "tax"),
            pension: find(deductions, "pension"),
          });
        }
      })
      .finally(() => setLoaded(true));
  }, [staff.id]);

  const cents = (v: string) => Math.round(parseFloat(v || "0") * 100);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await put("/payroll/salaries", {
        staffId: staff.id,
        basicSalary: cents(form.basicSalary),
        payFrequency: form.payFrequency,
        allowances: [
          ...(cents(form.housing) > 0 ? [{ name: "Housing Allowance", amount: cents(form.housing) }] : []),
          ...(cents(form.transport) > 0 ? [{ name: "Transport Allowance", amount: cents(form.transport) }] : []),
        ],
        deductions: [
          ...(cents(form.tax) > 0 ? [{ name: "Income Tax", amount: cents(form.tax) }] : []),
          ...(cents(form.pension) > 0 ? [{ name: "Pension", amount: cents(form.pension) }] : []),
        ],
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to save salary");
      setSaving(false);
    }
  }

  return (
    <Modal open title={`Salary — ${staff.user.firstName} ${staff.user.lastName}`} onClose={onClose}>
      {!loaded ? (
        <div className="flex justify-center py-10 text-brand-600"><Spinner /></div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Basic salary (USD, per period)">
              <Input type="number" step="0.01" min="0" value={form.basicSalary}
                onChange={(e) => setForm((f) => ({ ...f, basicSalary: e.target.value }))} required />
            </Field>
            <Field label="Payment frequency">
              <Select value={form.payFrequency} onChange={(e) => setForm((f) => ({ ...f, payFrequency: e.target.value }))}>
                <option value="MONTHLY">Monthly</option>
                <option value="BIWEEKLY">Biweekly</option>
              </Select>
            </Field>
            <Field label="Housing allowance">
              <Input type="number" step="0.01" min="0" value={form.housing} onChange={(e) => setForm((f) => ({ ...f, housing: e.target.value }))} />
            </Field>
            <Field label="Transport allowance">
              <Input type="number" step="0.01" min="0" value={form.transport} onChange={(e) => setForm((f) => ({ ...f, transport: e.target.value }))} />
            </Field>
            <Field label="Income tax (deduction)">
              <Input type="number" step="0.01" min="0" value={form.tax} onChange={(e) => setForm((f) => ({ ...f, tax: e.target.value }))} />
            </Field>
            <Field label="Pension (deduction)">
              <Input type="number" step="0.01" min="0" value={form.pension} onChange={(e) => setForm((f) => ({ ...f, pension: e.target.value }))} />
            </Field>
          </div>
          <ErrorNote message={error} />
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={saving}>Save salary</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ============ admin: assign subjects & classes to one teacher ============

interface TeachingRow {
  id: string;
  subject: { id: string; name: string; code: string };
  classRoom: { id: string; name: string; gradeLevel: string; _count: { enrollments: number } };
}
interface ClassOption { id: string; name: string; gradeLevel: string }
interface SubjectOption { id: string; name: string; code: string; gradeLevel: string | null }

/**
 * Teacher-centric assignment: everything this teacher teaches, in one
 * place. Adding picks a class, then a subject valid for that class's
 * grade; the same mapping powers their gradebook and assignments.
 */
function AssignSubjectsModal({ teacher, onClose }: { teacher: StaffRow; onClose: () => void }) {
  const [rows, setRows] = useState<TeachingRow[] | null>(null);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [classRoomId, setClassRoomId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () => get<TeachingRow[]>(`/academics/teachers/${teacher.id}/subjects`).then(setRows),
    [teacher.id],
  );

  useEffect(() => {
    void load();
    get<ClassOption[]>("/academics/classes").then(setClasses);
    get<SubjectOption[]>("/academics/subjects").then(setSubjects);
  }, [load]);

  const selectedClass = classes.find((c) => c.id === classRoomId) ?? null;
  // Only subjects valid for the chosen class's grade (grade-scoped or school-wide),
  // excluding ones this teacher already has in that class.
  const eligibleSubjects = selectedClass
    ? subjects.filter(
        (s) =>
          (!s.gradeLevel || s.gradeLevel === selectedClass.gradeLevel) &&
          !rows?.some((r) => r.classRoom.id === classRoomId && r.subject.id === s.id),
      )
    : [];

  async function assign() {
    if (!classRoomId || !subjectId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await post("/academics/class-subjects", { classRoomId, subjectId, teacherId: teacher.id });
      setSubjectId("");
      setNotice("Subject assigned — it now appears in this teacher's gradebook.");
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Assignment failed");
    } finally {
      setBusy(false);
    }
  }

  /** Keeps the subject in the class, just removes this teacher from it. */
  async function unassign(row: TeachingRow) {
    setBusy(true);
    setError(null);
    try {
      await post("/academics/class-subjects", { classRoomId: row.classRoom.id, subjectId: row.subject.id });
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to unassign");
    } finally {
      setBusy(false);
    }
  }

  /** Removes the subject from the class entirely (blocked once results exist). */
  async function removeFromClass(row: TeachingRow) {
    setBusy(true);
    setError(null);
    try {
      await del(`/academics/class-subjects/${row.id}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to remove");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={`Teaching assignments — ${teacher.user.firstName} ${teacher.user.lastName}`} onClose={onClose} wide>
      {!rows ? (
        <div className="flex justify-center py-10 text-brand-600"><Spinner /></div>
      ) : (
        <div className="space-y-5">
          {notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">{notice}</div>}
          <ErrorNote message={error} />

          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">{r.subject.name}</p>
                  <p className="text-xs text-slate-400">
                    {r.classRoom.name} · {gradeLabel(r.classRoom.gradeLevel)} · {r.classRoom._count.enrollments} students
                  </p>
                </div>
                <span className="flex gap-3">
                  <button className="text-xs font-medium text-amber-600 hover:underline" disabled={busy}
                    onClick={() => void unassign(r)} title="Subject stays in the class without a teacher">
                    Unassign teacher
                  </button>
                  <button className="text-xs font-medium text-rose-600 hover:underline" disabled={busy}
                    onClick={() => void removeFromClass(r)} title="Removes the subject from the class (blocked if results exist)">
                    Remove from class
                  </button>
                </span>
              </li>
            ))}
            {rows.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-slate-400">
                No subjects assigned yet — add the first one below.
              </li>
            )}
          </ul>

          <div className="flex flex-wrap items-end gap-3 rounded-lg bg-slate-50 p-4">
            <Field label="Class">
              <Select value={classRoomId} onChange={(e) => { setClassRoomId(e.target.value); setSubjectId(""); }} className="!w-56">
                <option value="">Choose a class…</option>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Subject" hint={selectedClass ? `Valid for ${gradeLabel(selectedClass.gradeLevel)}` : "Pick a class first"}>
              <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="!w-64" disabled={!classRoomId}>
                <option value="">Choose a subject…</option>
                {eligibleSubjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.gradeLevel ? `(Grade ${s.gradeLevel})` : "(All grades)"}
                  </option>
                ))}
              </Select>
            </Field>
            <Button disabled={!classRoomId || !subjectId || busy} loading={busy} onClick={() => void assign()}>
              Assign to {teacher.user.firstName}
            </Button>
          </div>
          <p className="text-xs text-slate-400">
            If the subject is already taught in that class by someone else, assigning it here transfers it to this teacher.
            Assignments drive the gradebook: only the assigned teacher can grade that subject and send results to the registrar.
          </p>
        </div>
      )}
    </Modal>
  );
}

function AddStaffModal({ open, onClose, form, set, onSubmit, error, saving }: {
  open: boolean;
  onClose: () => void;
  form: typeof emptyForm;
  set: (key: keyof typeof emptyForm) => (e: { target: { value: string } }) => void;
  onSubmit: (e: FormEvent) => void;
  error: string | null;
  saving: boolean;
}) {
  return (
      <Modal open={open} title="Add staff member" onClose={onClose} wide>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name"><Input value={form.firstName} onChange={set("firstName")} required /></Field>
            <Field label="Last name"><Input value={form.lastName} onChange={set("lastName")} required /></Field>
            <Field label="Email (login)"><Input type="email" value={form.email} onChange={set("email")} required /></Field>
            <Field label="Portal role">
              <Select value={form.role} onChange={set("role")}>
                <option value="TEACHER">Teacher</option>
                <option value="ADMIN">Admin</option>
                <option value="REGISTRAR">Registrar</option>
                <option value="ACCOUNTANT">Accountant</option>
              </Select>
            </Field>
            <Field label="Staff type">
              <Select value={form.staffType} onChange={set("staffType")}>
                {STAFF_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
              </Select>
            </Field>
            <Field label="Designation"><Input value={form.designation} onChange={set("designation")} placeholder="e.g. Mathematics Teacher" required /></Field>
            <Field label="Department"><Input value={form.department} onChange={set("department")} /></Field>
            <Field label="Phone"><Input value={form.phone} onChange={set("phone")} /></Field>
            <Field label="Join date"><Input type="date" value={form.joinDate} onChange={set("joinDate")} required /></Field>
          </div>
          <ErrorNote message={error} />
          <p className="text-xs text-slate-500">A login account is created automatically with a generated temporary password.</p>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={saving}>Create staff</Button>
          </div>
        </form>
      </Modal>
  );
}
