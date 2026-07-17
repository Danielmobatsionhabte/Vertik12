"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Paginated } from "@vertik12/shared";
import { get, post, getSession, ApiClientError } from "@/lib/api";
import { useGrades } from "@/lib/grades";
import { fullName, gradeLabel } from "@/lib/format";
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
  enrollments: Array<{ classRoom: { name: string } }>;
}

interface ClassOption { id: string; name: string; gradeLevel: string }

export default function StudentsPage() {
  const router = useRouter();
  const [data, setData] = useState<Paginated<StudentRow> | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [gradeLevel, setGradeLevel] = useState("");
  const [classRoomId, setClassRoomId] = useState("");
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAssign, setShowAssign] = useState(false);
  const grades = useGrades();

  const canManage = ["SUPER_ADMIN", "ADMIN", "REGISTRAR"].includes(getSession()?.user.role ?? "");

  useEffect(() => {
    get<ClassOption[]>("/academics/classes").then(setClasses).catch(() => setClasses([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (search) params.set("search", search);
    if (gradeLevel) params.set("gradeLevel", gradeLevel);
    if (classRoomId) params.set("classRoomId", classRoomId);
    try {
      setData(await get<Paginated<StudentRow>>(`/students?${params}`));
    } finally {
      setLoading(false);
    }
  }, [page, search, gradeLevel, classRoomId]);

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
            { header: "Status", cell: (s) => <Badge>{s.status}</Badge> },
          ]}
        />
        {data && <Pager page={data.page} totalPages={data.totalPages} onPage={setPage} />}
      </Card>

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

// ============ assign existing students to an academic year ============

interface UnassignedStudent { id: string; admissionNo: string; firstName: string; lastName: string; gradeLevel: string }
interface YearOption { id: string; name: string; isActive: boolean }

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
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [classRoomId, setClassRoomId] = useState("");
  const [students, setStudents] = useState<UnassignedStudent[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
        </div>

        {!students ? (
          <div className="flex justify-center py-10 text-brand-600"><Spinner /></div>
        ) : students.length === 0 ? (
          <p className="rounded-lg bg-slate-50 py-8 text-center text-sm text-slate-400">
            Every active student{grade ? ` in ${gradeLabel(grade)}` : ""} is already enrolled in this academic year.
          </p>
        ) : (
          <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
            {students.map((s) => (
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
          <p className="text-xs text-slate-400">{selected.size} student(s) selected</p>
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
