"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ATTENDANCE_STATUSES, type AttendanceStatus } from "@vertik12/shared";
import { get, post, getSession } from "@/lib/api";
import { fullName, localDateIso } from "@/lib/format";
import { Button, Card, ErrorNote, Field, PageHeader, Select, Spinner, cx } from "@/components/ui";

interface RegisterRow {
  student: { id: string; admissionNo: string; firstName: string; lastName: string };
  rollNo: number | null;
  status: AttendanceStatus | null;
}
interface ClassOption { id: string; name: string }
interface MySubjectRow {
  id: string;
  subject: { id: string; name: string };
  classRoom: { id: string; name: string };
}

const statusStyles: Record<AttendanceStatus, string> = {
  PRESENT: "bg-emerald-600 text-white",
  ABSENT: "bg-rose-600 text-white",
  LATE: "bg-amber-500 text-white",
  EXCUSED: "bg-sky-600 text-white",
};

// Local calendar date — toISOString() would give the UTC date, which is a
// different day around midnight and made registers land on the wrong day.
const todayIso = () => localDateIso();

export default function AttendancePage() {
  const role = getSession()?.user.role ?? "";
  const isTeacher = role === "TEACHER";

  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [mySubjects, setMySubjects] = useState<MySubjectRow[]>([]);
  const [classRoomId, setClassRoomId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [date, setDate] = useState(todayIso());
  const [rows, setRows] = useState<RegisterRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Teachers: classes come from their teaching load and attendance is per
  // subject they teach. Admin/registrar: any class, subject optional.
  useEffect(() => {
    if (isTeacher) {
      get<MySubjectRow[]>("/academics/my-subjects").then((load) => {
        setMySubjects(load);
        const uniqueClasses = [...new Map(load.map((a) => [a.classRoom.id, a.classRoom])).values()];
        setClasses(uniqueClasses);
        if (uniqueClasses[0]) setClassRoomId(uniqueClasses[0].id);
      });
    } else {
      get<ClassOption[]>("/academics/classes").then((c) => {
        setClasses(c);
        if (c[0]) setClassRoomId(c[0].id);
      });
      get<MySubjectRow[]>("/academics/my-subjects").then(setMySubjects).catch(() => setMySubjects([]));
    }
  }, [isTeacher]);

  // Subjects available for the selected class.
  const classSubjects = mySubjects.filter((a) => a.classRoom.id === classRoomId);
  useEffect(() => {
    if (isTeacher) {
      // Teachers must pick one of their subjects; default to the first.
      setSubjectId(classSubjects[0]?.subject.id ?? "");
    } else {
      setSubjectId(""); // admin/registrar default: general (homeroom)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classRoomId, isTeacher, mySubjects.length]);

  const loadRegister = useCallback(async () => {
    if (!classRoomId) return;
    if (isTeacher && !subjectId) return;
    setLoading(true);
    setMessage(null);
    try {
      const params = new URLSearchParams({ classRoomId, date });
      if (subjectId) params.set("subjectId", subjectId);
      setRows(await get<RegisterRow[]>(`/attendance/register?${params}`));
    } finally {
      setLoading(false);
    }
  }, [classRoomId, subjectId, date, isTeacher]);

  useEffect(() => {
    void loadRegister();
  }, [loadRegister]);

  function setStatus(studentId: string, status: AttendanceStatus) {
    setRows((rs) => rs?.map((r) => (r.student.id === studentId ? { ...r, status } : r)) ?? null);
  }

  function markAll(status: AttendanceStatus) {
    setRows((rs) => rs?.map((r) => ({ ...r, status })) ?? null);
  }

  async function save() {
    if (!rows) return;
    const records = rows.filter((r) => r.status).map((r) => ({ studentId: r.student.id, status: r.status! }));
    if (records.length === 0) {
      setError("Mark at least one student first");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await post("/attendance/mark", { classRoomId, date, records, subjectId: subjectId || undefined });
      setMessage(`Register saved — ${records.length} student(s) marked.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Attendance"
        subtitle="Attendance is recorded per subject/period; teachers mark the subjects they teach"
        actions={
          <Link href="/attendance/report">
            <Button variant="secondary">📋 Attendance report</Button>
          </Link>
        }
      />

      <Card className="mb-6 flex flex-wrap items-end gap-4 p-4">
        <Field label="Class">
          <Select value={classRoomId} onChange={(e) => setClassRoomId(e.target.value)} className="min-w-[200px]">
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Subject / period">
          <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="min-w-[190px]">
            {!isTeacher && <option value="">General (homeroom)</option>}
            {classSubjects.map((a) => (
              <option key={a.subject.id} value={a.subject.id}>{a.subject.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Date">
          <input
            type="date"
            value={date}
            max={todayIso()}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          />
        </Field>
        <div className="ml-auto flex gap-2 print:hidden">
          <Button variant="secondary" onClick={() => window.print()}>🖨 Print register</Button>
          <Button variant="secondary" onClick={() => markAll("PRESENT")}>All present</Button>
          <Button onClick={save} loading={saving}>Save register</Button>
        </div>
      </Card>

      {message && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>}
      <ErrorNote message={error} />

      <Card>
        {loading || !rows ? (
          <div className="flex justify-center py-16 text-brand-600"><Spinner /></div>
        ) : rows.length === 0 ? (
          <p className="py-16 text-center text-sm text-slate-400">No students enrolled in this class.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={r.student.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">{fullName(r.student)}</p>
                  <p className="text-xs text-slate-400">{r.student.admissionNo}{r.rollNo ? ` · Roll ${r.rollNo}` : ""}</p>
                </div>
                <div className="flex gap-1.5">
                  {ATTENDANCE_STATUSES.map((s) => (
                    <button
                      key={s}
                      onClick={() => setStatus(r.student.id, s)}
                      className={cx(
                        "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                        r.status === s ? statusStyles[s] : "bg-slate-100 text-slate-500 hover:bg-slate-200",
                      )}
                    >
                      {s.charAt(0) + s.slice(1).toLowerCase()}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
