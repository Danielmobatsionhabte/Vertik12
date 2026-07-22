"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Paginated } from "@vertik12/shared";
import { get, post, patch, getSession, ApiClientError } from "@/lib/api";
import { useGrades } from "@/lib/grades";
import { formatDate, fullName, gradeLabel } from "@/lib/format";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner } from "@/components/ui";
import { DataTable, Pager } from "@/components/data-table";

interface StudentRow {
  id: string;
  admissionNo: string;
  firstName: string;
  lastName: string;
  gradeLevel: string;
  gender: string;
  status: string;
  admittedAt: string;
  enrollments: Array<{ classRoom: { name: string } }>;
}

interface ClassOption { id: string; name: string; gradeLevel: string }
interface YearOption { id: string; name: string; isActive: boolean }
/** A class plus its occupancy, so a full section can be shown as full. */
interface SectionOption extends ClassOption { capacity: number; _count: { enrollments: number } }

export default function StudentsPage() {
  const router = useRouter();
  const [data, setData] = useState<Paginated<StudentRow> | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [gradeLevel, setGradeLevel] = useState("");
  const [classRoomId, setClassRoomId] = useState("");
  const [yearId, setYearId] = useState("");
  const [sort, setSort] = useState("recent");
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [years, setYears] = useState<YearOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAssign, setShowAssign] = useState(false);
  const [sectionFor, setSectionFor] = useState<StudentRow | null>(null);
  const grades = useGrades();

  const canManage = ["SUPER_ADMIN", "ADMIN", "REGISTRAR"].includes(getSession()?.user.role ?? "");

  useEffect(() => {
    get<YearOption[]>("/academics/years").then(setYears).catch(() => setYears([]));
  }, []);

  // Classes follow the chosen year, so its sections are filterable too.
  useEffect(() => {
    const params = yearId ? `?academicYearId=${yearId}` : "";
    get<ClassOption[]>(`/academics/classes${params}`).then(setClasses).catch(() => setClasses([]));
    setClassRoomId("");
  }, [yearId]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: "20", sort });
    if (search) params.set("search", search);
    if (gradeLevel) params.set("gradeLevel", gradeLevel);
    if (classRoomId) params.set("classRoomId", classRoomId);
    if (yearId) params.set("academicYearId", yearId);
    try {
      setData(await get<Paginated<StudentRow>>(`/students?${params}`));
    } finally {
      setLoading(false);
    }
  }, [page, search, gradeLevel, classRoomId, yearId, sort]);

  useEffect(() => {
    // Debounce so typing in the search box doesn't fire a request per key.
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  return (
    <div>
      <PageHeader
        title="Students"
        subtitle={data ? `${data.total} student record(s)` : undefined}
        actions={
          // Admissions belong to the admin/registrar — teachers and
          // accountants get read-only access to student records.
          canManage ? (
            <div className="flex gap-2">
              <Link href="/students/report">
                <Button variant="secondary">Yearly report</Button>
              </Link>
              <Button variant="secondary" onClick={() => setShowAssign(true)}>Assign to academic year</Button>
              <Link href="/students/new">
                <Button>+ Register student</Button>
              </Link>
            </div>
          ) : undefined
        }
      />

      <Card>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <Input
            placeholder="Search name or admission no…"
            className="max-w-xs"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <Select
            className="max-w-[180px]"
            value={gradeLevel}
            onChange={(e) => {
              setGradeLevel(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All grades</option>
            {grades.map((g) => (
              <option key={g.code} value={g.code}>
                {g.name}
              </option>
            ))}
          </Select>
          <Select
            className="max-w-[220px]"
            value={classRoomId}
            onChange={(e) => {
              setClassRoomId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All classes / sections</option>
            {classes
              .filter((c) => !gradeLevel || c.gradeLevel === gradeLevel)
              .map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
          </Select>
          {/* Year filter: switch to any academic year (previous ones too) to
              see exactly who was enrolled then. */}
          <Select
            className="max-w-[190px]"
            value={yearId}
            onChange={(e) => {
              setYearId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All academic years</option>
            {years.map((y) => (
              <option key={y.id} value={y.id}>{y.name}{y.isActive ? " (current)" : ""}</option>
            ))}
          </Select>
          <Select
            className="max-w-[200px]"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              setPage(1);
            }}
          >
            <option value="recent">Recently registered first</option>
            <option value="name">Name (A–Z)</option>
            <option value="grade">Grade</option>
          </Select>
        </div>

        <DataTable
          loading={loading}
          rows={data?.items ?? []}
          keyFor={(s) => s.id}
          onRowClick={(s) => router.push(`/students/${s.id}`)}
          emptyTitle="No students match"
          emptyHint="Try clearing the search or admit a new student."
          columns={[
            { header: "Admission No", cell: (s) => <span className="font-mono text-xs">{s.admissionNo}</span> },
            { header: "Name", cell: (s) => <span className="font-medium text-slate-900">{fullName(s)}</span> },
            { header: "Grade", cell: (s) => gradeLabel(s.gradeLevel) },
            { header: "Class", cell: (s) => s.enrollments[0]?.classRoom.name ?? "—" },
            { header: "Gender", cell: (s) => <span className="capitalize">{s.gender.toLowerCase()}</span> },
            { header: "Registered", cell: (s) => formatDate(s.admittedAt) },
            { header: "Status", cell: (s) => <Badge>{s.status}</Badge> },
            // Reshuffling sections is routine registrar work — offer it on
            // the row rather than making them open each profile in turn.
            ...(canManage
              ? [{
                  header: "",
                  cell: (s: StudentRow) => (
                    <button
                      className="text-xs font-medium text-brand-600 hover:underline"
                      onClick={(e) => { e.stopPropagation(); setSectionFor(s); }}
                    >
                      Change section
                    </button>
                  ),
                }]
              : []),
          ]}
        />
        {data && <Pager page={data.page} totalPages={data.totalPages} onPage={setPage} />}
      </Card>

      {sectionFor && (
        <ChangeSectionModal
          student={sectionFor}
          onClose={() => setSectionFor(null)}
          onMoved={async () => {
            setSectionFor(null);
            await load();
          }}
        />
      )}

      {showAssign && (
        <AssignToYearModal
          onClose={() => setShowAssign(false)}
          onAssigned={async () => {
            setShowAssign(false);
            await load();
          }}
        />
      )}
    </div>
  );
}

// ==================== move a student between sections ====================

/**
 * "Change section": Grade 5 — A → Grade 5 — B for one student, in the
 * current academic year. Only sections of the student's own grade are
 * offered, because the API refuses any other — and a full one is shown as
 * full rather than failing on save.
 */
function ChangeSectionModal({ student, onClose, onMoved }: {
  student: StudentRow;
  onClose: () => void;
  onMoved: () => Promise<void>;
}) {
  const [classes, setClasses] = useState<SectionOption[] | null>(null);
  const [classRoomId, setClassRoomId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const current = student.enrollments[0]?.classRoom.name ?? null;

  useEffect(() => {
    get<SectionOption[]>("/academics/classes")
      .then((all) => setClasses(all.filter((c) => c.gradeLevel === student.gradeLevel)))
      .catch(() => setClasses([]));
  }, [student.gradeLevel]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await patch(`/students/${student.id}`, { classRoomId });
      await onMoved();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to move the student");
      setSaving(false);
    }
  }

  const full = (c: SectionOption) => c._count.enrollments >= c.capacity && c.name !== current;

  return (
    <Modal open title={`Change section — ${fullName(student)}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          <p className="font-medium text-slate-800">{gradeLabel(student.gradeLevel)}</p>
          <p className="text-slate-500">Currently in {current ?? "no section"}</p>
        </div>

        {!classes ? (
          <div className="flex justify-center py-8 text-brand-600"><Spinner /></div>
        ) : classes.length === 0 ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            There are no {gradeLabel(student.gradeLevel)} sections in the current academic year. Create one under Classes first.
          </p>
        ) : (
          <Field label="Move to" hint="Sections of this student's grade, with seats used">
            <Select value={classRoomId} onChange={(e) => setClassRoomId(e.target.value)}>
              <option value="">— Select a section —</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id} disabled={full(c)}>
                  {c.name} ({c._count.enrollments}/{c.capacity}){full(c) ? " — full" : ""}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <ErrorNote message={error} />
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="button" loading={saving} disabled={!classRoomId} onClick={() => void save()}>
            Move student
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ============ assign existing students to an academic year ============

interface UnassignedStudent { id: string; admissionNo: string; firstName: string; lastName: string; gradeLevel: string }

/**
 * New-year rollover: existing/previously registered students who have no
 * enrollment in the chosen year are listed here; the registrar/admin picks
 * a class and enrols them in bulk.
 */
function AssignToYearModal({ onClose, onAssigned }: { onClose: () => void; onAssigned: () => Promise<void> }) {
  const grades = useGrades();
  const [years, setYears] = useState<YearOption[]>([]);
  const [yearId, setYearId] = useState("");
  const [grade, setGrade] = useState("");
  const [search, setSearch] = useState("");
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [classRoomId, setClassRoomId] = useState("");
  const [students, setStudents] = useState<UnassignedStudent[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Quick filter over the loaded list: admission no or (full) name.
  // Selections survive a changing search — only the visible rows change.
  const query = search.trim().toLowerCase();
  const visible = students?.filter(
    (s) =>
      !query ||
      s.admissionNo.toLowerCase().includes(query) ||
      `${s.firstName} ${s.lastName}`.toLowerCase().includes(query),
  );

  useEffect(() => {
    get<YearOption[]>("/academics/years").then((ys) => {
      setYears(ys);
      const active = ys.find((y) => y.isActive) ?? ys[0];
      if (active) setYearId(active.id);
    });
  }, []);

  useEffect(() => {
    if (!yearId) return;
    get<ClassOption[]>(`/academics/classes?academicYearId=${yearId}`).then(setClasses);
    setClassRoomId("");
  }, [yearId]);

  useEffect(() => {
    if (!yearId) return;
    setStudents(null);
    setSelected(new Set());
    const params = new URLSearchParams({ academicYearId: yearId });
    if (grade) params.set("gradeLevel", grade);
    get<UnassignedStudent[]>(`/students/unassigned?${params}`).then(setStudents);
  }, [yearId, grade]);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function assign() {
    if (!classRoomId || selected.size === 0) {
      setError("Pick a class and select at least one student");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await post("/students/enroll", { classRoomId, studentIds: [...selected] });
      await onAssigned();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Enrollment failed");
      setSaving(false);
    }
  }

  return (
    <Modal open title="Assign students to an academic year" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <Field label="Academic year">
            <Select value={yearId} onChange={(e) => setYearId(e.target.value)} className="!w-48">
              {years.map((y) => <option key={y.id} value={y.id}>{y.name}{y.isActive ? " (current)" : ""}</option>)}
            </Select>
          </Field>
          <Field label="Grade filter">
            <Select value={grade} onChange={(e) => { setGrade(e.target.value); setClassRoomId(""); }} className="!w-44">
              <option value="">All grades</option>
              {grades.map((g) => <option key={g.code} value={g.code}>{g.name}</option>)}
            </Select>
          </Field>
          <Field label="Enrol into class">
            <Select value={classRoomId} onChange={(e) => setClassRoomId(e.target.value)} className="!w-56">
              <option value="">Choose a class…</option>
              {classes
                .filter((c) => !grade || c.gradeLevel === grade)
                .map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Search student">
            <Input
              className="!w-64"
              placeholder="Admission no or name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
        </div>

        {!students || !visible ? (
          <div className="flex justify-center py-10 text-brand-600"><Spinner /></div>
        ) : students.length === 0 ? (
          <p className="rounded-lg bg-slate-50 py-8 text-center text-sm text-slate-400">
            Every active student{grade ? ` in ${gradeLabel(grade)}` : ""} is already enrolled in this academic year.
          </p>
        ) : visible.length === 0 ? (
          <p className="rounded-lg bg-slate-50 py-8 text-center text-sm text-slate-400">
            No unassigned student matches “{search.trim()}” — check the spelling or clear the search.
          </p>
        ) : (
          <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
            {visible.map((s) => (
              <li key={s.id}>
                <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                  <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
                  <span className="text-sm font-medium text-slate-800">{s.firstName} {s.lastName}</span>
                  <span className="text-xs text-slate-400">{s.admissionNo} · {gradeLabel(s.gradeLevel)}</span>
                </label>
              </li>
            ))}
          </ul>
        )}

        <ErrorNote message={error} />
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-400">
            {selected.size} student(s) selected
            {query && students && visible ? ` · showing ${visible.length} of ${students.length}` : ""}
          </p>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button loading={saving} onClick={() => void assign()} disabled={selected.size === 0 || !classRoomId}>
              Enrol {selected.size || ""} student(s)
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
