"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { get } from "@/lib/api";
import { formatDate, formatMoney, fullName, gradeLabel, humanize } from "@/lib/format";
import { Badge, Button, Spinner } from "@/components/ui";

interface ReceiptData {
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
  recordedByName: string | null;
  refundedByName: string | null;
  school: { name: string; address?: string | null; phone?: string | null; email?: string | null; motto?: string | null } | null;
  invoice: {
    number: string;
    currency: string;
    issueDate: string;
    notes?: string | null;
    student: { firstName: string; lastName: string; admissionNo: string; gradeLevel: string };
    items: Array<{ id: string; description: string; amount: number }>;
  };
}

/**
 * Printable payment receipt. The dashboard chrome (sidebar/header) is
 * stripped from printouts by the app shell, so printing this page yields
 * a clean A4 receipt.
 */
export default function ReceiptPage() {
  const { paymentId } = useParams<{ paymentId: string }>();
  const router = useRouter();
  const [data, setData] = useState<ReceiptData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    get<ReceiptData>(`/finance/payments/${paymentId}`).then(setData).catch((e) => setError(e.message));
  }, [paymentId]);

  if (error) return <p className="text-sm text-rose-600">{error}</p>;
  if (!data)
    return (
      <div className="flex justify-center py-24 text-brand-600">
        <Spinner />
      </div>
    );

  const { invoice, school } = data;
  const itemsTotal = invoice.items.reduce((s, i) => s + i.amount, 0);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex justify-end gap-2 print:hidden">
        <Button variant="secondary" onClick={() => router.back()}>← Back</Button>
        <Button onClick={() => window.print()}>🖨 Print receipt</Button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm print:rounded-none print:border-0 print:shadow-none">
        {/* Letterhead */}
        <div className="bg-gradient-to-r from-brand-700 to-brand-500 px-8 py-6 text-white print:bg-brand-700">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold">{school?.name ?? "School"}</h1>
              {school?.motto && <p className="mt-0.5 text-sm text-brand-100">{school.motto}</p>}
              <p className="mt-2 text-xs text-brand-100">
                {[school?.address, school?.phone, school?.email].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-widest text-brand-200">Official receipt</p>
              <p className="mt-1 font-mono text-sm">{invoice.number}</p>
            </div>
          </div>
        </div>

        {data.status === "REFUNDED" && (
          <div className="border-b border-amber-200 bg-amber-50 px-8 py-3 text-sm text-amber-800">
            <strong>REFUNDED</strong>
            {data.refundedAt ? ` on ${formatDate(data.refundedAt)}` : ""}
            {data.refundedByName ? ` by ${data.refundedByName}` : ""} — {data.refundReason}
          </div>
        )}

        <div className="space-y-6 px-8 py-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Received from</p>
              <p className="mt-1 font-semibold text-slate-900">{fullName(invoice.student)}</p>
              <p className="text-sm text-slate-500">{invoice.student.admissionNo} · {gradeLabel(invoice.student.gradeLevel)}</p>
            </div>
            <div className="sm:text-right">
              <p className="text-xs uppercase tracking-wide text-slate-400">Payment date</p>
              <p className="mt-1 font-medium text-slate-900">{formatDate(data.paidAt ?? data.createdAt)}</p>
              <p className="text-sm text-slate-500">Method: {humanize(data.method)}</p>
            </div>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 font-medium">Description</th>
                <th className="py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((it) => (
                <tr key={it.id} className="border-b border-slate-100">
                  <td className="py-2.5 text-slate-700">{it.description}</td>
                  <td className="py-2.5 text-right tabular-nums text-slate-700">{formatMoney(it.amount, invoice.currency)}</td>
                </tr>
              ))}
              <tr>
                <td className="py-3 font-semibold text-slate-900">Amount paid</td>
                <td className="py-3 text-right text-lg font-bold tabular-nums text-slate-900">
                  {formatMoney(data.amount, invoice.currency)}
                </td>
              </tr>
              {data.amount !== itemsTotal && (
                <tr>
                  <td colSpan={2} className="pb-2 text-xs text-slate-400">
                    Invoice total {formatMoney(itemsTotal, invoice.currency)} — this receipt covers the payment above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {data.note && (
            <div className="rounded-lg bg-slate-50 p-4 text-sm">
              <p className="text-xs uppercase tracking-wide text-slate-400">Note</p>
              <p className="mt-1 whitespace-pre-wrap text-slate-700">{data.note}</p>
            </div>
          )}

          <div className="flex flex-wrap items-end justify-between gap-4 border-t border-slate-100 pt-4 text-sm">
            <div className="text-slate-500">
              {data.providerRef && <p>Reference: <span className="font-mono text-xs">{data.providerRef}</span></p>}
              {data.recordedByName && <p>Processed by {data.recordedByName}</p>}
              <p className="mt-1"><Badge>{data.status}</Badge></p>
            </div>
            <div className="text-right text-xs text-slate-400">
              <p>Receipt {invoice.number} · generated {formatDate(new Date())}</p>
              <p className="mt-6 border-t border-dashed border-slate-300 pt-1">Authorized signature</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
