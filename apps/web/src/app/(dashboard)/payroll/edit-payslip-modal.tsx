"use client";

import { useEffect, useState } from "react";
import { patch, ApiClientError } from "@/lib/api";
import { Button, ErrorNote, Field, Input, Modal } from "@/components/ui";

/**
 * Admin edits a DRAFT payslip: basic salary, bonus and the full
 * allowance/deduction component lists. Amounts are entered in major units
 * and sent to the API as cents; gross/net recompute server-side.
 * Used from both the run detail modal and the payroll report page.
 */
export interface EditablePayslip {
  id: string;
  basicSalary: number;
  bonus: number;
  currency: string;
  allowances: Array<{ name: string; amount: number }>;
  deductions: Array<{ name: string; amount: number }>;
  staffName: string;
}

interface ComponentDraft {
  name: string;
  amount: string;
}

const toMajor = (cents: number) => String(cents / 100);
const toCents = (value: string) => Math.round(parseFloat(value || "0") * 100);

export function EditPayslipModal({ payslip, onClose, onSaved }: {
  payslip: EditablePayslip | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [basic, setBasic] = useState("");
  const [bonus, setBonus] = useState("");
  const [allowances, setAllowances] = useState<ComponentDraft[]>([]);
  const [deductions, setDeductions] = useState<ComponentDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!payslip) return;
    setBasic(toMajor(payslip.basicSalary));
    setBonus(toMajor(payslip.bonus));
    setAllowances(payslip.allowances.map((c) => ({ name: c.name, amount: toMajor(c.amount) })));
    setDeductions(payslip.deductions.map((c) => ({ name: c.name, amount: toMajor(c.amount) })));
    setError(null);
  }, [payslip]);

  const slip = payslip;
  if (!slip) return null;

  function parseList(list: ComponentDraft[], label: string) {
    return list.map((c) => {
      const name = c.name.trim();
      const amount = toCents(c.amount);
      if (!name) throw new Error(`Every ${label} needs a name`);
      if (Number.isNaN(amount) || amount < 0) throw new Error(`${label} "${name || "…"}": enter a valid non-negative amount`);
      return { name, amount };
    });
  }

  async function save() {
    if (!slip) return;
    setError(null);
    let body: {
      basicSalary: number;
      bonus: number;
      allowances: Array<{ name: string; amount: number }>;
      deductions: Array<{ name: string; amount: number }>;
    };
    try {
      const basicSalary = toCents(basic);
      const bonusCents = toCents(bonus);
      if (Number.isNaN(basicSalary) || basicSalary < 0 || Number.isNaN(bonusCents) || bonusCents < 0) {
        throw new Error("Enter valid non-negative amounts");
      }
      body = {
        basicSalary,
        bonus: bonusCents,
        allowances: parseList(allowances, "allowance"),
        deductions: parseList(deductions, "deduction"),
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid input");
      return;
    }
    setSaving(true);
    try {
      await patch(`/payroll/payslips/${slip.id}`, body);
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to save the payslip");
    } finally {
      setSaving(false);
    }
  }

  function componentEditor(
    label: string,
    list: ComponentDraft[],
    setList: (update: (prev: ComponentDraft[]) => ComponentDraft[]) => void,
  ) {
    return (
      <div>
        <p className="mb-1 text-sm font-medium text-slate-700">{label}</p>
        <div className="space-y-2">
          {list.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                placeholder="Name (e.g. Housing)"
                value={c.name}
                onChange={(e) => setList((prev) => prev.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)))}
              />
              <Input
                type="number"
                min={0}
                step="0.01"
                placeholder="0.00"
                className="!w-32"
                value={c.amount}
                onChange={(e) => setList((prev) => prev.map((x, idx) => (idx === i ? { ...x, amount: e.target.value } : x)))}
              />
              <button
                type="button"
                className="text-xs text-rose-600 hover:underline"
                onClick={() => setList((prev) => prev.filter((_, idx) => idx !== i))}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="text-xs font-medium text-brand-600 hover:underline"
            onClick={() => setList((prev) => [...prev, { name: "", amount: "" }])}
          >
            + Add {label.toLowerCase().replace(/s$/, "")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <Modal open title={`Edit payslip — ${slip.staffName}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={`Basic salary (${slip.currency})`}>
            <Input type="number" min={0} step="0.01" value={basic} onChange={(e) => setBasic(e.target.value)} />
          </Field>
          <Field label={`Bonus (${slip.currency})`}>
            <Input type="number" min={0} step="0.01" value={bonus} onChange={(e) => setBonus(e.target.value)} />
          </Field>
        </div>
        {componentEditor("Allowances", allowances, setAllowances)}
        {componentEditor("Deductions", deductions, setDeductions)}
        <p className="text-xs text-slate-400">Gross, total deductions and net pay are recomputed automatically when you save.</p>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={saving} onClick={() => void save()}>Save changes</Button>
        </div>
      </div>
    </Modal>
  );
}
