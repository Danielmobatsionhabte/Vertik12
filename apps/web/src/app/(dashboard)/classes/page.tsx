"use client";

import { useCallback, useEffect, useState } from "react";
import { get, post, patch, del, getSession, ApiClientError } from "@/lib/api";
import { formatDate, gradeLabel, localDateIso } from "@/lib/format";
import { GRADE_LEVELS } from "@vertik12/shared";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner } from "@/components/ui";
import { Pager } from "@/components/data-table";
import type { FormEvent } from "react";

interface ClassRow {
  id: string;
  name: string;
  gradeLevel: string;
  section: string;
  branch?: string | null;
  capacity: number;
  academicYear: { name: string };
  homeroomTeacher?: { id: string; user: { firstName: string; lastName: string } } | null;
  _count: { enrollments: number };
}

export default function ClassesPage() {
  const [classes, setClasses] = useState<ClassRow[] | null>(null);
  const [managing, setManaging] = useState<ClassRow | null>(null);
  const [editing, setEditing] = useState<ClassRow | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showYears, setShowYears] = useState(false);
  // Client-side paging + grade filter keep the card grid usable when the
  // school has dozens of sections.
  const [page, setPage] = useState(1);
  const [gradeFilter, setGradeFilter] = useState("");
  const PER_PAGE = 12;

  // Assigning teachers to grades/subjects and creating classes is an admin responsibility.
  const role = getSession()?.user.role ?? "";
  const canAssign = ["SUPER_ADMIN", "ADMIN"].includes(role);
  const canEdit = ["SUPER_ADMIN", "ADMIN", "REGISTRAR"].includes(role); // homeroom; rename = super admin

  const load = useCallback(() => get<ClassRow[]>("/academics/classes").then(setClasses).catch(() => setClasses([])), []);
  useEffect(() => {
    void load();
  }, [load]);

  if (!classes)
    return (
      <div className="flex justify-center py-24 text-brand-600">
        <Spinner />
      </div>
    );

  const filtered = gradeFilter ? classes.filter((c) => c.gradeLevel === gradeFilter) : classes;
  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const visible = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  return (
    <div>
      <PageHeader
        title="Classes"
        subtitle={`Active academic year · ${classes.length} class(es)`}
        actions={
          canAssign ? (
            <>
              <Button variant="secondary" onClick={() => setShowYears(true)}>Academic years</Button>
              <Button onClick={() => setShowCreate(true)}>+ Add class</Button>
            </>
          ) : undefined
        }
      />
      <div className="mb-4 max-w-[200px]">
        <Select value={gradeFilter} onChange={(e) => { setGradeFilter(e.target.value); setPage(1); }}>
          <option value="">All grades</option>
          {GRADE_LEVELS.map((g) => <option key={g} value={g}>{gradeLabel(g)}</option>)}
        </Select>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((c) => {
          const fill = Math.min(100, Math.round((c._count.enrollments / c.capacity) * 100));
          return (
            <Card key={c.id} className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-semibold text-slate-900">{c.name}</h2>
                  <p className="text-xs text-slate-500">
                    {gradeLabel(c.gradeLevel)} · Section {c.section}
                    {c.branch ? ` · ${c.branch}` : ""} · {c.academicYear.name}
                  </p>
                </div>
                <span className="rounded-md bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700">
                  {c._count.enrollments}/{c.capacity}
                </span>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded bg-slate-100">
                <div className="h-full rounded bg-brand-500" style={{ width: `${fill}%` }} />
              </div>
              <div className="mt-3 flex items-center justify-between">
                <p className="text-sm text-slate-600">
                  Homeroom:{" "}
                  {c.homeroomTeacher
                    ? `${c.homeroomTeacher.user.firstName} ${c.homeroomTeacher.user.lastName}`
                    : <span className="text-slate-400">unassigned</span>}
                </p>
                <span className="flex gap-3">
                  {canEdit && (
                    <button className="text-xs font-medium text-slate-500 hover:underline" onClick={() => setEditing(c)}>
                      Edit
                    </button>
                  )}
                  {canAssign && (
                    <button className="text-xs font-medium text-brand-600 hover:underline" onClick={() => setManaging(c)}>
                      Subjects & teachers
                    </button>
                  )}
                </span>
              </div>
            </Card>
          );
        })}
        {visible.length === 0 && (
          <p className="col-span-full py-16 text-center text-sm text-slate-400">No classes for this grade yet.</p>
        )}
      </div>
      <Pager page={page} totalPages={totalPages} onPage={setPage} />

      {managing && <ManageSubjectsModal classRow={managing} onClose={() => setManaging(null)} />}
      {editing && (
        <EditClassModal
          classRow={editing}
          role={role}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
      {showCreate && (
        <CreateClassModal
          onClose={() => setShowCreate(false)}
          onCreated={async () => {
            setShowCreate(false);
            await load();
          }}
          onSetUpYears={() => {
            setShowCreate(false);
            setShowYears(true);
          }}
        />
      )}
      {showYears && (
        <ManageYearsModal
          onClose={() => {
            setShowYears(false);
            void load(); // activating a different year changes which classes show
          }}
        />
      )}
    </div>
  );
}

// ============ admin: add a class (grade + section + optional branch) ============

function CreateClassModal({ onClose, onCreated, onSetUpYears }: {
  onClose: () => void;
  onCreated: () => Promise<void>;
  onSetUpYears: () => void;
}) {
  // null = still loading — distinct from "loaded and none exist".
  const [years, setYears] = useState<Array<{ id: string; name: string; isActive: boolean }> | null>(null);
  const [form, setForm] = useState({ gradeLevel: "K", section: "A", branch: "", capacity: "30", academicYearId: "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    get<Array<{ id: string; name: string; isActive: boolean }>>("/academics/years")
      .then((ys) => {
        setYears(ys);
        const active = ys.find((y) => y.isActive) ?? ys[0];
        if (active) setForm((f) => ({ ...f, academicYearId: active.id }));
      })
      .catch((err) => {
        setYears([]);
        setError(err instanceof ApiClientError ? err.message : "Failed to load academic years");
      });
  }, []);

  // Display name derived from grade + section + branch, e.g. "KG — B (West Campus)".
  const name = `${form.gradeLevel === "K" ? "Kindergarten" : `Grade ${form.gradeLevel}`} — ${form.section}${form.branch ? ` (${form.branch})` : ""}`;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await post("/academics/classes", {
        name,
        gradeLevel: form.gradeLevel,
        section: form.section,
        branch: form.branch || undefined,
        capacity: Number(form.capacity),
        academicYearId: form.academicYearId,
      });
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to create class");
      setSaving(false);
    }
  }

  return (
    <Modal open title="Add a class" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Grade">
            <Select value={form.gradeLevel} onChange={(e) => setForm((f) => ({ ...f, gradeLevel: e.target.value }))}>
              {GRADE_LEVELS.map((g) => <option key={g} value={g}>{gradeLabel(g)}</option>)}
            </Select>
          </Field>
          <Field label="Section" hint="A, B, C… — as many per grade as needed">
            <Input value={form.section} onChange={(e) => setForm((f) => ({ ...f, section: e.target.value.toUpperCase() }))} required maxLength={5} />
          </Field>
          <Field label="Branch / campus (optional)" hint="For multi-branch schools">
            <Input value={form.branch} onChange={(e) => setForm((f) => ({ ...f, branch: e.target.value }))} placeholder="e.g. West Campus" />
          </Field>
          <Field label="Capacity">
            <Input type="number" min={1} value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} />
          </Field>
        </div>
        <Field label="Academic year">
          {years === null ? (
            <p className="py-2 text-sm text-slate-400">Loading academic years…</p>
          ) : years.length === 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              No academic years exist yet — a class must belong to one.{" "}
              <button type="button" className="font-semibold underline" onClick={onSetUpYears}>
                Set up the academic year first →
              </button>
            </div>
          ) : (
            <Select value={form.academicYearId} onChange={(e) => setForm((f) => ({ ...f, academicYearId: e.target.value }))} required>
              {years.map((y) => <option key={y.id} value={y.id}>{y.name}{y.isActive ? " (current)" : ""}</option>)}
            </Select>
          )}
        </Field>
        <p className="rounded bg-slate-50 px-3 py-2 text-sm text-slate-600">Will be created as: <strong>{name}</strong></p>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving} disabled={!form.academicYearId}>Create class</Button>
        </div>
      </form>
    </Modal>
  );
}

// ====== edit a class: homeroom teacher (admin/registrar), name & structure
// ====== (super admin), delete (super admin, only while empty) ======

function EditClassModal({ classRow, role, onClose, onSaved }: {
  classRow: ClassRow;
  role: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const isSuperAdmin = role === "SUPER_ADMIN";
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [form, setForm] = useState({
    name: classRow.name,
    section: classRow.section,
    branch: classRow.branch ?? "",
    capacity: String(classRow.capacity),
    homeroomTeacherId: classRow.homeroomTeacher?.id ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    get<{ items: Array<TeacherOption & { staffType: string }> }>("/staff?pageSize=100&staffType=TEACHING").then((d) =>
      setTeachers(d.items),
    );
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // Non-super-admins may only touch the homeroom teacher; sending the
      // structural fields would be rejected by the API.
      await patch(`/academics/classes/${classRow.id}`, {
        homeroomTeacherId: form.homeroomTeacherId || null,
        ...(isSuperAdmin
          ? {
              name: form.name,
              section: form.section,
              branch: form.branch,
              capacity: Number(form.capacity),
            }
          : {}),
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to update class");
      setSaving(false);
    }
  }

  async function onDelete() {
    setDeleting(true);
    setError(null);
    try {
      await del(`/academics/classes/${classRow.id}`);
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to remove class");
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <Modal open title={`Edit class — ${classRow.name}`} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Homeroom teacher" hint="The teacher responsible for this class (admin & registrar can change this)">
          <Select value={form.homeroomTeacherId} onChange={(e) => setForm((f) => ({ ...f, homeroomTeacherId: e.target.value }))}>
            <option value="">— No homeroom teacher —</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.user.firstName} {t.user.lastName} · {t.designation}
              </option>
            ))}
          </Select>
        </Field>

        <div className="space-y-4 rounded-lg bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Class name & structure {isSuperAdmin ? "" : "— Super Admin only"}
          </p>
          <Field label="Class name">
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required disabled={!isSuperAdmin} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Section">
              <Input value={form.section} onChange={(e) => setForm((f) => ({ ...f, section: e.target.value.toUpperCase() }))} required maxLength={5} disabled={!isSuperAdmin} />
            </Field>
            <Field label="Branch / campus">
              <Input value={form.branch} onChange={(e) => setForm((f) => ({ ...f, branch: e.target.value }))} disabled={!isSuperAdmin} />
            </Field>
            <Field label="Capacity">
              <Input type="number" min={1} value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} required disabled={!isSuperAdmin} />
            </Field>
          </div>
        </div>

        <ErrorNote message={error} />
        <div className="flex items-center justify-between gap-3">
          {isSuperAdmin ? (
            confirmDelete ? (
              <span className="flex items-center gap-2">
                <Button type="button" variant="danger" loading={deleting} onClick={() => void onDelete()}>
                  Yes, remove class
                </Button>
                <Button type="button" variant="ghost" onClick={() => setConfirmDelete(false)}>Keep it</Button>
              </span>
            ) : (
              <Button
                type="button"
                variant="ghost"
                className="!text-rose-600"
                title="A class can only be removed while no students are enrolled in it"
                onClick={() => setConfirmDelete(true)}
              >
                Remove class…
              </Button>
            )
          ) : <span />}
          <span className="flex gap-3">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={saving}>Save changes</Button>
          </span>
        </div>
      </form>
    </Modal>
  );
}

// ============== admin: assign subjects & teachers to a class ==============

interface ClassSubjectRow {
  id: string;
  subject: { id: string; name: string; code: string };
  teacher?: { id: string; user: { firstName: string; lastName: string } } | null;
}
interface SubjectOption { id: string; name: string; code: string; gradeLevel: string | null }
interface TeacherOption { id: string; designation: string; user: { firstName: string; lastName: string } }

function ManageSubjectsModal({ classRow, onClose }: { classRow: ClassRow; onClose: () => void }) {
  const [classSubjects, setClassSubjects] = useState<ClassSubjectRow[] | null>(null);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [newSubjectId, setNewSubjectId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const detail = await get<{ classSubjects: ClassSubjectRow[] }>(`/academics/classes/${classRow.id}`);
    setClassSubjects(detail.classSubjects);
  }, [classRow.id]);

  useEffect(() => {
    void load();
    // Only subjects valid for this grade (grade-scoped or school-wide).
    get<SubjectOption[]>(`/academics/subjects?gradeLevel=${classRow.gradeLevel}`).then(setSubjects);
    get<{ items: Array<TeacherOption & { staffType: string }> }>("/staff?pageSize=100&staffType=TEACHING").then((d) =>
      setTeachers(d.items),
    );
  }, [load, classRow.gradeLevel]);

  async function assign(subjectId: string, teacherId: string | undefined) {
    setBusy(true);
    setError(null);
    try {
      await post("/academics/class-subjects", { classRoomId: classRow.id, subjectId, teacherId: teacherId || undefined });
      setNewSubjectId("");
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Assignment failed");
    } finally {
      setBusy(false);
    }
  }

  const unassigned = subjects.filter((s) => !classSubjects?.some((cs) => cs.subject.id === s.id));

  return (
    <Modal open title={`Subjects & teachers — ${classRow.name}`} onClose={onClose} wide>
      <ErrorNote message={error} />
      {!classSubjects ? (
        <div className="flex justify-center py-10 text-brand-600"><Spinner /></div>
      ) : (
        <div className="space-y-5">
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {classSubjects.map((cs) => (
              <li key={cs.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">{cs.subject.name}</p>
                  <p className="text-xs text-slate-400">{cs.subject.code}</p>
                </div>
                <span className="flex items-center gap-3">
                  <Select
                    className="!w-64"
                    value={cs.teacher?.id ?? ""}
                    disabled={busy}
                    onChange={(e) => void assign(cs.subject.id, e.target.value || undefined)}
                  >
                    <option value="">— No teacher assigned —</option>
                    {teachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.user.firstName} {t.user.lastName} · {t.designation}
                      </option>
                    ))}
                  </Select>
                  <button
                    className="text-xs font-medium text-rose-600 hover:underline"
                    disabled={busy}
                    title="Remove this subject from the class (blocked once results exist)"
                    onClick={async () => {
                      setBusy(true);
                      setError(null);
                      try {
                        await del(`/academics/class-subjects/${cs.id}`);
                        await load();
                      } catch (err) {
                        setError(err instanceof ApiClientError ? err.message : "Failed to remove");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Remove
                  </button>
                </span>
              </li>
            ))}
            {classSubjects.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-slate-400">No subjects assigned to this class yet.</li>
            )}
          </ul>

          <div className="flex items-end gap-3">
            <Field label="Add a subject to this class">
              <Select value={newSubjectId} onChange={(e) => setNewSubjectId(e.target.value)} className="!w-72">
                <option value="">Choose a subject…</option>
                {unassigned.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.gradeLevel ? `(Grade ${s.gradeLevel})` : "(All grades)"}
                  </option>
                ))}
              </Select>
            </Field>
            <Button disabled={!newSubjectId || busy} onClick={() => void assign(newSubjectId, undefined)}>
              Add subject
            </Button>
          </div>
          <p className="text-xs text-slate-400">
            The assigned teacher is the only one who can grade this subject for this class and send its results to the registrar.
          </p>
        </div>
      )}
    </Modal>
  );
}

// ====== admin: academic years — the app-wide "current year" every module
// ====== hangs off. Create years, add their terms, switch the active one.

interface YearRow {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  terms: Array<{ id: string; name: string; startDate: string; endDate: string }>;
}

function ManageYearsModal({ onClose }: { onClose: () => void }) {
  const [years, setYears] = useState<YearRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newYear, setNewYear] = useState({ name: "", startDate: localDateIso(), endDate: "", isActive: true });
  const [termForYear, setTermForYear] = useState<YearRow | null>(null);
  const [newTerm, setNewTerm] = useState({ name: "", startDate: "", endDate: "" });

  const load = useCallback(
    () =>
      get<YearRow[]>("/academics/years")
        .then(setYears)
        .catch((err) => {
          setYears([]);
          setError(err instanceof ApiClientError ? err.message : "Failed to load academic years");
        }),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
      return true;
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Request failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function createYear(e: FormEvent) {
    e.preventDefault();
    const created = await run(() => post("/academics/years", newYear));
    if (created) setNewYear({ name: "", startDate: localDateIso(), endDate: "", isActive: false });
  }

  async function addTerm(e: FormEvent) {
    e.preventDefault();
    if (!termForYear) return;
    const created = await run(() => post("/academics/terms", { ...newTerm, academicYearId: termForYear.id }));
    if (created) {
      setTermForYear(null);
      setNewTerm({ name: "", startDate: "", endDate: "" });
    }
  }

  return (
    <Modal open title="Academic years" onClose={onClose} wide>
      <ErrorNote message={error} />
      {!years ? (
        <div className="flex justify-center py-10 text-brand-600"><Spinner /></div>
      ) : (
        <div className="space-y-5">
          {years.length === 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              No academic years yet. Everything in the school — classes, enrolment, fees, exams — belongs to an
              academic year, so create the first one below and keep it marked as active.
            </div>
          )}

          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {years.map((y) => (
              <li key={y.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-medium text-slate-800">
                      {y.name} {y.isActive && <Badge tone="green">Active</Badge>}
                    </p>
                    <p className="text-xs text-slate-400">
                      {formatDate(y.startDate)} — {formatDate(y.endDate)} ·{" "}
                      {y.terms.length > 0 ? y.terms.map((t) => t.name).join(", ") : "no terms yet"}
                    </p>
                  </div>
                  <span className="flex items-center gap-3">
                    <button
                      className="text-xs font-medium text-brand-600 hover:underline"
                      disabled={busy}
                      onClick={() => {
                        setTermForYear(termForYear?.id === y.id ? null : y);
                        setNewTerm({ name: `Term ${y.terms.length + 1}`, startDate: "", endDate: "" });
                      }}
                    >
                      + Add term
                    </button>
                    {!y.isActive && (
                      <Button
                        variant="secondary"
                        disabled={busy}
                        title="Makes this the current year school-wide (deactivates the others)"
                        onClick={() => void run(() => post(`/academics/years/${y.id}/activate`))}
                      >
                        Make active
                      </Button>
                    )}
                  </span>
                </div>
                {termForYear?.id === y.id && (
                  <form onSubmit={addTerm} className="mt-3 flex items-end gap-3 rounded-lg bg-slate-50 p-3">
                    <Field label="Term name">
                      <Input value={newTerm.name} onChange={(e) => setNewTerm((t) => ({ ...t, name: e.target.value }))} required />
                    </Field>
                    <Field label="Starts">
                      <Input type="date" value={newTerm.startDate} onChange={(e) => setNewTerm((t) => ({ ...t, startDate: e.target.value }))} required />
                    </Field>
                    <Field label="Ends">
                      <Input type="date" value={newTerm.endDate} onChange={(e) => setNewTerm((t) => ({ ...t, endDate: e.target.value }))} required />
                    </Field>
                    <Button type="submit" loading={busy}>Add</Button>
                  </form>
                )}
              </li>
            ))}
          </ul>

          <form onSubmit={createYear} className="space-y-3 rounded-lg border border-slate-200 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Add an academic year</p>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Name" hint={`e.g. "2026-2027"`}>
                <Input value={newYear.name} onChange={(e) => setNewYear((f) => ({ ...f, name: e.target.value }))} placeholder="2026-2027" required minLength={4} />
              </Field>
              <Field label="Starts">
                <Input type="date" value={newYear.startDate} onChange={(e) => setNewYear((f) => ({ ...f, startDate: e.target.value }))} required />
              </Field>
              <Field label="Ends">
                <Input type="date" value={newYear.endDate} onChange={(e) => setNewYear((f) => ({ ...f, endDate: e.target.value }))} required />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={newYear.isActive}
                onChange={(e) => setNewYear((f) => ({ ...f, isActive: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              Make this the active (current) year
            </label>
            <div className="flex justify-end">
              <Button type="submit" loading={busy}>Create year</Button>
            </div>
          </form>
        </div>
      )}
    </Modal>
  );
}
