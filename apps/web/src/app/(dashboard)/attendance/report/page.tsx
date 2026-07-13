"use client";

import { useEffect, useState } from "react";
import { get, ApiClientError } from "@/lib/api";
import { formatDate, fullName, gradeLabel, localDateIso } from "@/lib/format";
import { Button, Card, ErrorNote, Field, PageHeader, Select, Spinner, cx } from "@/components/ui";

/**
 * Attendance report between two dates — one row per student, one column per
 * school day — for a whole class or a single student. Printable (the app
 * chrome is stripped by the print stylesheet).
 */

interface ClassOption { id: string; name: string; gradeLevel: string }
interface StudentOption { student: { id: string; firstName: string; lastName: string } }
interface Report {
  classRoom: { name: string; gradeLevel: string };
  from: string;
  to: string;
  days: string[];
  rows: Array<{
    student: { id: string; admissionNo: string; firstName: string; lastName: string };
    cells: Array<string | null>;
    presentDays: number;
    absentDays: number;
    rate: number | null;
  }>;
}

const STATUS_INITIAL: Record<string, { label: string; cls: string }> = {
  PRESENT: { label: "P", cls: "text-emerald-700" },
  ABSENT: { label: "A", cls: "font-bold text-rose-600" },
  LATE: { label: "L", cls: "text-amber-600" },
  EXCUSED: { label: "E", cls: "text-sky-600" },
};

// Local calendar date — toISOString() would give the UTC date, which is a
// different day around midnight (dates then appear shifted by one day).
const iso = (d: Date) => localDateIso(d);

export default function AttendanceReportPage() {
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [classRoomId, setClassRoomId] = useState("");
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [studentId, setStudentId] = useState("");
  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(iso(new Date()));
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    get<ClassOption[]>("/academics/classes").then((c) => {
      setClasses(c);
      if (c[0]) setClassRoomId(c[0].id);
    });
  }, []);

  useEffect(() => {
    if (!classRoomId) return;
    setStudentId("");
    get<{ enrollments: StudentOption[] }>(`/academics/classes/${classRoomId}`)
      .then((d) => setStudents(d.enrollments))
      .catch(() => setStudents([]));
  }, [classRoomId]);

  async function generate() {
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const params = new URLSearchParams({ classRoomId, from, to });
      if (studentId) params.set("studentId", studentId);
      setReport(await get<Report>(`/attendance/report?${params}`));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to generate report");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="print:hidden">
        <PageHeader
          title="Attendance report"
          subtitle="Generate a printable attendance table between two dates — for a class or a single student"
          actions={<Button variant="secondary" onClick={() => window.print()} disabled={!report}>🖨 Print</Button>}
        />

        <Card className="mb-6 flex flex-wrap items-end gap-4 p-4">
          <Field label="Class">
            <Select value={classRoomId} onChange={(e) => setClassRoomId(e.target.value)} className="min-w-[200px]">
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Student">
            <Select value={studentId} onChange={(e) => setStudentId(e.target.value)} className="min-w-[200px]">
              <option value="">All students</option>
              {students.map((s) => (
                <option key={s.student.id} value={s.student.id}>{fullName(s.student)}</option>
              ))}
            </Select>
          </Field>
          <Field label="From">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none" />
          </Field>
          <Field label="To">
            <input type="date" value={to} max={iso(new Date())} onChange={(e) => setTo(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none" />
          </Field>
          <Button onClick={() => void generate()} loading={loading}>Generate report</Button>
        </Card>
        <ErrorNote message={error} />
      </div>

      {loading && <div className="flex justify-center py-16 text-brand-600 print:hidden"><Spinner /></div>}

      {report && (
        <Card className="overflow-x-auto p-6 print:border-0 print:p-0 print:shadow-none">
          <div className="mb-4 border-b border-slate-200 pb-3">
            <h2 className="font-semibold text-slate-900">
              Attendance — {report.classRoom.name} ({gradeLabel(report.classRoom.gradeLevel)})
            </h2>
            <p className="text-xs text-slate-500">
              {formatDate(report.from)} to {formatDate(report.to)} ·
              P = Present, A = Absent, L = Late, E = Excused
            </p>
          </div>
          {report.days.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">No attendance was recorded in this period.</p>
          ) : (
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b-2 border-slate-300 text-left text-slate-500">
                  <th className="py-2 pr-3 font-medium">Student</th>
                  {report.days.map((d) => (
                    <th key={d} className="px-1 py-2 text-center font-medium" title={d}>
                      {new Date(d + "T00:00:00Z").getUTCDate()}/{new Date(d + "T00:00:00Z").getUTCMonth() + 1}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right font-medium">Present</th>
                  <th className="px-2 py-2 text-right font-medium">Absent</th>
                  <th className="px-2 py-2 text-right font-medium">Rate</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={r.student.id} className="border-b border-slate-100">
                    <td className="py-1.5 pr-3">
                      <span className="font-medium text-slate-800">{fullName(r.student)}</span>
                      <span className="ml-1 text-slate-400">{r.student.admissionNo}</span>
                    </td>
                    {r.cells.map((c, i) => (
                      <td key={i} className={cx("px-1 py-1.5 text-center", c ? STATUS_INITIAL[c]?.cls : "text-slate-300")}>
                        {c ? STATUS_INITIAL[c]?.label : "·"}
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-right tabular-nums text-emerald-700">{r.presentDays}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-rose-600">{r.absentDays}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-medium">{r.rate === null ? "—" : `${r.rate}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}
