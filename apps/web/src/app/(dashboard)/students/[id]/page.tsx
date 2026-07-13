"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { GRADE_LEVELS, STUDENT_STATUSES } from "@vertik12/shared";
import { get, post, patch, getSession, ApiClientError } from "@/lib/api";
import { formatDate, formatMoney, fullName, gradeLabel, humanize } from "@/lib/format";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, StatCard } from "@/components/ui";
import { DataTable } from "@/components/data-table";

interface StudentProfile {
  id: string;
  admissionNo: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  gradeLevel: string;
  status: string;
  city?: string | null;
  country?: string | null;
  nationality?: string | null;
  attendanceRate: number | null;
  // null when the viewer's role may not see this data (teacher ⇒ no finance,
  // accountant ⇒ no results) — the API strips it server-side.
  financeSummary: { invoiced: number; paid: number; outstanding: number } | null;
  phone?: string | null;
  email?: string | null;
  addressLine1?: string | null;
  medicalNotes?: string | null;
  guardians: Array<{ relation: string; isPrimary: boolean; guardian: { id: string; firstName: string; lastName: string; phone: string; email?: string | null; userId?: string | null } }>;
  enrollments: Array<{ id: string; classRoom: { name: string }; academicYear: { name: string }; status: string }>;
  invoices: Array<{ id: string; number: string; status: string; dueDate: string; items: Array<{ amount: number }> }> | null;
  examResults: Array<{ id: string; marks: number; maxMarks: number; grade: string; subject: { name: string }; exam: { name: string; term: { name: string } } }> | null;
}

export default function StudentProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [student, setStudent] = useState<StudentProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [portalFor, setPortalFor] = useState<StudentProfile["guardians"][number] | null>(null);
  const [guardianModal, setGuardianModal] = useState<
    { mode: "add" } | { mode: "edit"; link: StudentProfile["guardians"][number] } | null
  >(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canManage = ["SUPER_ADMIN", "ADMIN", "REGISTRAR"].includes(getSession()?.user.role ?? "");

  const load = useCallback(
    () => get<StudentProfile>(`/students/${id}`).then(setStudent).catch((e) => setError(e.message)),
    [id],
  );
  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="text-sm text-rose-600">{error}</p>;
  if (!student)
    return (
      <div className="flex justify-center py-24 text-brand-600">
        <Spinner />
      </div>
    );

  return (
    <div>
      <PageHeader
        title={fullName(student)}
        subtitle={`${student.admissionNo} · ${gradeLabel(student.gradeLevel)} · ${student.enrollments[0]?.classRoom.name ?? "No class"}`}
        actions={
          <div className="flex items-center gap-3">
            {canManage && <Button variant="secondary" onClick={() => setShowEdit(true)}>Edit student</Button>}
            <Link href={`/students/${student.id}/report-card`}>
              <Button variant="secondary">Report card</Button>
            </Link>
            <Badge>{student.status}</Badge>
          </div>
        }
      />

      {notice && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {notice} <button className="ml-2 underline" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Attendance rate" value={student.attendanceRate === null ? "—" : `${student.attendanceRate}%`} />
        {student.financeSummary && (
          <>
            <StatCard label="Total invoiced" value={formatMoney(student.financeSummary.invoiced)} />
            <StatCard label="Total paid" value={formatMoney(student.financeSummary.paid)} />
            <StatCard label="Outstanding" value={formatMoney(student.financeSummary.outstanding)} />
          </>
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Finance data is absent for teachers (not their responsibility). */}
          {student.invoices && (
            <Card>
              <h2 className="border-b border-slate-100 px-6 py-4 text-sm font-semibold text-slate-700">Invoices</h2>
              <DataTable
                rows={student.invoices}
                keyFor={(i) => i.id}
                emptyTitle="No invoices"
                columns={[
                  { header: "Number", cell: (i) => <span className="font-mono text-xs">{i.number}</span> },
                  { header: "Due", cell: (i) => formatDate(i.dueDate) },
                  { header: "Amount", align: "right", cell: (i) => formatMoney(i.items.reduce((s, it) => s + it.amount, 0)) },
                  { header: "Status", cell: (i) => <Badge>{i.status}</Badge> },
                ]}
              />
            </Card>
          )}

          {/* Exam results are absent for accountants (not their responsibility). */}
          {student.examResults && (
            <Card>
              <h2 className="border-b border-slate-100 px-6 py-4 text-sm font-semibold text-slate-700">Recent exam results</h2>
              <DataTable
                rows={student.examResults}
                keyFor={(r) => r.id}
                emptyTitle="No results recorded"
                columns={[
                  { header: "Subject", cell: (r) => r.subject.name },
                  { header: "Exam", cell: (r) => `${r.exam.name} (${r.exam.term.name})` },
                  { header: "Marks", align: "right", cell: (r) => `${r.marks}/${r.maxMarks}` },
                  { header: "Grade", cell: (r) => <Badge tone="brand">{r.grade}</Badge> },
                ]}
              />
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="mb-4 text-sm font-semibold text-slate-700">Personal</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Date of birth</dt><dd>{formatDate(student.dateOfBirth)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Gender</dt><dd className="capitalize">{student.gender.toLowerCase()}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Nationality</dt><dd>{student.nationality ?? "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Location</dt><dd>{[student.city, student.country].filter(Boolean).join(", ") || "—"}</dd></div>
            </dl>
          </Card>

          <Card className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">Guardians & parent portal</h2>
              {canManage && (
                <button className="text-xs font-medium text-brand-600 hover:underline" onClick={() => setGuardianModal({ mode: "add" })}>
                  + Add guardian
                </button>
              )}
            </div>
            <ul className="space-y-4">
              {student.guardians.map((g, i) => (
                <li key={i} className="text-sm">
                  <p className="font-medium text-slate-800">
                    {g.guardian.firstName} {g.guardian.lastName}{" "}
                    {g.isPrimary && <Badge tone="brand">Primary</Badge>}
                  </p>
                  <p className="text-xs text-slate-500">{g.relation} · {g.guardian.phone}</p>
                  {g.guardian.email && <p className="text-xs text-slate-400">{g.guardian.email}</p>}
                  <p className="mt-1 flex items-center gap-3">
                    {g.guardian.userId ? (
                      <Badge tone="green">Portal access active</Badge>
                    ) : canManage ? (
                      <button className="text-xs font-medium text-brand-600 hover:underline" onClick={() => setPortalFor(g)}>
                        Register parent portal account
                      </button>
                    ) : (
                      <Badge tone="gray">No portal access</Badge>
                    )}
                    {canManage && (
                      <button className="text-xs font-medium text-slate-500 hover:underline" onClick={() => setGuardianModal({ mode: "edit", link: g })}>
                        Edit
                      </button>
                    )}
                  </p>
                </li>
              ))}
              {student.guardians.length === 0 && <p className="text-sm text-slate-400">None on record.</p>}
            </ul>
          </Card>

          <Card className="p-6">
            <h2 className="mb-4 text-sm font-semibold text-slate-700">Enrolment history</h2>
            <ul className="space-y-3">
              {student.enrollments.map((e) => (
                <li key={e.id} className="flex items-center justify-between text-sm">
                  <span>{e.classRoom.name} <span className="text-xs text-slate-400">({e.academicYear.name})</span></span>
                  <Badge>{e.status}</Badge>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      {showEdit && (
        <EditStudentModal
          student={student}
          onClose={() => setShowEdit(false)}
          onSaved={async () => {
            setShowEdit(false);
            setNotice("Student record updated.");
            await load();
          }}
        />
      )}
      {guardianModal && (
        <GuardianModal
          studentId={student.id}
          link={guardianModal.mode === "edit" ? guardianModal.link : null}
          onClose={() => setGuardianModal(null)}
          onSaved={async () => {
            setGuardianModal(null);
            setNotice("Guardian saved.");
            await load();
          }}
        />
      )}
      {portalFor && (
        <PortalAccountModal
          studentId={student.id}
          link={portalFor}
          onClose={() => setPortalFor(null)}
          onCreated={async (email, tempPassword) => {
            setPortalFor(null);
            setNotice(`Parent portal account created for ${email}. Temporary password: ${tempPassword} — share it securely; they sign in at the same address and see only their own children.`);
            await load();
          }}
        />
      )}
    </div>
  );
}

/** Admin/Registrar: modify the student's information. */
function EditStudentModal({ student, onClose, onSaved }: {
  student: StudentProfile;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    firstName: student.firstName,
    lastName: student.lastName,
    gradeLevel: student.gradeLevel,
    status: student.status,
    phone: student.phone ?? "",
    email: student.email ?? "",
    addressLine1: student.addressLine1 ?? "",
    city: student.city ?? "",
    country: student.country ?? "",
    nationality: student.nationality ?? "",
    medicalNotes: student.medicalNotes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await patch(`/students/${student.id}`, {
        ...form,
        phone: form.phone || undefined,
        email: form.email || undefined,
        addressLine1: form.addressLine1 || undefined,
        city: form.city || undefined,
        country: form.country || undefined,
        nationality: form.nationality || undefined,
        medicalNotes: form.medicalNotes || undefined,
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to save");
      setSaving(false);
    }
  }

  return (
    <Modal open title={`Edit — ${fullName(student)}`} onClose={onClose} wide>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name"><Input value={form.firstName} onChange={set("firstName")} required /></Field>
          <Field label="Last name"><Input value={form.lastName} onChange={set("lastName")} required /></Field>
          <Field label="Grade level">
            <Select value={form.gradeLevel} onChange={set("gradeLevel")}>
              {GRADE_LEVELS.map((g) => <option key={g} value={g}>{gradeLabel(g)}</option>)}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={set("status")}>
              {STUDENT_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
            </Select>
          </Field>
          <Field label="Phone"><Input value={form.phone} onChange={set("phone")} /></Field>
          <Field label="Email"><Input type="email" value={form.email} onChange={set("email")} /></Field>
          <Field label="Address"><Input value={form.addressLine1} onChange={set("addressLine1")} /></Field>
          <Field label="City"><Input value={form.city} onChange={set("city")} /></Field>
          <Field label="Country"><Input value={form.country} onChange={set("country")} /></Field>
          <Field label="Nationality"><Input value={form.nationality} onChange={set("nationality")} /></Field>
        </div>
        <Field label="Medical notes">
          <textarea
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            rows={2}
            value={form.medicalNotes}
            onChange={(e) => setForm((f) => ({ ...f, medicalNotes: e.target.value }))}
          />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>Save changes</Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Add a guardian, or edit one — including the login email, which stays in
 * sync with their portal account if they already have one.
 */
function GuardianModal({ studentId, link, onClose, onSaved }: {
  studentId: string;
  link: StudentProfile["guardians"][number] | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    firstName: link?.guardian.firstName ?? "",
    lastName: link?.guardian.lastName ?? "",
    relation: link?.relation ?? "Mother",
    phone: link?.guardian.phone ?? "",
    email: link?.guardian.email ?? "",
    isPrimary: link?.isPrimary ?? false,
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload = { ...form, email: form.email || undefined };
    try {
      if (link) await patch(`/students/${studentId}/guardians/${link.guardian.id}`, payload);
      else await post(`/students/${studentId}/guardians`, payload);
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to save guardian");
      setSaving(false);
    }
  }

  return (
    <Modal open title={link ? `Edit guardian — ${link.guardian.firstName}` : "Add a guardian"} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="First name"><Input value={form.firstName} onChange={set("firstName")} required /></Field>
          <Field label="Last name"><Input value={form.lastName} onChange={set("lastName")} required /></Field>
          <Field label="Relation">
            <Select value={form.relation} onChange={set("relation")}>
              {["Mother", "Father", "Guardian", "Grandparent", "Other"].map((r) => <option key={r}>{r}</option>)}
            </Select>
          </Field>
          <Field label="Phone"><Input value={form.phone} onChange={set("phone")} required /></Field>
        </div>
        <Field
          label="Email (login email)"
          hint={link?.guardian.userId ? "Changing this also changes their portal sign-in email" : "Used when registering their portal account"}
        >
          <Input type="email" value={form.email} onChange={set("email")} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={form.isPrimary}
            onChange={(e) => setForm((f) => ({ ...f, isPrimary: e.target.checked }))} />
          Primary contact
        </label>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>{link ? "Save changes" : "Add guardian"}</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Registrar: turn a guardian record into a parent portal login. */
function PortalAccountModal({ studentId, link, onClose, onCreated }: {
  studentId: string;
  link: StudentProfile["guardians"][number];
  onClose: () => void;
  onCreated: (email: string, tempPassword: string) => Promise<void>;
}) {
  const [email, setEmail] = useState(link.guardian.email ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await post<{ email: string; temporaryPassword: string }>(
        `/students/${studentId}/guardians/${link.guardian.id}/portal-account`,
        { email },
      );
      await onCreated(result.email, result.temporaryPassword);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to create account");
      setSaving(false);
    }
  }

  return (
    <Modal open title={`Parent portal — ${link.guardian.firstName} ${link.guardian.lastName}`} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <p className="text-sm text-slate-600">
          Creates the web-portal login for this {link.relation.toLowerCase()}. Once registered, they can sign in and
          see <strong>only their own children's</strong> grades, attendance, assignments and fees.
        </p>
        <Field label="Login email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>Create portal account</Button>
        </div>
      </form>
    </Modal>
  );
}
