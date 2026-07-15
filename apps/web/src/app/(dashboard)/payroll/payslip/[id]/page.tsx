"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { get, post, getSession, ApiClientError } from "@/lib/api";
import { formatDate, formatMoney, monthLabel } from "@/lib/format";
import { Badge, Button, Spinner } from "@/components/ui";

interface PayslipDetail {
  id: string;
  basicSalary: number;
  bonus: number;
  gross: number;
  totalDeductions: number;
  net: number;
  currency: string;
  status: string;
  paidAt?: string | null;
  allowances: Array<{ name: string; amount: number }>;
  deductions: Array<{ name: string; amount: number }>;
  run: { month: number; year: number; status: string; paidAt?: string | null };
  staff: {
    staffNo: string;
    designation: string;
    department?: string | null;
    user: { firstName: string; lastName: string; email: string };
  };
  school: { name: string; address?: string | null; phone?: string | null; email?: string | null; motto?: string | null } | null;
}

/**
 * Printable paystub for one employee. The dashboard chrome is stripped on
 * print, so this page prints as a clean single-page paystub. Admins can
 * also email it straight to the employee.
 */
export default function PayslipPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<PayslipDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [emailing, setEmailing] = useState(false);
  const role = getSession()?.user.role;
  const canEmail = role === "ADMIN" || role === "SUPER_ADMIN";

  useEffect(() => {
    get<PayslipDetail>(`/payroll/payslips/${id}`).then(setData).catch((e) => setError(e.message));
  }, [id]);

  async function emailPaystub() {
    if (!data) return;
    setEmailing(true);
    setNotice(null);
    try {
      const result = await post<{ message: string }>(`/payroll/payslips/${data.id}/email`, {});
      setNotice(result.message);
    } catch (err) {
      setNotice(err instanceof ApiClientError ? err.message : "Failed to send the email");
    } finally {
      setEmailing(false);
    }
  }

  if (error) return <p className="text-sm text-rose-600">{error}</p>;
  if (!data)
    return (
      <div className="flex justify-center py-24 text-brand-600">
        <Spinner />
      </div>
    );

  const { staff, school } = data;
  const period = monthLabel(data.run.month, data.run.year);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex flex-wrap justify-end gap-2 print:hidden">
        <Button variant="secondary" onClick={() => router.back()}>← Back</Button>
        {canEmail && (
          <Button variant="secondary" loading={emailing} onClick={() => void emailPaystub()}>
            ✉️ Email to {staff.user.firstName}
          </Button>
        )}
        <Button onClick={() => window.print()}>🖨 Print paystub</Button>
      </div>

      {notice && (
        <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800 print:hidden">
          {notice} <button className="ml-2 underline" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm print:rounded-none print:border-0 print:shadow-none">
        {/* Letterhead */}
        <div className="bg-gradient-to-r from-slate-900 to-slate-700 px-8 py-6 text-white">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold">{school?.name ?? "School"}</h1>
              {school?.motto && <p className="mt-0.5 text-sm text-slate-300">{school.motto}</p>}
              <p className="mt-2 text-xs text-slate-300">
                {[school?.address, school?.phone, school?.email].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-widest text-slate-400">Paystub</p>
              <p className="mt-1 font-semibold">{period}</p>
            </div>
          </div>
        </div>

        <div className="space-y-6 px-8 py-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Employee</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{staff.user.firstName} {staff.user.lastName}</p>
              <p className="text-sm text-slate-500">
                {staff.staffNo} · {staff.designation}{staff.department ? ` · ${staff.department}` : ""}
              </p>
              <p className="text-xs text-slate-400">{staff.user.email}</p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-slate-400">Status</p>
              <p className="mt-1"><Badge>{data.status}</Badge></p>
              {data.paidAt && <p className="mt-1 text-xs text-slate-500">Paid {formatDate(data.paidAt)}</p>}
            </div>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 font-medium">Earnings & deductions</th>
                <th className="py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-100">
                <td className="py-2.5 text-slate-700">Basic salary</td>
                <td className="py-2.5 text-right tabular-nums">{formatMoney(data.basicSalary, data.currency)}</td>
              </tr>
              {data.allowances.map((a) => (
                <tr key={a.name} className="border-b border-slate-100">
                  <td className="py-2.5 text-slate-700">{a.name} <span className="text-xs text-slate-400">(allowance)</span></td>
                  <td className="py-2.5 text-right tabular-nums text-emerald-700">+{formatMoney(a.amount, data.currency)}</td>
                </tr>
              ))}
              {data.bonus > 0 && (
                <tr className="border-b border-slate-100">
                  <td className="py-2.5 text-slate-700">Bonus</td>
                  <td className="py-2.5 text-right tabular-nums text-emerald-700">+{formatMoney(data.bonus, data.currency)}</td>
                </tr>
              )}
              {data.deductions.map((d) => (
                <tr key={d.name} className="border-b border-slate-100">
                  <td className="py-2.5 text-slate-700">{d.name} <span className="text-xs text-slate-400">(deduction)</span></td>
                  <td className="py-2.5 text-right tabular-nums text-rose-600">−{formatMoney(d.amount, data.currency)}</td>
                </tr>
              ))}
              <tr className="border-b border-slate-100">
                <td className="py-2.5 text-slate-500">Gross pay</td>
                <td className="py-2.5 text-right tabular-nums text-slate-700">{formatMoney(data.gross, data.currency)}</td>
              </tr>
              <tr>
                <td className="py-3 text-base font-semibold text-slate-900">Net pay</td>
                <td className="py-3 text-right text-xl font-bold tabular-nums text-slate-900">
                  {formatMoney(data.net, data.currency)}
                </td>
              </tr>
            </tbody>
          </table>

          <div className="flex items-end justify-between border-t border-slate-100 pt-4 text-xs text-slate-400">
            <p>Generated {formatDate(new Date())} · run status {data.run.status}</p>
            <p className="border-t border-dashed border-slate-300 pt-1">Authorized signature</p>
          </div>
        </div>
      </div>
    </div>
  );
}
