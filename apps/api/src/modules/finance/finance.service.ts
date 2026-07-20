import type { CollectPaymentInput, CreateInvoiceInput, PaginationQuery, RecordPaymentInput } from "@vertik12/shared";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../lib/errors";
import { env } from "../../config/env";
import { paginate, toSkipTake } from "../../lib/pagination";
import { paymentProvider, stripeProviderOrNull } from "./payment-provider";

// ============================ fee structures ============================

/** Active year's presets by default; pass a year id to view any other year's. */
export const listFeeStructures = (academicYearId?: string) =>
  prisma.feeStructure.findMany({
    where: { isActive: true, ...(academicYearId ? { academicYearId } : { academicYear: { isActive: true } }) },
    orderBy: [{ gradeLevel: "asc" }, { name: "asc" }],
    include: { academicYear: { select: { id: true, name: true, isActive: true } } },
  });

/**
 * Date window used to attribute invoices/payments to an academic year in the
 * finance filters.
 *
 * A past/future year uses its exact calendar window. The ACTIVE year is
 * deliberately open-ended around its start/end dates — bounded only by the
 * neighbouring years so it never overlaps them — so that money taken before
 * the official start (summer registration / advance fees) or after the end
 * (late payments) still counts toward the current year. Without this, a
 * payment recorded "today" that falls outside [start, end] silently drops out
 * of the default (active-year) Transactions list, search results and the
 * collected/outstanding totals, even though the collection succeeded.
 */
export async function yearFilterRange(
  academicYearId: string,
): Promise<{ gt?: Date; gte?: Date; lt?: Date; lte?: Date }> {
  const year = await prisma.academicYear.findUnique({ where: { id: academicYearId } });
  if (!year) throw ApiError.notFound("Academic year");
  if (!year.isActive) return { gte: year.startDate, lte: year.endDate };

  // Active year: extend the window to the neighbouring years' boundaries so
  // out-of-term collections stay attached to the current year without ever
  // overlapping the previous/next year.
  const [prev, next] = await Promise.all([
    prisma.academicYear.findFirst({
      where: { endDate: { lt: year.startDate } },
      orderBy: { endDate: "desc" },
      select: { endDate: true },
    }),
    prisma.academicYear.findFirst({
      where: { startDate: { gt: year.endDate } },
      orderBy: { startDate: "asc" },
      select: { startDate: true },
    }),
  ]);
  const range: { gt?: Date; lt?: Date } = {};
  if (prev) range.gt = prev.endDate; // start just after the previous year ended
  if (next) range.lt = next.startDate; // stop just before the next year begins
  return range;
}

export const createFeeStructure = (input: {
  name: string; gradeLevel?: string; amount: number; frequency: string;
  academicYearId: string; description?: string;
}) => prisma.feeStructure.create({ data: input });

/**
 * Retire a fee structure. Invoice items keep their reference, so history
 * stays intact — the fee simply stops applying to new collections.
 */
export async function deactivateFeeStructure(id: string) {
  const fee = await prisma.feeStructure.findUnique({ where: { id } });
  if (!fee) throw ApiError.notFound("Fee structure");
  return prisma.feeStructure.update({ where: { id }, data: { isActive: false } });
}

// ============================== invoices ==============================

/**
 * The school's configured billing currency (Administration → School settings),
 * falling back to the deployment default only if settings were never saved.
 * Every invoice/receipt is stamped with this so all money displays follow the
 * admin's choice rather than a hardcoded USD.
 */
async function schoolCurrency(): Promise<string> {
  const settings = await prisma.schoolSettings.findUnique({
    where: { id: "school" },
    select: { currency: true },
  });
  return settings?.currency ?? env.DEFAULT_CURRENCY;
}

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

export async function listInvoices(
  q: PaginationQuery & { status?: string; studentId?: string; gradeLevel?: string; academicYearId?: string },
) {
  // Year filter = invoices issued while that academic year was running, so
  // each year's billing stays retrievable after the school rolls over.
  const issued = q.academicYearId ? await yearFilterRange(q.academicYearId) : undefined;
  const where: Prisma.InvoiceWhereInput = {
    ...(q.status ? { status: q.status } : {}),
    ...(q.studentId ? { studentId: q.studentId } : {}),
    ...(q.gradeLevel ? { student: { is: { gradeLevel: q.gradeLevel } } } : {}),
    ...(issued ? { issueDate: issued } : {}),
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
  const currency = await schoolCurrency();
  return prisma.$transaction(async (tx) => {
    const student = await tx.student.findUnique({ where: { id: input.studentId } });
    if (!student) throw ApiError.notFound("Student");
    return tx.invoice.create({
      data: {
        number: await nextInvoiceNumber(tx),
        studentId: input.studentId,
        currency,
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

  const currency = await schoolCurrency();
  const created = await prisma.$transaction(async (tx) => {
    let count = 0;
    for (const s of studentsToBill) {
      await tx.invoice.create({
        data: {
          number: await nextInvoiceNumber(tx),
          studentId: s.id,
          currency,
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
      note: input.note || null,
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
  const successUrl = urls.successUrl ?? `${webOrigin}/finance?paid=${inv.number}`;
  const cancelUrl = urls.cancelUrl ?? `${webOrigin}/finance`;

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

/**
 * Redirect-based confirmation: when the payer lands back on the app with
 * `?session_id=…`, the web client posts it here. The payment is only marked
 * SUCCEEDED after Stripe itself confirms the session was paid — the client
 * is never trusted. This makes sandbox/local testing work without exposing
 * a public webhook URL (the webhook stays as the production-grade path).
 */
export async function confirmCheckoutSession(sessionId: string) {
  const payment = await prisma.payment.findFirst({
    where: { providerRef: sessionId },
    include: { invoice: { select: { number: true } } },
  });
  if (!payment) throw ApiError.notFound("Payment for this checkout session");

  if (payment.status === "SUCCEEDED") {
    return { status: "SUCCEEDED", invoiceNumber: payment.invoice.number, amount: payment.amount };
  }
  if (payment.status !== "PENDING") {
    return { status: payment.status, invoiceNumber: payment.invoice.number, amount: payment.amount };
  }

  if (payment.provider === "STRIPE") {
    const stripe = stripeProviderOrNull();
    if (!stripe) throw ApiError.badRequest("Stripe is not configured on the server");
    const paid = await stripe.isSessionPaid(sessionId);
    if (!paid) {
      return { status: "PENDING", invoiceNumber: payment.invoice.number, amount: payment.amount };
    }
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "SUCCEEDED", paidAt: new Date() } });
    await refreshInvoiceStatus(payment.invoiceId);
    return { status: "SUCCEEDED", invoiceNumber: payment.invoice.number, amount: payment.amount };
  }

  // Mock sessions are auto-confirmed at creation; a PENDING mock session
  // means something went wrong — report it as-is.
  return { status: payment.status, invoiceNumber: payment.invoice.number, amount: payment.amount };
}

// ========================= registrar collection =========================

/**
 * Registrar/Admin cashier flow: bill + collect in one step. There is no
 * due-date gate — families can pay whenever they come to the office.
 *
 *  - MONTHLY: one month of the grade's MONTHLY fee structures (the
 *    per-grade presets the administrator configured).
 *  - YEARLY: 12 months of MONTHLY fees + all ANNUAL fees, minus the
 *    yearly-payment discount the administrator configured in
 *    School settings (e.g. 10% off when a family pays the year at once).
 *  - customAmount: overrides the preset entirely — the cashier types the
 *    exact amount to charge (used when the school negotiates a different
 *    figure, or no preset exists for the grade yet).
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

  const months = input.months ?? 1;
  const periodLabel =
    input.period === "YEARLY"
      ? "Yearly (paid at once)"
      : months === 1
        ? new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })
        : `${months} months (paid in advance)`;

  const items: Array<{ description: string; amount: number; feeStructureId?: string }> = [];
  let discountPercent = 0;

  if (input.customAmount) {
    // Cashier override: one explicit line, no preset math, no discount.
    items.push({ description: `Fee payment (custom amount) — ${periodLabel}`, amount: input.customAmount });
  } else {
    const monthly = fees.filter((f) => f.frequency === "MONTHLY");
    const annual = fees.filter((f) => f.frequency === "ANNUAL");
    if (input.period === "MONTHLY" && monthly.length === 0) {
      throw ApiError.badRequest(
        `No monthly fee preset is defined for ${student.gradeLevel === "K" ? "Kindergarten" : `grade ${student.gradeLevel}`}. ` +
        "Ask the administrator to add one under Fee structures, or use a custom amount.",
      );
    }
    if (input.period === "YEARLY" && monthly.length === 0 && annual.length === 0) {
      throw ApiError.badRequest(
        `No monthly or annual fee presets are defined for grade ${student.gradeLevel} — use a custom amount instead`,
      );
    }
    if (input.period === "MONTHLY") {
      for (const f of monthly) items.push({ description: `${f.name} — ${periodLabel}`, amount: f.amount * months, feeStructureId: f.id });
    } else {
      for (const f of monthly) items.push({ description: `${f.name} — 12 months`, amount: f.amount * 12, feeStructureId: f.id });
      for (const f of annual) items.push({ description: f.name, amount: f.amount, feeStructureId: f.id });
    }
    discountPercent = input.period === "YEARLY" ? (settings?.yearlyDiscountPercent ?? 0) : 0;
  }

  // The yearly discount applies to the fee computation only — never to the
  // cashier's additional line items, which are appended after it.
  const feeSubtotal = items.reduce((s, i) => s + i.amount, 0);
  const discount = Math.round((feeSubtotal * discountPercent) / 100);
  for (const extra of input.extras ?? []) {
    items.push({ description: extra.description, amount: extra.amount });
  }
  const subtotal = items.reduce((s, i) => s + i.amount, 0);
  const total = subtotal - discount;

  const { invoice, payment } = await prisma.$transaction(async (tx) => {
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
    const pay = await tx.payment.create({
      data: {
        invoiceId: inv.id, amount: total, method: input.method, status: "SUCCEEDED",
        provider: "MANUAL", providerRef: input.reference, note: input.note || null,
        paidAt: new Date(), recordedBy,
      },
    });
    return { invoice: inv, payment: pay };
  });

  return {
    invoice,
    receipt: {
      paymentId: payment.id,
      number: invoice.number,
      student: `${student.firstName} ${student.lastName} (${student.admissionNo})`,
      period: input.period,
      subtotal,
      discountPercent,
      discount,
      total,
      method: input.method,
      note: input.note ?? null,
    },
  };
}

// ========================= transactions & refunds =========================

/** Paginated payment history (the "Transactions" screen). */
export async function listPayments(
  q: PaginationQuery & { status?: string; method?: string; academicYearId?: string; currency?: string },
) {
  // Year filter: payments taken during that academic year (fall back to the
  // creation date for pending ones, which have no paid date yet).
  const range = q.academicYearId ? await yearFilterRange(q.academicYearId) : undefined;
  // Currency filter and the text search both constrain the invoice relation —
  // build them into ONE invoice condition so they don't clobber each other.
  const invoiceFilter: Prisma.InvoiceWhereInput = {
    ...(q.currency ? { currency: q.currency } : {}),
    ...(q.search
      ? {
          OR: [
            { number: { contains: q.search } },
            { student: { is: { OR: [{ firstName: { contains: q.search } }, { lastName: { contains: q.search } }, { admissionNo: { contains: q.search } }] } } },
          ],
        }
      : {}),
  };
  const where: Prisma.PaymentWhereInput = {
    ...(q.status ? { status: q.status } : {}),
    ...(q.method ? { method: q.method } : {}),
    ...(range ? { OR: [{ paidAt: range }, { paidAt: null, createdAt: range }] } : {}),
    ...(Object.keys(invoiceFilter).length > 0 ? { invoice: { is: invoiceFilter } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      ...toSkipTake(q),
      orderBy: { createdAt: "desc" },
      include: {
        invoice: {
          select: {
            id: true, number: true, currency: true,
            student: { select: { id: true, firstName: true, lastName: true, admissionNo: true, gradeLevel: true } },
          },
        },
      },
    }),
    prisma.payment.count({ where }),
  ]);
  return paginate(items, total, q);
}

/** Full detail of a single transaction — drives the receipt printout. */
export async function getPayment(id: string) {
  const payment = await prisma.payment.findUnique({
    where: { id },
    include: {
      invoice: {
        include: {
          student: { select: { id: true, firstName: true, lastName: true, admissionNo: true, gradeLevel: true } },
          items: true,
        },
      },
    },
  });
  if (!payment) throw ApiError.notFound("Payment");

  // Resolve the acting users' names for the receipt / audit display.
  const userIds = [payment.recordedBy, payment.refundedBy].filter((v): v is string => !!v);
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } })
    : [];
  const nameOf = (uid: string | null) => {
    const u = users.find((x) => x.id === uid);
    return u ? `${u.firstName} ${u.lastName}` : null;
  };
  const settings = await prisma.schoolSettings.findUnique({ where: { id: "school" } });

  return {
    ...payment,
    recordedByName: nameOf(payment.recordedBy),
    refundedByName: nameOf(payment.refundedBy),
    school: settings
      ? { name: settings.schoolName, address: settings.address, phone: settings.phone, email: settings.email, motto: settings.motto }
      : null,
  };
}

/**
 * SUPER_ADMIN-only: reverse a succeeded payment. The row is kept and marked
 * REFUNDED (with who/when/why) so the money trail stays auditable; the
 * invoice balance reopens automatically.
 */
export async function refundPayment(id: string, reason: string, refundedBy: string) {
  const payment = await prisma.payment.findUnique({ where: { id } });
  if (!payment) throw ApiError.notFound("Payment");
  if (payment.status !== "SUCCEEDED") {
    throw ApiError.badRequest(`Only succeeded payments can be refunded (this one is ${payment.status})`);
  }
  const updated = await prisma.payment.update({
    where: { id },
    data: { status: "REFUNDED", refundedAt: new Date(), refundedBy, refundReason: reason },
  });
  await refreshInvoiceStatus(payment.invoiceId);
  return updated;
}

// ============================== reporting ==============================

/**
 * Collections vs outstanding for the accountant dashboard.
 *
 * Pure SQL aggregation — the previous version materialised every invoice
 * with its items and payments in JS, which fell over once the school had
 * tens of thousands of invoices.
 */
export async function financeOverview(academicYearId?: string) {
  // Optional year scope: totals for the invoices issued during that year,
  // so the dashboard follows the year the viewer switches to.
  const issued = academicYearId ? await yearFilterRange(academicYearId) : undefined;
  const billable: Prisma.InvoiceWhereInput = {
    status: { notIn: ["VOID", "DRAFT"] },
    ...(issued ? { issueDate: issued } : {}),
  };
  const [invoicedAgg, collectedAgg, overdueCount, recentPayments, currency] = await Promise.all([
    prisma.invoiceItem.aggregate({ _sum: { amount: true }, where: { invoice: billable } }),
    prisma.payment.aggregate({ _sum: { amount: true }, where: { status: "SUCCEEDED", invoice: billable } }),
    // Overdue = stored OVERDUE plus unpaid invoices whose due date has
    // passed but whose status hasn't been refreshed by a payment yet.
    prisma.invoice.count({
      where: {
        ...(issued ? { issueDate: issued } : {}),
        OR: [
          { status: "OVERDUE" },
          { status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { lt: new Date() } },
        ],
      },
    }),
    prisma.payment.findMany({
      where: { status: "SUCCEEDED", ...(issued ? { invoice: { is: { issueDate: issued } } } : {}) },
      orderBy: { paidAt: "desc" },
      take: 15,
      include: { invoice: { include: { student: { select: { firstName: true, lastName: true } } } } },
    }),
    schoolCurrency(),
  ]);
  const invoiced = invoicedAgg._sum.amount ?? 0;
  const collected = collectedAgg._sum.amount ?? 0;

  // Per-currency breakdown: money in different currencies must never be summed
  // into one figure (10000 JPY + 100 USD is not 10100 of anything). Distinct
  // currencies are few, so a small aggregate per currency stays cheap and
  // avoids materialising every payment. When the school uses a single currency
  // this is just one row equal to the totals above.
  const distinctCurrencies = await prisma.invoice.findMany({
    where: billable,
    select: { currency: true },
    distinct: ["currency"],
  });
  const byCurrency = (
    await Promise.all(
      distinctCurrencies.map(async ({ currency: cur }) => {
        const scoped: Prisma.InvoiceWhereInput = { ...billable, currency: cur };
        const [invAgg, colAgg, payments] = await Promise.all([
          prisma.invoiceItem.aggregate({ _sum: { amount: true }, where: { invoice: scoped } }),
          prisma.payment.aggregate({ _sum: { amount: true }, where: { status: "SUCCEEDED", invoice: scoped } }),
          prisma.payment.count({ where: { status: "SUCCEEDED", invoice: scoped } }),
        ]);
        const curInvoiced = invAgg._sum.amount ?? 0;
        const curCollected = colAgg._sum.amount ?? 0;
        return {
          currency: cur,
          invoiced: curInvoiced,
          collected: curCollected,
          outstanding: curInvoiced - curCollected,
          payments,
        };
      }),
    )
  ).sort((a, b) => b.collected - a.collected);

  return {
    invoiced,
    collected,
    outstanding: invoiced - collected,
    overdueCount,
    recentPayments,
    // Admin-configured billing currency, so the dashboard cards and the
    // collection UI format money the same way invoices are stamped.
    currency,
    // Collected/invoiced/outstanding split by the currency each invoice was
    // billed in — the UI lists these instead of a mixed-currency total.
    byCurrency,
  };
}

/**
 * Per-academic-year finance report for the admin/registrar/accountant:
 * every (non-void, non-draft) invoice issued during the chosen year with
 * totals plus grade / month / status breakdowns. Previous years stay fully
 * reportable after a rollover. Like the payroll report this materialises
 * one year's invoices and aggregates in JS — bounded by the year, and only
 * run on demand from the report screen.
 */
export async function financeYearReport(academicYearId: string) {
  const year = await prisma.academicYear.findUnique({ where: { id: academicYearId } });
  if (!year) throw ApiError.notFound("Academic year");

  const invoices = await prisma.invoice.findMany({
    where: { issueDate: { gte: year.startDate, lte: year.endDate }, status: { notIn: ["VOID", "DRAFT"] } },
    orderBy: { issueDate: "desc" },
    select: {
      id: true, number: true, status: true, issueDate: true, dueDate: true, currency: true,
      student: { select: { id: true, firstName: true, lastName: true, admissionNo: true, gradeLevel: true } },
      items: { select: { amount: true } },
      payments: { select: { amount: true, status: true } },
    },
  });

  const rows = invoices.map((inv) => {
    const total = invoiceTotal(inv);
    const paid = invoicePaid(inv);
    return {
      id: inv.id,
      number: inv.number,
      status: inv.status,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      currency: inv.currency,
      student: inv.student,
      total,
      paid,
      balance: total - paid,
    };
  });

  const groupBy = <K>(key: (r: (typeof rows)[number]) => K) => {
    const map = new Map<K, { invoices: number; invoiced: number; collected: number; outstanding: number }>();
    for (const r of rows) {
      const k = key(r);
      const g = map.get(k) ?? { invoices: 0, invoiced: 0, collected: 0, outstanding: 0 };
      g.invoices += 1;
      g.invoiced += r.total;
      g.collected += r.paid;
      g.outstanding += r.balance;
      map.set(k, g);
    }
    return map;
  };

  const invoiced = rows.reduce((s, r) => s + r.total, 0);
  const collected = rows.reduce((s, r) => s + r.paid, 0);

  return {
    year: { id: year.id, name: year.name, startDate: year.startDate, endDate: year.endDate, isActive: year.isActive },
    rows,
    totals: {
      invoices: rows.length,
      students: new Set(rows.map((r) => r.student.id)).size,
      invoiced,
      collected,
      outstanding: invoiced - collected,
    },
    byGrade: [...groupBy((r) => r.student.gradeLevel).entries()]
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
      .map(([gradeLevel, g]) => ({ gradeLevel, ...g })),
    byMonth: [...groupBy((r) => r.issueDate.getUTCFullYear() * 100 + (r.issueDate.getUTCMonth() + 1)).entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([k, g]) => ({ year: Math.floor(k / 100), month: k % 100, ...g })),
    byStatus: [...groupBy((r) => r.status).entries()]
      .map(([status, g]) => ({ status, ...g })),
  };
}
