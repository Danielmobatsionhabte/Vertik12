"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { get, post, patch, getSession, ApiClientError } from "@/lib/api";
import { formatMoney, monthLabel } from "@/lib/format";
import { Badge, Button, Card, ErrorNote, Modal, PageHeader, Spinner } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { Icon } from "@/components/icons";
import { EditPayslipModal, type EditablePayslip } from "./edit-payslip-modal";

interface RunRow {
  id: string;
  month: number;
  year: number;
  status: "DRAFT" | "APPROVED" | "PAID";
  createdAt: string;
  _count: { payslips: number };
  payslips: Array<{ net: number; currency: string }>;
}

interface RunDetail extends Omit<RunRow, "payslips" | "_count"> {
  totals: { gross: number; deductions: number; net: number };
  payslips: Array<{
    id: string;
    gross: number;
    totalDeductions: number;
    net: number;
    bonus: number;
    currency: string;
    status: string;
    basicSalary: number;
    allowances: Array<{ name: string; amount: number }>;
    deductions: Array<{ name: string; amount: number }>;
    staff: { staffNo: string; designation: string; user: { firstName: string; lastName: string } };
  }>;
}

export default function PayrollPage() {
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [emailingId, setEmailingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditablePayslip | null>(null);
  const role = getSession()?.user.role;
  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";

  const load = useCallback(() => get<RunRow[]>("/payroll/runs").then(setRuns), []);
  useEffect(() => {
    void load();
  }, [load]);

  async function openRun(id: string) {
    setDetailLoading(true);
    try {
      setDetail(await get<RunDetail>(`/payroll/runs/${id}`));
    } finally {
      setDetailLoading(false);
    }
  }

  async function createRun() {
    setError(null);
    setBusy(true);
    const now = new Date();
    try {
      const run = await post<RunDetail>("/payroll/runs", { month: now.getMonth() + 1, year: now.getFullYear() });
      await load();
      await openRun(run.id);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to create run");
    } finally {
      setBusy(false);
    }
  }

  /** Admin sets a one-off bonus while the run is a draft; totals recompute. */
  async function setBonus(run: RunDetail, payslipId: string, current: number) {
    const input = window.prompt("Bonus amount in USD (0 to remove):", String(current / 100));
    if (input === null) return;
    const bonus = Math.round(parseFloat(input || "0") * 100);
    if (Number.isNaN(bonus) || bonus < 0) {
      setError("Enter a valid non-negative amount");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await patch(`/payroll/payslips/${payslipId}/bonus`, { bonus });
      await openRun(run.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to set bonus");
    } finally {
      setBusy(false);
    }
  }

  async function transition(run: RunDetail, action: "approve" | "pay") {
    setBusy(true);
    setError(null);
    try {
      await post(`/payroll/runs/${run.id}/${action}`);
      await load();
      await openRun(run.id);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  /** Email one paystub straight to the employee's account address. */
  async function emailPayslip(payslipId: string, name: string) {
    setEmailingId(payslipId);
    setNotice(null);
    try {
      const result = await post<{ message: string }>(`/payroll/payslips/${payslipId}/email`, {});
      setNotice(`${name}: ${result.message}`);
    } catch (err) {
      setNotice(err instanceof ApiClientError ? err.message : "Failed to send the email");
    } finally {
      setEmailingId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Payroll"
        subtitle="Monthly runs snapshot each employee's salary structure into payslips: Draft → Approved → Paid"
        actions={
          <>
            <Link href="/payroll/report">
              <Button variant="secondary"><Icon name="clipboard" className="h-4 w-4" /> Report</Button>
            </Link>
            {isAdmin && <Button onClick={createRun} loading={busy}>+ Run payroll for this month</Button>}
          </>
        }
      />
      <ErrorNote message={error} />
      {notice && (
        <div className="mt-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          {notice} <button className="ml-2 underline" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      <Card className="mt-4">
        <DataTable
          loading={!runs}
          rows={runs ?? []}
          keyFor={(r) => r.id}
          onRowClick={(r) => void openRun(r.id)}
          emptyTitle="No payroll runs yet"
          emptyHint="Set salary structures on staff, then run payroll for the month."
          columns={[
            { header: "Period", cell: (r) => <span className="font-medium text-slate-900">{monthLabel(r.month, r.year)}</span> },
            { header: "Payslips", align: "right", cell: (r) => r._count.payslips },
            { header: "Total net", align: "right", cell: (r) => formatMoney(r.payslips.reduce((s, p) => s + p.net, 0), r.payslips[0]?.currency ?? "USD") },
            { header: "Status", cell: (r) => <Badge>{r.status}</Badge> },
          ]}
        />
      </Card>

      <Modal open={!!detail || detailLoading} title={detail ? `Payroll — ${monthLabel(detail.month, detail.year)}` : "Loading…"} onClose={() => setDetail(null)} wide>
        {detailLoading || !detail ? (
          <div className="flex justify-center py-12 text-brand-600"><Spinner /></div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-6 text-sm">
                <span>Gross <strong className="tabular-nums">{formatMoney(detail.totals.gross)}</strong></span>
                <span>Deductions <strong className="tabular-nums text-rose-600">−{formatMoney(detail.totals.deductions)}</strong></span>
                <span>Net <strong className="tabular-nums text-emerald-600">{formatMoney(detail.totals.net)}</strong></span>
              </div>
              <div className="flex items-center gap-2">
                <Badge>{detail.status}</Badge>
                {isAdmin && detail.status === "DRAFT" && <Button loading={busy} onClick={() => transition(detail, "approve")}>Approve run</Button>}
                {isAdmin && detail.status === "APPROVED" && <Button loading={busy} onClick={() => transition(detail, "pay")}>Mark disbursed</Button>}
              </div>
            </div>

            <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-1.5 font-medium">Employee</th>
                    <th className="px-3 py-1.5 text-right font-medium">Basic</th>
                    <th className="px-3 py-1.5 text-right font-medium">Allowances</th>
                    <th className="px-3 py-1.5 text-right font-medium">Bonus</th>
                    <th className="px-3 py-1.5 text-right font-medium">Deductions</th>
                    <th className="px-3 py-1.5 text-right font-medium">Net pay</th>
                    <th className="px-3 py-1.5 font-medium">Status</th>
                    <th className="px-3 py-1.5 font-medium">Paystub</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.payslips.map((p) => (
                    <tr key={p.id} className="border-t border-slate-100">
                      <td className="px-3 py-1.5">
                        <p className="font-medium text-slate-800">{p.staff.user.firstName} {p.staff.user.lastName}</p>
                        <p className="text-xs text-slate-400">{p.staff.staffNo} · {p.staff.designation}</p>
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(p.basicSalary, p.currency)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums" title={p.allowances.map((a) => `${a.name}: ${formatMoney(a.amount)}`).join("\n")}>
                        +{formatMoney(p.gross - p.basicSalary - p.bonus, p.currency)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {detail.status === "DRAFT" ? (
                          <button
                            className="font-medium text-brand-600 hover:underline"
                            onClick={() => void setBonus(detail, p.id, p.bonus)}
                            title="Set a one-off bonus for this payslip"
                          >
                            {p.bonus > 0 ? `+${formatMoney(p.bonus, p.currency)}` : "+ Add"}
                          </button>
                        ) : p.bonus > 0 ? (
                          `+${formatMoney(p.bonus, p.currency)}`
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-rose-600" title={p.deductions.map((d) => `${d.name}: ${formatMoney(d.amount)}`).join("\n")}>
                        −{formatMoney(p.totalDeductions, p.currency)}
                      </td>
                      <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-emerald-700">{formatMoney(p.net, p.currency)}</td>
                      <td className="px-3 py-1.5"><Badge>{p.status}</Badge></td>
                      <td className="px-3 py-1.5">
                        <span className="flex items-center gap-2 whitespace-nowrap">
                          {isAdmin && detail.status === "DRAFT" && (
                            <button
                              className="text-xs font-medium text-brand-600 hover:underline"
                              title="Edit this payslip's amounts"
                              onClick={() => setEditing({
                                id: p.id,
                                basicSalary: p.basicSalary,
                                bonus: p.bonus,
                                currency: p.currency,
                                allowances: p.allowances,
                                deductions: p.deductions,
                                staffName: `${p.staff.user.firstName} ${p.staff.user.lastName}`,
                              })}
                            >
                              <Icon name="edit" className="mr-0.5 inline h-3.5 w-3.5" />Edit
                            </button>
                          )}
                          <Link
                            href={`/payroll/payslip/${p.id}`}
                            className="text-xs font-medium text-brand-600 hover:underline"
                            title="Open the printable paystub"
                          >
                            <Icon name="printer" className="mr-0.5 inline h-3.5 w-3.5" />Print
                          </Link>
                          {isAdmin && (
                            <button
                              className="text-xs font-medium text-slate-500 hover:underline disabled:opacity-50"
                              disabled={emailingId === p.id}
                              onClick={() => void emailPayslip(p.id, `${p.staff.user.firstName} ${p.staff.user.lastName}`)}
                              title="Email the paystub to the employee"
                            >
                              <Icon name="mail" className="mr-0.5 inline h-3.5 w-3.5" />Email
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-400">Hover the allowance/deduction cells to see the component breakdown captured on each payslip.</p>
          </div>
        )}
      </Modal>

      <EditPayslipModal
        payslip={editing}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          if (detail) await openRun(detail.id);
          await load();
        }}
      />
    </div>
  );
}
