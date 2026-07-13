"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Paginated } from "@vertik12/shared";
import { FEE_FREQUENCIES, GRADE_LEVELS, INVOICE_STATUSES, PAYMENT_METHODS, PAYMENT_PERIODS } from "@vertik12/shared";
import { get, post, ApiClientError } from "@/lib/api";
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
 * Registrar/Admin: define how much students pay per grade and academic
 * year (monthly, termly, annual). The registrar's "Collect payment" and
 * bulk invoicing pull from these.
 */
function FeeStructuresModal({ onClose }: { onClose: () => void }) {
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
          ]}
        />

        <form onSubmit={add} className="space-y-3 rounded-lg bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Add a fee</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Tuition — Grade 9" required /></Field>
            <Field label="Grade">
              <Select value={form.gradeLevel} onChange={(e) => setForm((f) => ({ ...f, gradeLevel: e.target.value }))}>
                <option value="">All grades</option>
                {GRADE_LEVELS.map((g) => <option key={g} value={g}>{gradeLabel(g)}</option>)}
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
  number: string;
  student: string;
  period: string;
  subtotal: number;
  discountPercent: number;
  discount: number;
  total: number;
  method: string;
}

/**
 * Registrar cashier flow: pick a student, choose monthly or yearly-at-once
 * (yearly applies the admin-configured discount automatically), record how
 * they paid — invoice + payment are created together.
 */
function CollectPaymentModal({ open, onClose, onCollected }: {
  open: boolean;
  onClose: () => void;
  onCollected: (message: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<StudentOption[]>([]);
  const [studentId, setStudentId] = useState("");
  const [period, setPeriod] = useState<string>("MONTHLY");
  const [months, setMonths] = useState("1");
  const [method, setMethod] = useState<string>("CASH");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!studentId) {
      setError("Choose a student first");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { receipt } = await post<{ receipt: CollectReceipt }>("/finance/payments/collect", {
        studentId, period, method, reference: reference || undefined,
        ...(period === "MONTHLY" ? { months: Number(months) } : {}),
      });
      const discountNote = receipt.discount > 0
        ? ` (${receipt.discountPercent}% yearly discount saved ${formatMoney(receipt.discount)})`
        : "";
      onCollected(`Collected ${formatMoney(receipt.total)} from ${receipt.student} — receipt ${receipt.number}${discountNote}.`);
      setStudentId("");
      setReference("");
      setMonths("1");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Collection failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} title="Collect fee payment" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Student" hint="Search by name or admission number">
          <Input placeholder="Start typing to search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </Field>
        <Select value={studentId} onChange={(e) => setStudentId(e.target.value)} required size={5}>
          {options.map((s) => (
            <option key={s.id} value={s.id}>
              {s.firstName} {s.lastName} — {s.admissionNo} (Grade {s.gradeLevel})
            </option>
          ))}
        </Select>
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
          <Field label="Method">
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{humanize(m)}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Receipt / bank reference (optional)">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>Collect payment</Button>
        </div>
      </form>
    </Modal>
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
  const [overview, setOverview] = useState<Overview | null>(null);
  const [data, setData] = useState<Paginated<InvoiceRow> | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showFees, setShowFees] = useState(false);

  // record-payment modal state
  const [payInvoice, setPayInvoice] = useState<InvoiceRow | null>(null);
  const [payForm, setPayForm] = useState({ amount: "", method: "CASH", reference: "" });
  const [payError, setPayError] = useState<string | null>(null);
  const [paySaving, setPaySaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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

  function openPayModal(inv: InvoiceRow) {
    setPayInvoice(inv);
    setPayForm({ amount: String(inv.balance / 100), method: "CASH", reference: "" });
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
      });
      setPayInvoice(null);
      setNotice(`Payment recorded against ${payInvoice.number}.`);
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
          {notice} <button className="ml-2 underline" onClick={() => setNotice(null)}>Dismiss</button>
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
            {GRADE_LEVELS.map((g) => <option key={g} value={g}>{gradeLabel(g)}</option>)}
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

      {overview && overview.recentPayments.length > 0 && (
        <Card className="mt-6">
          <h2 className="border-b border-slate-100 px-6 py-4 text-sm font-semibold text-slate-700">Recent payments</h2>
          <DataTable
            rows={overview.recentPayments}
            keyFor={(p) => p.id}
            columns={[
              { header: "Invoice", cell: (p) => <span className="font-mono text-xs">{p.invoice.number}</span> },
              { header: "Student", cell: (p) => fullName(p.invoice.student) },
              { header: "Method", cell: (p) => humanize(p.method) },
              { header: "Paid at", cell: (p) => formatDate(p.paidAt) },
              { header: "Amount", align: "right", cell: (p) => <span className="font-medium text-emerald-600">{formatMoney(p.amount)}</span> },
            ]}
          />
        </Card>
      )}

      {showFees && (
        <FeeStructuresModal
          onClose={() => setShowFees(false)}
        />
      )}

      <CollectPaymentModal
        open={showCollect}
        onClose={() => setShowCollect(false)}
        onCollected={(msg) => {
          setNotice(msg);
          setShowCollect(false);
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
              <Input value={payForm.reference} onChange={(e) => setPayForm((f) => ({ ...f, reference: e.target.value }))} />
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
