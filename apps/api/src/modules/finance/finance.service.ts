import type { CollectPaymentInput, CreateInvoiceInput, PaginationQuery, RecordPaymentInput } from "@vertik12/shared";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../lib/errors";
import { env } from "../../config/env";
import { paginate, toSkipTake } from "../../lib/pagination";
import { paymentProvider } from "./payment-provider";

// ============================ fee structures ============================

export const listFeeStructures = () =>
  prisma.feeStructure.findMany({
    where: { isActive: true, academicYear: { isActive: true } },
    orderBy: [{ gradeLevel: "asc" }, { name: "asc" }],
  });

export const createFeeStructure = (input: {
  name: string; gradeLevel?: string; amount: number; frequency: string;
  academicYearId: string; description?: string;
}) => prisma.feeStructure.create({ data: input });

// ============================== invoices ==============================

async function nextInvoiceNumber(tx: Prisma.TransactionClient): Promise<string> {
  const year = new Date().getFullYear();
  const count = await tx.invoice.count({ where: { number: { startsWith: `INV-${year}-` } } });
  return `INV-${year}-${String(count + 1).padStart(6, "0")}`;
}

const invoiceTotal = (inv: { items: { amount: number }[] }) =>
  inv.items.reduce((s, i) => s + i.amount, 0);

const invoicePaid = (inv: { payments: { amount: number; status: string }[] }) =>
  inv.payments.filter((p) => p.status === "SUCCEEDED").reduce((s, p) => s + p.amount, 0);

/** Derives the correct status from totals + due date. Called after every payment. */
function deriveStatus(inv: { items: { amount: number }[]; payments: { amount: number; status: string }[]; dueDate: Date; status: string }): string {
  if (inv.status === "VOID" || inv.status === "DRAFT") return inv.status;
  const total = invoiceTotal(inv);
  const paid = invoicePaid(inv);
  if (paid >= total && total > 0) return "PAID";
  if (paid > 0) return "PARTIALLY_PAID";
  if (inv.dueDate < new Date()) return "OVERDUE";
  return "ISSUED";
}

export async function listInvoices(q: PaginationQuery & { status?: string; studentId?: string; gradeLevel?: string }) {
  const where: Prisma.InvoiceWhereInput = {
    ...(q.status ? { status: q.status } : {}),
    ...(q.studentId ? { studentId: q.studentId } : {}),
    ...(q.gradeLevel ? { student: { is: { gradeLevel: q.gradeLevel } } } : {}),
    ...(q.search
      ? {
          OR: [
            { number: { contains: q.search } },
            { student: { is: { OR: [{ firstName: { contains: q.search } }, { lastName: { contains: q.search } }, { admissionNo: { contains: q.search } }] } } },
          ],
        }
      : {}),
  };
  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      ...toSkipTake(q),
      orderBy: { issueDate: "desc" },
      include: {
        student: { select: { id: true, firstName: true, lastName: true, admissionNo: true, gradeLevel: true } },
        items: true,
        payments: { select: { amount: true, status: true } },
      },
    }),
    prisma.invoice.count({ where }),
  ]);
  const items = invoices.map((inv) => ({
    ...inv,
    total: invoiceTotal(inv),
    paid: invoicePaid(inv),
    balance: invoiceTotal(inv) - invoicePaid(inv),
  }));
  return paginate(items, total, q);
}

export async function getInvoice(id: string) {
  const inv = await prisma.invoice.findUnique({
    where: { id },
    include: { student: true, items: { include: { feeStructure: true } }, payments: { orderBy: { createdAt: "desc" } } },
  });
  if (!inv) throw ApiError.notFound("Invoice");
  return { ...inv, total: invoiceTotal(inv), paid: invoicePaid(inv), balance: invoiceTotal(inv) - invoicePaid(inv) };
}

export async function createInvoice(input: CreateInvoiceInput) {
  return prisma.$transaction(async (tx) => {
    const student = await tx.student.findUnique({ where: { id: input.studentId } });
    if (!student) throw ApiError.notFound("Student");
    return tx.invoice.create({
      data: {
        number: await nextInvoiceNumber(tx),
        studentId: input.studentId,
        currency: env.DEFAULT_CURRENCY,
        dueDate: input.dueDate,
        notes: input.notes,
        status: "ISSUED",
        items: { create: input.items },
      },
      include: { items: true },
    });
  });
}

/** Batch billing: one invoice per active student in a grade, from selected fee structures. */
export async function bulkInvoice(input: { gradeLevel: string; feeStructureIds: string[]; dueDate: Date }) {
  const fees = await prisma.feeStructure.findMany({ where: { id: { in: input.feeStructureIds } } });
  if (fees.length === 0) throw ApiError.badRequest("No matching fee structures");

  const studentsToBill = await prisma.student.findMany({
    where: { gradeLevel: input.gradeLevel, status: "ACTIVE" },
    select: { id: true },
  });
  if (studentsToBill.length === 0) throw ApiError.badRequest(`No active students in grade ${input.gradeLevel}`);

  const created = await prisma.$transaction(async (tx) => {
    let count = 0;
    for (const s of studentsToBill) {
      await tx.invoice.create({
        data: {
          number: await nextInvoiceNumber(tx),
          studentId: s.id,
          currency: env.DEFAULT_CURRENCY,
          dueDate: input.dueDate,
          status: "ISSUED",
          items: { create: fees.map((f) => ({ description: f.name, amount: f.amount, feeStructureId: f.id })) },
        },
      });
      count++;
    }
    return count;
  });
  return { invoicesCreated: created, students: studentsToBill.length };
}

export const voidInvoice = (id: string) =>
  prisma.invoice.update({ where: { id }, data: { status: "VOID" } });

// ============================== payments ==============================

async function refreshInvoiceStatus(invoiceId: string) {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { items: true, payments: true },
  });
  if (!inv) return;
  const status = deriveStatus(inv);
  if (status !== inv.status) {
    await prisma.invoice.update({ where: { id: invoiceId }, data: { status } });
  }
}

/** Cashier flow: record an offline payment (cash / bank transfer / cheque…). */
export async function recordManualPayment(input: RecordPaymentInput, recordedBy: string) {
  const inv = await getInvoice(input.invoiceId);
  if (inv.status === "VOID") throw ApiError.badRequest("Cannot pay a void invoice");
  if (input.amount > inv.balance) {
    throw ApiError.badRequest(`Amount exceeds outstanding balance (${inv.balance})`);
  }
  const payment = await prisma.payment.create({
    data: {
      invoiceId: input.invoiceId,
      amount: input.amount,
      method: input.method,
      status: "SUCCEEDED",
      provider: "MANUAL",
      providerRef: input.reference,
      paidAt: input.paidAt ?? new Date(),
      recordedBy,
    },
  });
  await refreshInvoiceStatus(input.invoiceId);
  return payment;
}

/** Online flow: create a gateway checkout session for the invoice balance. */
export async function createCheckout(invoiceId: string, urls: { successUrl?: string; cancelUrl?: string }) {
  const inv = await getInvoice(invoiceId);
  if (inv.status === "VOID" || inv.balance <= 0) throw ApiError.badRequest("Invoice has no outstanding balance");

  // CORS_ORIGIN may list several origins — the first is the canonical web app.
  const webOrigin = env.CORS_ORIGIN.split(",")[0];
  const successUrl = urls.successUrl ?? `${webOrigin}/finance/invoices?paid=${inv.number}`;
  const cancelUrl = urls.cancelUrl ?? `${webOrigin}/finance/invoices`;

  const session = await paymentProvider.createCheckout({
    invoiceNumber: inv.number,
    description: inv.items.map((i) => i.description).join(", "),
    amount: inv.balance,
    currency: inv.currency,
    successUrl,
    cancelUrl,
    metadata: { invoiceId: inv.id },
  });

  await prisma.payment.create({
    data: {
      invoiceId: inv.id,
      amount: inv.balance,
      method: "CARD",
      provider: session.provider,
      providerRef: session.sessionId,
      // Mock gateway approves instantly; Stripe stays PENDING until the webhook.
      status: session.autoConfirmed ? "SUCCEEDED" : "PENDING",
      paidAt: session.autoConfirmed ? new Date() : null,
    },
  });
  if (session.autoConfirmed) await refreshInvoiceStatus(inv.id);

  return { checkoutUrl: session.checkoutUrl, provider: session.provider, simulated: session.autoConfirmed };
}

/** Stripe webhook: confirm the pending payment when checkout completes. */
export async function confirmCheckout(sessionId: string) {
  const payment = await prisma.payment.findFirst({ where: { providerRef: sessionId, status: "PENDING" } });
  if (!payment) return;
  await prisma.payment.update({ where: { id: payment.id }, data: { status: "SUCCEEDED", paidAt: new Date() } });
  await refreshInvoiceStatus(payment.invoiceId);
}

// ========================= registrar collection =========================

/**
 * Registrar cashier flow: bill + collect in one step.
 *
 *  - MONTHLY: one month of the grade's MONTHLY fee structures.
 *  - YEARLY: 12 months of MONTHLY fees + all ANNUAL fees, minus the
 *    yearly-payment discount the administrator configured in
 *    School settings (e.g. 10% off when a family pays the year at once).
 *
 * Creates the invoice, applies the discount as an explicit line item, and
 * records the payment as SUCCEEDED — the receipt shows exactly what was
 * charged and what was discounted.
 */
export async function collectPayment(input: CollectPaymentInput, recordedBy: string) {
  const student = await prisma.student.findUnique({ where: { id: input.studentId } });
  if (!student) throw ApiError.notFound("Student");
  if (student.status !== "ACTIVE") throw ApiError.badRequest("Payments can only be collected for active students");

  const [fees, settings] = await Promise.all([
    prisma.feeStructure.findMany({
      where: {
        isActive: true,
        academicYear: { isActive: true },
        OR: [{ gradeLevel: student.gradeLevel }, { gradeLevel: null }],
      },
    }),
    prisma.schoolSettings.findUnique({ where: { id: "school" } }),
  ]);

  const monthly = fees.filter((f) => f.frequency === "MONTHLY");
  const annual = fees.filter((f) => f.frequency === "ANNUAL");
  if (input.period === "MONTHLY" && monthly.length === 0) {
    throw ApiError.badRequest(`No monthly fee structures are defined for grade ${student.gradeLevel}`);
  }
  if (input.period === "YEARLY" && monthly.length === 0 && annual.length === 0) {
    throw ApiError.badRequest(`No monthly or annual fee structures are defined for grade ${student.gradeLevel}`);
  }

  const items: Array<{ description: string; amount: number; feeStructureId?: string }> = [];
  if (input.period === "MONTHLY") {
    // Families can pay several months ahead at any time (no due-date gate).
    const months = input.months ?? 1;
    const label =
      months === 1
        ? new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })
        : `${months} months (paid in advance)`;
    for (const f of monthly) items.push({ description: `${f.name} — ${label}`, amount: f.amount * months, feeStructureId: f.id });
  } else {
    for (const f of monthly) items.push({ description: `${f.name} — 12 months`, amount: f.amount * 12, feeStructureId: f.id });
    for (const f of annual) items.push({ description: f.name, amount: f.amount, feeStructureId: f.id });
  }

  const subtotal = items.reduce((s, i) => s + i.amount, 0);
  const discountPercent = input.period === "YEARLY" ? (settings?.yearlyDiscountPercent ?? 0) : 0;
  const discount = Math.round((subtotal * discountPercent) / 100);
  const total = subtotal - discount;

  const invoice = await prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.create({
      data: {
        number: await nextInvoiceNumber(tx),
        studentId: student.id,
        currency: settings?.currency ?? env.DEFAULT_CURRENCY,
        dueDate: new Date(),
        status: "PAID",
        notes: input.period === "YEARLY" && discount > 0
          ? `Paid yearly in advance — ${discountPercent}% discount applied`
          : `Collected at the registrar's office (${input.period.toLowerCase()})`,
        items: {
          create: [
            ...items,
            ...(discount > 0
              ? [{ description: `Yearly payment discount (${discountPercent}%)`, amount: -discount }]
              : []),
          ],
        },
      },
      include: { items: true },
    });
    await tx.payment.create({
      data: {
        invoiceId: inv.id, amount: total, method: input.method, status: "SUCCEEDED",
        provider: "MANUAL", providerRef: input.reference, paidAt: new Date(), recordedBy,
      },
    });
    return inv;
  });

  return {
    invoice,
    receipt: {
      number: invoice.number,
      student: `${student.firstName} ${student.lastName} (${student.admissionNo})`,
      period: input.period,
      subtotal,
      discountPercent,
      discount,
      total,
      method: input.method,
    },
  };
}

// ============================== reporting ==============================

/** Collections vs outstanding for the accountant dashboard. */
export async function financeOverview() {
  const [invoices, payments] = await Promise.all([
    prisma.invoice.findMany({ where: { status: { notIn: ["VOID", "DRAFT"] } }, include: { items: true, payments: true } }),
    prisma.payment.findMany({ where: { status: "SUCCEEDED" }, orderBy: { paidAt: "desc" }, take: 15, include: { invoice: { include: { student: { select: { firstName: true, lastName: true } } } } } }),
  ]);
  const totals = invoices.reduce(
    (acc, inv) => {
      acc.invoiced += invoiceTotal(inv);
      acc.collected += invoicePaid(inv);
      return acc;
    },
    { invoiced: 0, collected: 0 },
  );
  return {
    ...totals,
    outstanding: totals.invoiced - totals.collected,
    overdueCount: invoices.filter((i) => i.status === "OVERDUE").length,
    recentPayments: payments,
  };
}
