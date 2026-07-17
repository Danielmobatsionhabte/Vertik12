"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import type { Paginated } from "@vertik12/shared";
import { FEE_FREQUENCIES, INVOICE_STATUSES, PAYMENT_METHODS, PAYMENT_PERIODS, PAYMENT_STATUSES } from "@vertik12/shared";
import { get, post, del, getSession, ApiClientError } from "@/lib/api";
import { useGrades } from "@/lib/grades";
import { formatDate, formatMoney, fullName, gradeLabel, humanize } from "@/lib/format";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Select, StatCard } from "@/components/ui";
import { DataTable, Pager } from "@/components/data-table";

interface InvoiceRow {
  id: string;
  number: string;
  status: string;
  dueDate: string;
  currency: string;
  total: number;
  paid: number;
  balance: number;
  student: { firstName: string; lastName: string; admissionNo: string; gradeLevel: string };
}

// ======== fee structures: per-grade / per-year payment amounts ========

interface FeeStructureRow {
  id: string;
  name: string;
  gradeLevel: string | null;
  amount: number;
  frequency: string;
  description?: string | null;
}
interface YearOption { id: string; name: string; isActive: boolean }

/**
 * Administration: define how much students pay per grade and academic year
 * (monthly, termly, annual). The registrar's "Collect payment" and bulk
 * invoicing pull from these presets — amounts vary by grade.
 */
function FeeStructuresModal({ canManage, onClose }: { canManage: boolean; onClose: () => void }) {
  const grades = useGrades();
  const [fees, setFees] = useState<FeeStructureRow[] | null>(null);
  const [years, setYears] = useState<YearOption[]>([]);
  const [form, setForm] = useState({ name: "", gradeLevel: "", amount: "", frequency: "MONTHLY", academicYearId: "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => get<FeeStructureRow[]>("/finance/fee-structures").then(setFees), []);
  useEffect(() => {
    void load();
    get<YearOption[]>("/academics/years").then((ys) => {
      setYears(ys);
      const active = ys.find((y) => y.isActive) ?? ys[0];
      if (active) setForm((f) => ({ ...f, academicYearId: active.id }));
    });
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await post("/finance/fee-structures", {
        name: form.name,
        gradeLevel: form.gradeLevel || undefined,
        amount: Math.round(parseFloat(form.amount) * 100),
        frequency: form.frequency,
        academicYearId: form.academicYearId,
      });
      setForm((f) => ({ ...f, name: "", gradeLevel: "", amount: "" }));
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to create fee");
    } finally {
      setSaving(false);
    }
  }

  async function remove(fee: FeeStructureRow) {
    if (!window.confirm(`Remove the preset "${fee.name}"? Existing invoices keep their history.`)) return;
    setError(null);
    try {
      await del(`/finance/fee-structures/${fee.id}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to remove fee");
    }
  }

  return (
    <Modal open title="Fee structures — payments per grade & academic year" onClose={onClose} wide>
      <div className="space-y-5">
        <DataTable
          loading={!fees}
          rows={fees ?? []}
          keyFor={(f) => f.id}
          emptyTitle="No fee structures for the active year"
          columns={[
            { header: "Fee", cell: (f) => <span className="font-medium text-slate-900">{f.name}</span> },
            {
              header: "Grade",
              cell: (f) => f.gradeLevel
                ? <Badge tone="brand">{gradeLabel(f.gradeLevel)}</Badge>
                : <Badge tone="gray">All grades</Badge>,
            },
            { header: "Frequency", cell: (f) => humanize(f.frequency) },
            { header: "Amount", align: "right", cell: (f) => <span className="font-medium">{formatMoney(f.amount)}</span> },
            ...(canManage
              ? [{
                  header: "",
                  cell: (f: FeeStructureRow) => (
                    <button className="text-xs font-medium text-rose-600 hover:underline" onClick={() => void remove(f)}>
                      Remove
                    </button>
                  ),
                }]
              : []),
          ]}
        />

        {canManage ? (
          <form onSubmit={add} className="space-y-3 rounded-lg bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Add a fee preset</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name"><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Tuition — Grade 9" required maxLength={150} /></Field>
              <Field label="Grade">
                <Select value={form.gradeLevel} onChange={(e) => setForm((f) => ({ ...f, gradeLevel: e.target.value }))}>
                  <option value="">All grades</option>
                  {grades.map((g) => <option key={g.code} value={g.code}>{g.name}</option>)}
                </Select>
              </Field>
              <Field label="Amount (USD)"><Input type="number" step="0.01" min="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} required /></Field>
              <Field label="Frequency">
                <Select value={form.frequency} onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value }))}>
                  {FEE_FREQUENCIES.map((fr) => <option key={fr} value={fr}>{humanize(fr)}</option>)}
                </Select>
              </Field>
              <Field label="Academic year">
                <Select value={form.academicYearId} onChange={(e) => setForm((f) => ({ ...f, academicYearId: e.target.value }))} required>
                  {years.map((y) => <option key={y.id} value={y.id}>{y.name}{y.isActive ? " (current)" : ""}</option>)}
                </Select>
              </Field>
            </div>
            <ErrorNote message={error} />
            <div className="flex justify-end">
              <Button type="submit" loading={saving}>Add fee structure</Button>
            </div>
          </form>
        ) : (
          <>
            <ErrorNote message={error} />
            <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
              Presets are managed by the administration. You can collect at these amounts or enter a custom amount while collecting.
            </p>
          </>
        )}
        <p className="text-xs text-slate-400">
          Monthly fees power the registrar's monthly/yearly collection; termly and annual fees are used by bulk invoicing.
          Grade-specific fees make payments vary by grade within the same academic year.
        </p>
      </div>
    </Modal>
  );
}

interface StudentOption {
  id: string;
  firstName: string;
  lastName: string;
  admissionNo: string;
  gradeLevel: string;
}

interface CollectReceipt {
  paymentId: string;
  number: string;
  student: string;
  period: string;
  subtotal: number;
  discountPercent: number;
  discount: number;
  total: number;
  method: string;
  note: string | null;
}

/**
 * Registrar/Admin cashier flow: pick a student, choose monthly or
 * yearly-at-once (yearly applies the admin-configured discount
 * automatically), take the preset amount for the student's grade or type a
 * custom one, optionally add a note — invoice + payment are created together.
 */
function CollectPaymentModal({ open, onClose, onCollected }: {
  open: boolean;
  onClose: () => void;
  onCollected: (message: string, receipt: CollectReceipt) => void;
}) {
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<StudentOption[]>([]);
  const [student, setStudent] = useState<StudentOption | null>(null);
  const [fees, setFees] = useState<FeeStructureRow[]>([]);
  const [period, setPeriod] = useState<string>("MONTHLY");
  const [months, setMonths] = useState("1");
  const [amountMode, setAmountMode] = useState<"PRESET" | "CUSTOM">("PRESET");
  const [customAmount, setCustomAmount] = useState("");
  const [method, setMethod] = useState<string>("CASH");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    get<FeeStructureRow[]>("/finance/fee-structures").then(setFees).catch(() => setFees([]));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const params = new URLSearchParams({ pageSize: "30", status: "ACTIVE" });
      if (search) params.set("search", search);
      get<Paginated<StudentOption>>(`/students?${params}`)
        .then((d) => setOptions(d.items))
        .catch(() => setOptions([]));
    }, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [open, search]);

  // The admin's preset for the selected student's grade — what "no
  // customization" would charge (before any yearly discount).
  const preset = useMemo(() => {
    if (!student) return null;
    const applicable = fees.filter((f) => !f.gradeLevel || f.gradeLevel === student.gradeLevel);
    const monthlyTotal = applicable.filter((f) => f.frequency === "MONTHLY").reduce((s, f) => s + f.amount, 0);
    const annualTotal = applicable.filter((f) => f.frequency === "ANNUAL").reduce((s, f) => s + f.amount, 0);
    if (period === "MONTHLY") {
      return monthlyTotal > 0 ? monthlyTotal * Number(months || "1") : null;
    }
    return monthlyTotal > 0 || annualTotal > 0 ? monthlyTotal * 12 + annualTotal : null;
  }, [student, fees, period, months]);

  function reset() {
    setStudent(null);
    setSearch("");
    setReference("");
    setNote("");
    setMonths("1");
    setCustomAmount("");
    setAmountMode("PRESET");
    setError(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!student) {
      setError("Select the student from the list below first");
      return;
    }
    if (amountMode === "CUSTOM" && !(parseFloat(customAmount) > 0)) {
      setError("Enter a valid custom amount");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { receipt } = await post<{ receipt: CollectReceipt }>("/finance/payments/collect", {
        studentId: student.id,
        period,
        method,
        reference: reference || undefined,
        note: note || undefined,
        ...(amountMode === "CUSTOM" ? { customAmount: Math.round(parseFloat(customAmount) * 100) } : {}),
        ...(period === "MONTHLY" ? { months: Number(months) } : {}),
      });
      const discountNote = receipt.discount > 0
        ? ` (${receipt.discountPercent}% yearly discount saved ${formatMoney(receipt.discount)})`
        : "";
      onCollected(`Collected ${formatMoney(receipt.total)} from ${receipt.student} — receipt ${receipt.number}${discountNote}.`, receipt);
      reset();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Collection failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} title="Collect fee payment" onClose={onClose} wide>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Student" hint="Search by name or admission number, then click the student to select them">
          <Input placeholder="Start typing to search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </Field>

        {student ? (
          <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm">
            <span className="font-medium text-emerald-900">
              ✓ {student.firstName} {student.lastName} — {student.admissionNo} · {gradeLabel(student.gradeLevel)}
            </span>
            <button type="button" className="text-xs font-medium text-emerald-700 underline" onClick={() => setStudent(null)}>
              Change
            </button>
          </div>
        ) : (
          <div className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
            {options.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-400">No matching active students.</p>
            ) : (
              options.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-brand-50"
                  onClick={() => setStudent(s)}
                >
                  <span className="font-medium text-slate-800">{s.firstName} {s.lastName}</span>
                  <span className="text-xs text-slate-500">{s.admissionNo} · {gradeLabel(s.gradeLevel)}</span>
                </button>
              ))
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Payment period" hint="Yearly applies the configured discount">
            <Select value={period} onChange={(e) => setPeriod(e.target.value)}>
              {PAYMENT_PERIODS.map((p) => <option key={p} value={p}>{p === "MONTHLY" ? "Monthly" : "Yearly (at once)"}</option>)}
            </Select>
          </Field>
          {period === "MONTHLY" ? (
            <Field label="Months" hint="Families may pay several months in advance">
              <Select value={months} onChange={(e) => setMonths(e.target.value)}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>{m === 1 ? "1 month" : `${m} months (in advance)`}</option>
                ))}
              </Select>
            </Field>
          ) : <span />}
        </div>

        <fieldset className="space-y-2 rounded-lg border border-slate-200 p-4">
          <legend className="px-1 text-sm font-medium text-slate-700">Amount</legend>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="radio" className="mt-0.5" checked={amountMode === "PRESET"} onChange={() => setAmountMode("PRESET")} />
            <span>
              Preset for the student&apos;s grade
              {student && (
                <span className="block text-xs text-slate-500">
                  {preset !== null
                    ? <>{formatMoney(preset)}{period === "YEARLY" ? " before the yearly discount" : ""} for {gradeLabel(student.gradeLevel)}</>
                    : `No preset is configured for ${gradeLabel(student.gradeLevel)} — use a custom amount`}
                </span>
              )}
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="radio" checked={amountMode === "CUSTOM"} onChange={() => setAmountMode("CUSTOM")} />
            Custom amount (USD)
            <Input
              type="number" step="0.01" min="0.01" className="!w-36"
              value={customAmount}
              onChange={(e) => { setCustomAmount(e.target.value); setAmountMode("CUSTOM"); }}
              placeholder="0.00"
            />
          </label>
        </fieldset>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Method">
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{humanize(m)}</option>)}
            </Select>
          </Field>
          <Field label="Receipt / bank reference (optional)">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />
          </Field>
        </div>

        <Field label="Note (optional)" hint="Shown on the receipt and the transaction detail">
          <textarea
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            rows={2}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Paid by the uncle; includes the outstanding October balance…"
          />
        </Field>

        <ErrorNote message={error} />
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving} disabled={!student}>
            {student ? "Collect payment" : "Select a student first"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ============================ transactions ============================

interface PaymentRow {
  id: string;
  amount: number;
  method: string;
  status: string;
  provider: string;
  providerRef?: string | null;
  note?: string | null;
  paidAt?: string | null;
  createdAt: string;
  refundedAt?: string | null;
  refundReason?: string | null;
  invoice: { id: string; number: string; currency: string; student: { firstName: string; lastName: string; admissionNo: string; gradeLevel: string } };
}

interface PaymentDetail extends PaymentRow {
  recordedByName: string | null;
  refundedByName: string | null;
  invoice: PaymentRow["invoice"] & { items: Array<{ id: string; description: string; amount: number }> };
}

/** Every processed payment; click one for the full detail + printable receipt. */
function TransactionsCard({ isSuperAdmin, refreshKey, onChanged }: {
  isSuperAdmin: boolean;
  refreshKey: number;
  onChanged: () => void;
}) {
  const [data, setData] = useState<Paginated<PaymentRow> | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<PaymentDetail | null>(null);
  const [refunding, setRefunding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: "10" });
    if (status) params.set("status", status);
    if (search) params.set("search", search);
    return get<Paginated<PaymentRow>>(`/finance/payments?${params}`).then(setData);
  }, [page, status, search]);

  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search, refreshKey]);

  async function openDetail(id: string) {
    setError(null);
    setDetail(await get<PaymentDetail>(`/finance/payments/${id}`));
  }

  async function refund() {
    if (!detail) return;
    const reason = window.prompt("Reason for the refund (required, kept in the audit trail):");
    if (reason === null) return;
    if (reason.trim().length < 3) {
      setError("Please give a short reason for the refund");
      return;
    }
    setRefunding(true);
    setError(null);
    try {
      await post(`/finance/payments/${detail.id}/refund`, { reason: reason.trim() });
      await openDetail(detail.id);
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Refund failed");
    } finally {
      setRefunding(false);
    }
  }

  return (
    <Card className="mt-6">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
        <h2 className="mr-auto text-sm font-semibold text-slate-700">Transactions</h2>
        <Input
          placeholder="Search invoice or student…"
          className="max-w-xs"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <Select className="max-w-[170px]" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          {PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
        </Select>
      </div>
      <DataTable
        loading={!data}
        rows={data?.items ?? []}
        keyFor={(p) => p.id}
        emptyTitle="No transactions yet"
        onRowClick={(p) => void openDetail(p.id)}
        columns={[
          { header: "Date", cell: (p) => formatDate(p.paidAt ?? p.createdAt) },
          { header: "Invoice", cell: (p) => <span className="font-mono text-xs">{p.invoice.number}</span> },
          { header: "Student", cell: (p) => <span className="font-medium text-slate-900">{fullName(p.invoice.student)}</span> },
          { header: "Method", cell: (p) => humanize(p.method) },
          { header: "Amount", align: "right", cell: (p) => <span className="font-medium">{formatMoney(p.amount, p.invoice.currency)}</span> },
          { header: "Status", cell: (p) => <Badge>{p.status}</Badge> },
          {
            header: "",
            cell: (p) => (
              <button className="text-xs font-medium text-brand-600 hover:underline" onClick={(e) => { e.stopPropagation(); void openDetail(p.id); }}>
                Details
              </button>
            ),
          },
        ]}
      />
      {data && <Pager page={data.page} totalPages={data.totalPages} onPage={setPage} />}

      <Modal open={!!detail} title={detail ? `Transaction — ${detail.invoice.number}` : ""} onClose={() => setDetail(null)} wide>
        {detail && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-slate-50 p-4 text-sm">
                <p className="text-xs uppercase tracking-wide text-slate-400">Student</p>
                <p className="mt-1 font-medium text-slate-900">{fullName(detail.invoice.student)}</p>
                <p className="text-xs text-slate-500">{detail.invoice.student.admissionNo} · {gradeLabel(detail.invoice.student.gradeLevel)}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-4 text-sm">
                <p className="text-xs uppercase tracking-wide text-slate-400">Payment</p>
                <p className="mt-1 font-medium text-slate-900">{formatMoney(detail.amount, detail.invoice.currency)} · {humanize(detail.method)}</p>
                <p className="text-xs text-slate-500">
                  {formatDate(detail.paidAt ?? detail.createdAt)} · <Badge>{detail.status}</Badge>
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <tbody>
                  {detail.invoice.items.map((it) => (
                    <tr key={it.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-2 text-slate-600">{it.description}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(it.amount, detail.invoice.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              {detail.providerRef && (
                <div><dt className="text-xs text-slate-400">Reference</dt><dd className="font-mono text-xs">{detail.providerRef}</dd></div>
              )}
              {detail.recordedByName && (
                <div><dt className="text-xs text-slate-400">Processed by</dt><dd>{detail.recordedByName}</dd></div>
              )}
              {detail.note && (
                <div className="sm:col-span-2"><dt className="text-xs text-slate-400">Note</dt><dd className="whitespace-pre-wrap">{detail.note}</dd></div>
              )}
              {detail.status === "REFUNDED" && (
                <div className="sm:col-span-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <dt className="text-xs font-semibold text-amber-700">Refunded {detail.refundedAt ? formatDate(detail.refundedAt) : ""}{detail.refundedByName ? ` by ${detail.refundedByName}` : ""}</dt>
                  <dd className="mt-1 text-amber-800">{detail.refundReason}</dd>
                </div>
              )}
            </dl>

            <ErrorNote message={error} />
            <div className="flex flex-wrap justify-end gap-3">
              {isSuperAdmin && detail.status === "SUCCEEDED" && (
                <Button variant="danger" loading={refunding} onClick={() => void refund()}>Refund payment</Button>
              )}
              <Link href={`/finance/receipt/${detail.id}`}>
                <Button variant="secondary">🖨 Print receipt</Button>
              </Link>
              <Button variant="secondary" onClick={() => setDetail(null)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}

interface Overview {
  invoiced: number;
  collected: number;
  outstanding: number;
  overdueCount: number;
  recentPayments: Array<{ id: string; amount: number; method: string; paidAt: string; invoice: { number: string; student: { firstName: string; lastName: string } } }>;
}

export default function FinancePage() {
  const grades = useGrades();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [data, setData] = useState<Paginated<InvoiceRow> | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showFees, setShowFees] = useState(false);
  const [txRefresh, setTxRefresh] = useState(0);
  const role = getSession()?.user.role;
  const canManageFees = role === "ADMIN" || role === "SUPER_ADMIN";

  // record-payment modal state
  const [payInvoice, setPayInvoice] = useState<InvoiceRow | null>(null);
  const [payForm, setPayForm] = useState({ amount: "", method: "CASH", reference: "", note: "" });
  const [payError, setPayError] = useState<string | null>(null);
  const [paySaving, setPaySaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastReceiptId, setLastReceiptId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: "15" });
    if (status) params.set("status", status);
    if (gradeFilter) params.set("gradeLevel", gradeFilter);
    if (search) params.set("search", search);
    try {
      const [inv, ov] = await Promise.all([
        get<Paginated<InvoiceRow>>(`/finance/invoices?${params}`),
        get<Overview>("/finance/overview"),
      ]);
      setData(inv);
      setOverview(ov);
    } finally {
      setLoading(false);
    }
  }, [page, status, gradeFilter, search]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  // Returning from Stripe Checkout (?session_id=…): verify with Stripe via
  // the API, then refresh the invoice + transaction lists.
  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get("session_id");
    if (!sessionId) return;
    window.history.replaceState({}, "", window.location.pathname);
    post<{ status: string; invoiceNumber: string }>("/finance/payments/confirm", { sessionId })
      .then(async (r) => {
        setNotice(
          r.status === "SUCCEEDED"
            ? `Card payment for ${r.invoiceNumber} was received.`
            : `Payment for ${r.invoiceNumber} is still ${r.status.toLowerCase()} — refresh in a moment.`,
        );
        setTxRefresh((n) => n + 1);
        await load();
      })
      .catch((err) => setNotice(err instanceof ApiClientError ? err.message : "Could not verify the payment"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openPayModal(inv: InvoiceRow) {
    setPayInvoice(inv);
    setPayForm({ amount: String(inv.balance / 100), method: "CASH", reference: "", note: "" });
    setPayError(null);
  }

  async function recordPayment(e: FormEvent) {
    e.preventDefault();
    if (!payInvoice) return;
    setPaySaving(true);
    setPayError(null);
    try {
      await post("/finance/payments/manual", {
        invoiceId: payInvoice.id,
        amount: Math.round(parseFloat(payForm.amount) * 100),
        method: payForm.method,
        reference: payForm.reference || undefined,
        note: payForm.note || undefined,
      });
      setPayInvoice(null);
      setNotice(`Payment recorded against ${payInvoice.number}.`);
      setTxRefresh((n) => n + 1);
      await load();
    } catch (err) {
      setPayError(err instanceof ApiClientError ? err.message : "Failed to record payment");
    } finally {
      setPaySaving(false);
    }
  }

  async function checkout(inv: InvoiceRow) {
    try {
      const session = await post<{ checkoutUrl: string; provider: string; simulated: boolean }>(
        "/finance/payments/checkout",
        { invoiceId: inv.id },
      );
      if (session.simulated) {
        setNotice(`Demo gateway approved ${inv.number} instantly (configure STRIPE_SECRET_KEY for real card payments).`);
        setTxRefresh((n) => n + 1);
        await load();
      } else {
        window.location.href = session.checkoutUrl; // → Stripe Checkout
      }
    } catch (err) {
      setNotice(err instanceof ApiClientError ? err.message : "Checkout failed");
    }
  }

  const [showCollect, setShowCollect] = useState(false);

  return (
    <div>
      <PageHeader
        title="Fees & Invoices"
        subtitle="Billing, collections and online payments"
        actions={
          <div className="flex gap-2 print:hidden">
            <Button variant="secondary" onClick={() => window.print()}>🖨 Print invoice report</Button>
            <Button variant="secondary" onClick={() => setShowFees(true)}>Fee structures</Button>
            <Button onClick={() => setShowCollect(true)}>+ Collect payment</Button>
          </div>
        }
      />

      {overview && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Total invoiced" value={formatMoney(overview.invoiced)} />
          <StatCard label="Collected" value={formatMoney(overview.collected)} />
          <StatCard label="Outstanding" value={formatMoney(overview.outstanding)} />
          <StatCard label="Overdue invoices" value={overview.overdueCount} />
        </div>
      )}

      {notice && (
        <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          {notice}
          {lastReceiptId && (
            <Link className="ml-2 font-medium underline" href={`/finance/receipt/${lastReceiptId}`}>
              View / print the receipt
            </Link>
          )}
          <button className="ml-2 underline" onClick={() => { setNotice(null); setLastReceiptId(null); }}>Dismiss</button>
        </div>
      )}

      <Card>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <Input
            placeholder="Search invoice no or student…"
            className="max-w-xs"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
          <Select className="max-w-[200px]" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            {INVOICE_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </Select>
          <Select className="max-w-[170px]" value={gradeFilter} onChange={(e) => { setGradeFilter(e.target.value); setPage(1); }}>
            <option value="">All grades</option>
            {grades.map((g) => <option key={g.code} value={g.code}>{g.name}</option>)}
          </Select>
        </div>

        <DataTable
          loading={loading}
          rows={data?.items ?? []}
          keyFor={(i) => i.id}
          emptyTitle="No invoices found"
          columns={[
            { header: "Invoice", cell: (i) => <span className="font-mono text-xs">{i.number}</span> },
            { header: "Student", cell: (i) => <span className="font-medium text-slate-900">{fullName(i.student)}</span> },
            { header: "Due", cell: (i) => formatDate(i.dueDate) },
            { header: "Total", align: "right", cell: (i) => formatMoney(i.total, i.currency) },
            { header: "Paid", align: "right", cell: (i) => <span className="text-emerald-600">{formatMoney(i.paid, i.currency)}</span> },
            { header: "Balance", align: "right", cell: (i) => <span className={i.balance > 0 ? "text-rose-600" : ""}>{formatMoney(i.balance, i.currency)}</span> },
            { header: "Status", cell: (i) => <Badge>{i.status}</Badge> },
            {
              header: "",
              cell: (i) =>
                i.balance > 0 && i.status !== "VOID" ? (
                  <span className="flex gap-2">
                    <button className="text-xs font-medium text-brand-600 hover:underline" onClick={(e) => { e.stopPropagation(); openPayModal(i); }}>
                      Record payment
                    </button>
                    <button className="text-xs font-medium text-slate-500 hover:underline" onClick={(e) => { e.stopPropagation(); void checkout(i); }}>
                      Pay online
                    </button>
                  </span>
                ) : null,
            },
          ]}
        />
        {data && <Pager page={data.page} totalPages={data.totalPages} onPage={setPage} />}
      </Card>

      <TransactionsCard
        isSuperAdmin={role === "SUPER_ADMIN"}
        refreshKey={txRefresh}
        onChanged={() => void load()}
      />

      {showFees && (
        <FeeStructuresModal
          canManage={canManageFees}
          onClose={() => setShowFees(false)}
        />
      )}

      <CollectPaymentModal
        open={showCollect}
        onClose={() => setShowCollect(false)}
        onCollected={(msg, receipt) => {
          setNotice(msg);
          setLastReceiptId(receipt.paymentId);
          setShowCollect(false);
          setTxRefresh((n) => n + 1);
          void load();
        }}
      />

      <Modal open={!!payInvoice} title={`Record payment — ${payInvoice?.number ?? ""}`} onClose={() => setPayInvoice(null)}>
        {payInvoice && (
          <form onSubmit={recordPayment} className="space-y-4">
            <p className="text-sm text-slate-600">
              {fullName(payInvoice.student)} · outstanding balance{" "}
              <span className="font-semibold">{formatMoney(payInvoice.balance, payInvoice.currency)}</span>
            </p>
            <Field label={`Amount (${payInvoice.currency})`}>
              <Input type="number" step="0.01" min="0.01" max={payInvoice.balance / 100}
                value={payForm.amount} onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))} required />
            </Field>
            <Field label="Method">
              <Select value={payForm.method} onChange={(e) => setPayForm((f) => ({ ...f, method: e.target.value }))}>
                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{humanize(m)}</option>)}
              </Select>
            </Field>
            <Field label="Reference (receipt / bank ref)">
              <Input value={payForm.reference} onChange={(e) => setPayForm((f) => ({ ...f, reference: e.target.value }))} maxLength={100} />
            </Field>
            <Field label="Note (optional)">
              <Input value={payForm.note} onChange={(e) => setPayForm((f) => ({ ...f, note: e.target.value }))} maxLength={500} />
            </Field>
            <ErrorNote message={payError} />
            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => setPayInvoice(null)}>Cancel</Button>
              <Button type="submit" loading={paySaving}>Record payment</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
