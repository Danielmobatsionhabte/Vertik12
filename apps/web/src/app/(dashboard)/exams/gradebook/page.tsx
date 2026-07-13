"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { get, post, getSession, ApiClientError } from "@/lib/api";
import { formatDate, fullName, humanize } from "@/lib/format";
import { Badge, Button, Card, ErrorNote, Field, Input, PageHeader, Select, Spinner } from "@/components/ui";

/**
 * Gradebook — the full teacher grading lifecycle:
 *
 *  1. Pick one of YOUR class × subject assignments and an assessment
 *     (assignment / weekly test / term exam / final exam).
 *  2. Enter or edit marks (existing marks load automatically).
 *  3. "Send to registrar" — marks lock (SUBMITTED).
 *  4. Registrar approves (locked for good) or rejects (editing reopens).
 *
 * The API enforces every rule; this page mirrors the state.
 */

interface Assignment {
  id: string;
  subject: { id: string; code: string; name: string };
  classRoom: { id: string; name: string; gradeLevel: string; _count: { enrollments: number } };
}

interface ExamRow { id: string; name: string; category: string; term: { name: string } }
interface RosterStudent { id: string; admissionNo: string; firstName: string; lastName: string }
interface Submission { status: "SUBMITTED" | "APPROVED" | "REJECTED"; note?: string | null; submittedAt: string; reviewedAt?: string | null }

export default function GradebookPage() {
  const role = getSession()?.user.role;
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [assignmentId, setAssignmentId] = useState("");
  const [examId, setExamId] = useState("");
  const [maxMarks, setMaxMarks] = useState("100");
  const [roster, setRoster] = useState<RosterStudent[] | null>(null);
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    get<Assignment[]>("/academics/my-subjects").then((a) => {
      setAssignments(a);
      if (a[0]) setAssignmentId(a[0].id);
    });
    get<ExamRow[]>("/exams").then((e) => {
      setExams(e);
      if (e[0]) setExamId(e[0].id);
    });
  }, []);

  const assignment = assignments?.find((a) => a.id === assignmentId) ?? null;

  // Roster + existing marks + lock state for the selected combination.
  const loadRoster = useCallback(async () => {
    if (!assignment || !examId) return;
    setRoster(null);
    setMarks({});
    setSubmission(null);
    setLocked(false);
    const [classRoom, existing] = await Promise.all([
      get<{ enrollments: Array<{ student: RosterStudent }> }>(`/academics/classes/${assignment.classRoom.id}`),
      get<{ results: Array<{ studentId: string; marks: number; maxMarks: number }>; submission: Submission | null; locked: boolean }>(
        `/exams/results?examId=${examId}&classRoomId=${assignment.classRoom.id}&subjectId=${assignment.subject.id}`,
      ),
    ]);
    setRoster(classRoom.enrollments.map((e) => e.student));
    const prefill: Record<string, string> = {};
    for (const r of existing.results) prefill[r.studentId] = String(r.marks);
    setMarks(prefill);
    if (existing.results[0]) setMaxMarks(String(existing.results[0].maxMarks));
    setSubmission(existing.submission);
    setLocked(existing.locked);
  }, [assignment, examId]);

  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  async function saveResults(e: FormEvent) {
    e.preventDefault();
    if (!assignment || !roster) return;
    const results = roster
      .filter((s) => marks[s.id] !== undefined && marks[s.id] !== "")
      .map((s) => ({ studentId: s.id, marks: Number(marks[s.id]) }));
    if (results.length === 0) {
      setError("Enter marks for at least one student");
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await post("/exams/results", {
        examId,
        subjectId: assignment.subject.id,
        classRoomId: assignment.classRoom.id,
        maxMarks: Number(maxMarks),
        results,
      });
      setNotice(`Saved ${results.length} result(s). You can keep editing until you send them to the registrar.`);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to save results");
    } finally {
      setSaving(false);
    }
  }

  async function sendToRegistrar() {
    if (!assignment) return;
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      await post("/exams/submissions", {
        examId,
        classRoomId: assignment.classRoom.id,
        subjectId: assignment.subject.id,
      });
      setNotice("Results sent to the registrar. They are locked until reviewed.");
      await loadRoster();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to submit");
    } finally {
      setSending(false);
    }
  }

  if (!assignments) {
    return <div className="flex justify-center py-24 text-brand-600"><Spinner /></div>;
  }

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Gradebook"
        subtitle={
          role === "TEACHER"
            ? "Enter marks for your subjects, then send them to the registrar for approval"
            : "All class–subject assignments (administrator view)"
        }
      />

      {assignments.length === 0 ? (
        <Card className="p-10 text-center text-sm text-slate-400">
          No subjects are assigned to you yet. Ask the administrator to assign you to a class.
        </Card>
      ) : (
        <form onSubmit={saveResults} className="space-y-6">
          <Card className="flex flex-wrap items-end gap-4 p-4">
            <Field label="My subject · class">
              <Select value={assignmentId} onChange={(e) => setAssignmentId(e.target.value)} className="min-w-[260px]">
                {assignments.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.subject.name} — {a.classRoom.name} ({a.classRoom._count.enrollments} students)
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Assessment">
              <Select value={examId} onChange={(e) => setExamId(e.target.value)} className="min-w-[220px]">
                {exams.map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    {ex.name} · {humanize(ex.category)} ({ex.term.name})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Out of">
              <Input type="number" min={1} value={maxMarks} onChange={(e) => setMaxMarks(e.target.value)} className="!w-24" disabled={locked} />
            </Field>
          </Card>

          {/* submission state banner */}
          {submission?.status === "APPROVED" && (
            <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <Badge tone="green">APPROVED</Badge>
              These results were approved by the registrar{submission.reviewedAt ? ` on ${formatDate(submission.reviewedAt)}` : ""} and are final.
            </div>
          )}
          {submission?.status === "SUBMITTED" && (
            <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <Badge tone="yellow">PENDING REVIEW</Badge>
              Sent to the registrar on {formatDate(submission.submittedAt)} — locked until reviewed.
            </div>
          )}
          {submission?.status === "REJECTED" && (
            <div className="flex items-center gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              <Badge tone="red">REJECTED</Badge>
              {submission.note ? `Registrar's note: "${submission.note}" — ` : ""}please correct the marks and resubmit.
            </div>
          )}

          {notice && <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">{notice}</div>}
          <ErrorNote message={error} />

          <Card>
            {!roster ? (
              <div className="flex justify-center py-16 text-brand-600"><Spinner /></div>
            ) : roster.length === 0 ? (
              <p className="py-16 text-center text-sm text-slate-400">No students enrolled in this class.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {roster.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-4 px-5 py-2.5">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{fullName(s)}</p>
                      <p className="text-xs text-slate-400">{s.admissionNo}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        max={Number(maxMarks)}
                        step="0.5"
                        placeholder="—"
                        className="!w-24 text-right disabled:bg-slate-50"
                        value={marks[s.id] ?? ""}
                        disabled={locked}
                        onChange={(e) => setMarks((m) => ({ ...m, [s.id]: e.target.value }))}
                      />
                      <span className="w-10 text-xs text-slate-400">/ {maxMarks}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {!locked && (
            <div className="flex justify-end gap-3">
              <Button type="submit" variant="secondary" loading={saving}>Save draft</Button>
              <Button type="button" loading={sending} onClick={sendToRegistrar}>
                Send to registrar →
              </Button>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
