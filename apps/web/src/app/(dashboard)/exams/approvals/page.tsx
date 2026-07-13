"use client";

import { useCallback, useEffect, useState } from "react";
import { get, post, getSession, ApiClientError } from "@/lib/api";
import { humanize } from "@/lib/format";
import { Badge, Button, Card, ErrorNote, PageHeader } from "@/components/ui";
import { DataTable } from "@/components/data-table";

/**
 * Registrar › Result approvals. Approving locks the marks permanently;
 * rejecting (with a note) reopens them for the teacher to correct.
 */

interface SubmissionRow {
  id: string;
  status: "SUBMITTED" | "APPROVED" | "REJECTED";
  submittedAt: string;
  reviewedAt?: string | null;
  note?: string | null;
  className: string;
  subjectName: string;
  teacherName: string;
  exam: { name: string; category: string; term: { name: string } };
}

export default function ApprovalsPage() {
  const role = getSession()?.user.role;
  const canReview = role === "SUPER_ADMIN" || role === "ADMIN" || role === "REGISTRAR";
  const [rows, setRows] = useState<SubmissionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => get<SubmissionRow[]>("/exams/submissions").then(setRows), []);
  useEffect(() => {
    void load();
  }, [load]);

  async function review(row: SubmissionRow, action: "APPROVE" | "REJECT") {
    let note: string | undefined;
    if (action === "REJECT") {
      note = window.prompt("Reason for rejection (the teacher will see this):") ?? undefined;
      if (note === undefined) return; // cancelled
    }
    setBusy(row.id);
    setError(null);
    try {
      await post(`/exams/submissions/${row.id}/review`, { action, note });
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Review failed");
    } finally {
      setBusy(null);
    }
  }

  const pending = rows?.filter((r) => r.status === "SUBMITTED") ?? [];
  const reviewed = rows?.filter((r) => r.status !== "SUBMITTED") ?? [];

  return (
    <div>
      <PageHeader
        title="Result approvals"
        subtitle="Teachers send graded assessments here; approval locks the marks permanently"
      />
      <ErrorNote message={error} />

      <Card className="mt-4">
        <h2 className="border-b border-slate-100 px-6 py-4 text-sm font-semibold text-slate-700">
          Awaiting review ({pending.length})
        </h2>
        <DataTable
          loading={!rows}
          rows={pending}
          keyFor={(r) => r.id}
          emptyTitle="Nothing awaiting review"
          emptyHint="When a teacher sends results, they appear here."
          columns={[
            { header: "Assessment", cell: (r) => <span className="font-medium text-slate-900">{r.exam.name}</span> },
            { header: "Type", cell: (r) => <Badge tone="gray">{humanize(r.exam.category)}</Badge> },
            { header: "Class", cell: (r) => r.className },
            { header: "Subject", cell: (r) => r.subjectName },
            { header: "Teacher", cell: (r) => r.teacherName },
            { header: "Sent", cell: (r) => new Date(r.submittedAt).toLocaleString() },
            {
              header: "",
              cell: (r) =>
                canReview ? (
                  <span className="flex gap-2">
                    <Button className="!px-3 !py-1 text-xs" loading={busy === r.id} onClick={() => void review(r, "APPROVE")}>
                      Approve
                    </Button>
                    <Button variant="danger" className="!px-3 !py-1 text-xs" loading={busy === r.id} onClick={() => void review(r, "REJECT")}>
                      Reject
                    </Button>
                  </span>
                ) : (
                  <Badge tone="yellow">Pending</Badge>
                ),
            },
          ]}
        />
      </Card>

      <Card className="mt-6">
        <h2 className="border-b border-slate-100 px-6 py-4 text-sm font-semibold text-slate-700">History</h2>
        <DataTable
          loading={!rows}
          rows={reviewed}
          keyFor={(r) => r.id}
          emptyTitle="No reviewed submissions yet"
          columns={[
            { header: "Assessment", cell: (r) => r.exam.name },
            { header: "Class", cell: (r) => r.className },
            { header: "Subject", cell: (r) => r.subjectName },
            { header: "Teacher", cell: (r) => r.teacherName },
            { header: "Status", cell: (r) => <Badge>{r.status}</Badge> },
            { header: "Note", cell: (r) => r.note ?? "—" },
            { header: "Reviewed", cell: (r) => (r.reviewedAt ? new Date(r.reviewedAt).toLocaleString() : "—") },
          ]}
        />
      </Card>
    </div>
  );
}
