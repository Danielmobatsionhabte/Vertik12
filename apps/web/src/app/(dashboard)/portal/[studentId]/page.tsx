"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { ATTACHMENT_ACCEPT, type AttachmentInput } from "@vertik12/shared";
import { get, post, ApiClientError } from "@/lib/api";
import { fileToAttachment, downloadAttachment } from "@/lib/files";
import { formatDate, formatMoney, fullName, gradeLabel, humanize } from "@/lib/format";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Spinner, StatCard } from "@/components/ui";
import { DataTable, Pager } from "@/components/data-table";

interface PortalAssignment {
  id: string;
  title: string;
  instructions: string;
  dueDate: string;
  subject: string;
  teacher: string | null;
  overdue: boolean;
  attachmentName?: string | null;
  mySubmission: { id: string; submittedAt: string; feedback?: string | null; grade?: string | null; attachmentName?: string | null } | null;
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
  // Long lists paginate client-side so the page never grows unbounded.
  const [invoicePage, setInvoicePage] = useState(1);
  const [homeworkPage, setHomeworkPage] = useState(1);
  const PER_PAGE = 8;

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

  // Coming back from Stripe Checkout: the success URL carries
  // ?session_id=…; the API verifies the session with Stripe and marks the
  // payment succeeded, then the page refreshes to show the settled invoice.
  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get("session_id");
    if (!sessionId) return;
    window.history.replaceState({}, "", window.location.pathname);
    post<{ status: string; invoiceNumber: string }>("/finance/payments/confirm", { sessionId })
      .then(async (r) => {
        if (r.status === "SUCCEEDED") {
          setNotice(`Payment for ${r.invoiceNumber} was received — thank you!`);
          await load();
        } else {
          setNotice(`Payment for ${r.invoiceNumber} is still ${r.status.toLowerCase()} — refresh in a moment.`);
        }
      })
      .catch((err) => setNotice(err instanceof ApiClientError ? err.message : "Could not verify the payment"));
  }, [load]);

  async function payOnline(invoiceId: string, number: string) {
    setPaying(invoiceId);
    setNotice(null);
    try {
      // Send the family back to this exact page after paying (or cancelling).
      const pageUrl = window.location.origin + window.location.pathname;
      const session = await post<{ checkoutUrl: string; simulated: boolean }>("/portal/pay", {
        invoiceId,
        successUrl: pageUrl,
        cancelUrl: pageUrl,
      });
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
            rows={invoices.slice((invoicePage - 1) * PER_PAGE, invoicePage * PER_PAGE)}
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
          <Pager page={invoicePage} totalPages={Math.ceil(invoices.length / PER_PAGE)} onPage={setInvoicePage} />
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
              {homework.slice((homeworkPage - 1) * PER_PAGE, homeworkPage * PER_PAGE).map((a) => (
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
                  {a.attachmentName && (
                    <button
                      className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
                      onClick={() => downloadAttachment(`/portal/assignments/${a.id}/attachment`, a.attachmentName ?? undefined).catch((e) => setNotice(e.message))}
                    >
                      📎 {a.attachmentName} (from the teacher)
                    </button>
                  )}
                  {a.mySubmission?.attachmentName && (
                    <p className="mt-1 text-xs text-slate-400">Submitted document: {a.mySubmission.attachmentName}</p>
                  )}
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
          {homework && (
            <Pager page={homeworkPage} totalPages={Math.ceil(homework.length / PER_PAGE)} onPage={setHomeworkPage} />
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
  const [attachment, setAttachment] = useState<AttachmentInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      setAttachment(await fileToAttachment(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the file");
      e.target.value = "";
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!content.trim() && !attachment) {
      setError("Type the work or attach a document");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await post("/portal/assignments/submit", {
        assignmentId: assignment.id,
        studentId,
        content,
        linkUrl: linkUrl || undefined,
        ...(attachment ? { attachment } : {}),
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
        <Field label="Your child's work" hint="Optional if you attach a document below">
          <textarea
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            rows={6}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Type or paste the work here…"
          />
        </Field>
        <Field label="Upload a document (optional)" hint="PDF, JPG, PNG or Word — max 5 MB; the teacher sees it with the submission">
          <div className="space-y-2">
            <Input type="file" accept={ATTACHMENT_ACCEPT} onChange={(e) => void pickFile(e)} />
            {attachment && (
              <p className="flex items-center gap-2 text-xs text-slate-600">
                📎 {attachment.name}
                <button type="button" className="text-rose-600 underline" onClick={() => setAttachment(null)}>Remove</button>
              </p>
            )}
          </div>
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
