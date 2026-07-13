"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { get, post, ApiClientError } from "@/lib/api";
import { formatDate, formatMoney, fullName, gradeLabel, humanize } from "@/lib/format";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Spinner, StatCard } from "@/components/ui";
import { DataTable } from "@/components/data-table";

interface PortalAssignment {
  id: string;
  title: string;
  instructions: string;
  dueDate: string;
  subject: string;
  teacher: string | null;
  overdue: boolean;
  mySubmission: { id: string; submittedAt: string; feedback?: string | null; grade?: string | null } | null;
}

interface ChildDetail {
  student: { id: string; admissionNo: string; firstName: string; lastName: string; gradeLevel: string };
  classRoom: {
    name: string;
    homeroomTeacher?: { user: { firstName: string; lastName: string } } | null;
    timetableSlots: Array<{ id: string; dayOfWeek: string; startTime: string; endTime: string; subject: { name: string } }>;
  } | null;
  attendance: {
    rate: number | null;
    counts: Record<string, number>;
    recent: Array<{ id: string; date: string; status: string; note?: string | null }>;
  };
  resultsBySubject: Array<{
    subject: { id: string; code: string; name: string };
    average: number;
    grade: string;
    points: number;
    exams: Array<{ exam: string; term: string; marks: number; maxMarks: number; grade: string; remark: string | null }>;
  }>;
  invoices: Array<{ id: string; number: string; status: string; dueDate: string; currency: string; total: number; paid: number; balance: number; items: Array<{ description: string; amount: number }> }>;
}

/** Per-child view: academics, attendance and fees — view-only except payment. */
export default function ChildPage() {
  const { studentId } = useParams<{ studentId: string }>();
  const [data, setData] = useState<ChildDetail | null>(null);
  const [homework, setHomework] = useState<PortalAssignment[] | null>(null);
  const [submitting, setSubmitting] = useState<PortalAssignment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [paying, setPaying] = useState<string | null>(null);

  const load = useCallback(
    () =>
      Promise.all([
        get<ChildDetail>(`/portal/children/${studentId}`).then(setData),
        get<PortalAssignment[]>(`/portal/children/${studentId}/assignments`).then(setHomework),
      ]).catch((e) => setError(e.message)),
    [studentId],
  );
  useEffect(() => {
    void load();
  }, [load]);

  async function payOnline(invoiceId: string, number: string) {
    setPaying(invoiceId);
    setNotice(null);
    try {
      const session = await post<{ checkoutUrl: string; simulated: boolean }>("/portal/pay", { invoiceId });
      if (session.simulated) {
        setNotice(`Payment for ${number} was approved (demo gateway).`);
        await load();
      } else {
        window.location.href = session.checkoutUrl; // → Stripe Checkout
      }
    } catch (err) {
      setNotice(err instanceof ApiClientError ? err.message : "Payment failed");
    } finally {
      setPaying(null);
    }
  }

  if (error) return <p className="text-sm text-rose-600">{error}</p>;
  if (!data)
    return (
      <div className="flex justify-center py-24 text-brand-600">
        <Spinner />
      </div>
    );

  const { student, classRoom, attendance, resultsBySubject, invoices } = data;
  const totalDue = invoices.reduce((s, i) => s + i.balance, 0);

  return (
    <div>
      <PageHeader
        title={fullName(student)}
        subtitle={`${student.admissionNo} · ${gradeLabel(student.gradeLevel)} · ${classRoom?.name ?? "No class"}${
          classRoom?.homeroomTeacher ? ` · Homeroom: ${classRoom.homeroomTeacher.user.firstName} ${classRoom.homeroomTeacher.user.lastName}` : ""
        }`}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Attendance rate" value={attendance.rate === null ? "—" : `${attendance.rate}%`}
          detail={`${attendance.counts.ABSENT ?? 0} absence(s), ${attendance.counts.LATE ?? 0} late`} />
        <StatCard label="Subjects graded" value={resultsBySubject.length} />
        <StatCard label="Fees outstanding" value={formatMoney(totalDue)} detail={totalDue > 0 ? "Payment due" : "All settled"} />
      </div>

      {notice && (
        <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          {notice} <button className="ml-2 underline" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="border-b border-slate-100 px-6 py-4 text-sm font-semibold text-slate-700">Fees & billing</h2>
          <DataTable
            rows={invoices}
            keyFor={(i) => i.id}
            emptyTitle="No invoices"
            columns={[
              { header: "Invoice", cell: (i) => <span className="font-mono text-xs">{i.number}</span> },
              { header: "Due", cell: (i) => formatDate(i.dueDate) },
              { header: "Balance", align: "right", cell: (i) => <span className={i.balance > 0 ? "font-medium text-rose-600" : ""}>{formatMoney(i.balance, i.currency)}</span> },
              { header: "Status", cell: (i) => <Badge>{i.status}</Badge> },
              {
                header: "",
                cell: (i) =>
                  i.balance > 0 && i.status !== "VOID" ? (
                    <Button
                      className="!px-3 !py-1 text-xs"
                      loading={paying === i.id}
                      onClick={() => void payOnline(i.id, i.number)}
                    >
                      Pay online
                    </Button>
                  ) : null,
              },
            ]}
          />
        </Card>

        <Card>
          <h2 className="border-b border-slate-100 px-6 py-4 text-sm font-semibold text-slate-700">
            Academic performance by subject
          </h2>
          {resultsBySubject.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-400">No results recorded yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {resultsBySubject.map((s) => (
                <li key={s.subject.id} className="px-6 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-slate-800">{s.subject.name}</p>
                    <div className="flex items-center gap-3">
                      <span className="text-sm tabular-nums text-slate-500">{s.average}%</span>
                      <Badge tone="brand">{s.grade}</Badge>
                    </div>
                  </div>
                  <ul className="mt-2 space-y-1">
                    {s.exams.map((e, i) => (
                      <li key={i} className="flex items-center justify-between text-xs text-slate-500">
                        <span>{e.exam} · {e.term}{e.remark ? ` — “${e.remark}”` : ""}</span>
                        <span className="tabular-nums">{e.marks}/{e.maxMarks} ({e.grade})</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="border-b border-slate-100 px-6 py-4 text-sm font-semibold text-slate-700">Homework & assignments</h2>
          {!homework ? (
            <div className="flex justify-center py-10 text-brand-600"><Spinner /></div>
          ) : homework.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">No assignments from the teachers yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {homework.map((a) => (
                <li key={a.id} className="px-6 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{a.title}</p>
                      <p className="text-xs text-slate-500">
                        {a.subject}{a.teacher ? ` · ${a.teacher}` : ""} · due {formatDate(a.dueDate)}
                      </p>
                    </div>
                    {a.mySubmission ? (
                      <Badge tone="green">Submitted</Badge>
                    ) : a.overdue ? (
                      <Badge tone="red">Past due</Badge>
                    ) : (
                      <Button className="!px-3 !py-1 text-xs" onClick={() => setSubmitting(a)}>Submit</Button>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-slate-500">{a.instructions}</p>
                  {a.mySubmission?.feedback && (
                    <p className="mt-2 rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                      Teacher's feedback: {a.mySubmission.feedback}
                      {a.mySubmission.grade && <Badge tone="brand">{a.mySubmission.grade}</Badge>}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="border-b border-slate-100 px-6 py-4 text-sm font-semibold text-slate-700">Recent attendance</h2>
          <DataTable
            rows={attendance.recent}
            keyFor={(a) => a.id}
            emptyTitle="No attendance recorded"
            columns={[
              { header: "Date", cell: (a) => formatDate(a.date) },
              { header: "Status", cell: (a) => <Badge>{a.status}</Badge> },
              { header: "Note", cell: (a) => a.note ?? "—" },
            ]}
          />
        </Card>

        <Card>
          <h2 className="border-b border-slate-100 px-6 py-4 text-sm font-semibold text-slate-700">Weekly schedule</h2>
          {classRoom && classRoom.timetableSlots.length > 0 ? (
            <ul className="divide-y divide-slate-100">
              {classRoom.timetableSlots.map((slot) => (
                <li key={slot.id} className="flex items-center justify-between px-6 py-3 text-sm">
                  <span className="font-medium text-slate-800">{slot.subject.name}</span>
                  <span className="text-slate-500">
                    {humanize(slot.dayOfWeek)} · {slot.startTime}–{slot.endTime}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-6 py-10 text-center text-sm text-slate-400">The timetable hasn't been published yet.</p>
          )}
        </Card>
      </div>

      {submitting && (
        <SubmitAssignmentModal
          assignment={submitting}
          studentId={student.id}
          onClose={() => setSubmitting(null)}
          onSubmitted={async () => {
            setSubmitting(null);
            setNotice("Assignment submitted — the teacher will review it.");
            await load();
          }}
        />
      )}
    </div>
  );
}

function SubmitAssignmentModal({ assignment, studentId, onClose, onSubmitted }: {
  assignment: PortalAssignment;
  studentId: string;
  onClose: () => void;
  onSubmitted: () => Promise<void>;
}) {
  const [content, setContent] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await post("/portal/assignments/submit", {
        assignmentId: assignment.id,
        studentId,
        content,
        linkUrl: linkUrl || undefined,
      });
      await onSubmitted();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to submit");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title={`Submit — ${assignment.title}`} onClose={onClose} wide>
      <form onSubmit={onSubmit} className="space-y-4">
        <p className="whitespace-pre-wrap rounded bg-slate-50 p-3 text-sm text-slate-600">{assignment.instructions}</p>
        <Field label="Your child's work">
          <textarea
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            rows={6}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            required
            placeholder="Type or paste the work here…"
          />
        </Field>
        <Field label="Link to a file (optional)" hint="e.g. a Google Drive or photo link">
          <Input type="url" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>Submit assignment</Button>
        </div>
      </form>
    </Modal>
  );
}
