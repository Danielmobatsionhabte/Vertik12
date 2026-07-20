import { Router, raw } from "express";
import { z } from "zod";
import {
  createFeeStructureSchema, createInvoiceSchema, bulkInvoiceSchema,
  recordPaymentSchema, checkoutSchema, collectPaymentSchema, refundPaymentSchema,
  paginationSchema, INVOICE_STATUSES, PAYMENT_STATUSES, PAYMENT_METHODS,
} from "@vertik12/shared";
import { authenticate, requireRoles } from "../../middleware/auth";
import { validateBody, validateQuery, parsedQuery } from "../../middleware/validate";
import { asyncHandler } from "../../middleware/error-handler";
import { ok } from "../../lib/pagination";
import * as finance from "./finance.service";
import { stripeProviderOrNull } from "./payment-provider";

export const financeRouter = Router();

// --- Stripe webhook: must be BEFORE authenticate and use the raw body ---
financeRouter.post(
  "/payments/webhook",
  raw({ type: "application/json" }),
  asyncHandler(async (req, res) => {
    const stripe = stripeProviderOrNull();
    if (!stripe) return res.status(501).json({ success: false, message: "Stripe is not configured" });
    const event = stripe.constructWebhookEvent(req.body, req.headers["stripe-signature"] as string);
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as { id: string };
      await finance.confirmCheckout(session.id);
    }
    res.json({ received: true });
  }),
);

financeRouter.use(authenticate);

// Fee structures --------------------------------------------------------
// The administration (ADMIN / SUPER_ADMIN) sets up per-grade / per-year
// payment amounts (monthly, termly, annual); the registrar and accountant
// read them to process collections at the preset amounts.
financeRouter.get("/fee-structures", requireRoles("ADMIN", "REGISTRAR", "ACCOUNTANT"),
  validateQuery(z.object({ academicYearId: z.string().optional() })),
  asyncHandler(async (req, res) => {
    // Defaults to the active year; pass academicYearId to view another year's.
    res.json(ok(await finance.listFeeStructures(parsedQuery<{ academicYearId?: string }>(req).academicYearId)));
  }));

financeRouter.post("/fee-structures", requireRoles("ADMIN"), validateBody(createFeeStructureSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(ok(await finance.createFeeStructure(req.body)));
  }));

// Retire a preset (kept on old invoices, no longer used for new ones).
financeRouter.delete("/fee-structures/:id", requireRoles("ADMIN"),
  asyncHandler(async (req, res) => {
    res.json(ok(await finance.deactivateFeeStructure(req.params.id), "Fee structure removed"));
  }));

// Invoices --------------------------------------------------------------
const invoiceListQuery = paginationSchema.extend({
  status: z.enum(INVOICE_STATUSES).optional(),
  studentId: z.string().optional(),
  gradeLevel: z.string().optional(), // invoice report filtered by grade
  academicYearId: z.string().optional(), // invoices issued during that year
});

// Registrar processes student fee payments, so they can see invoices too.
financeRouter.get("/invoices", requireRoles("ADMIN", "ACCOUNTANT", "REGISTRAR"), validateQuery(invoiceListQuery),
  asyncHandler(async (req, res) => {
    res.json(ok(await finance.listInvoices(parsedQuery(req))));
  }));

financeRouter.get("/invoices/:id", requireRoles("ADMIN", "ACCOUNTANT", "REGISTRAR"),
  asyncHandler(async (req, res) => {
    res.json(ok(await finance.getInvoice(req.params.id)));
  }));

financeRouter.post("/invoices", requireRoles("ADMIN", "ACCOUNTANT"), validateBody(createInvoiceSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(ok(await finance.createInvoice(req.body), "Invoice created"));
  }));

financeRouter.post("/invoices/bulk", requireRoles("ADMIN", "ACCOUNTANT"), validateBody(bulkInvoiceSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(ok(await finance.bulkInvoice(req.body), "Bulk invoices generated"));
  }));

financeRouter.post("/invoices/:id/void", requireRoles("ADMIN", "ACCOUNTANT"),
  asyncHandler(async (req, res) => {
    res.json(ok(await finance.voidInvoice(req.params.id), "Invoice voided"));
  }));

// Payments --------------------------------------------------------------
financeRouter.post("/payments/manual", requireRoles("ADMIN", "ACCOUNTANT", "REGISTRAR"), validateBody(recordPaymentSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(ok(await finance.recordManualPayment(req.body, req.user!.sub), "Payment recorded"));
  }));

// Registrar cashier flow: bill a month or the whole year (with the
// admin-configured discount) and record the payment in one step.
financeRouter.post("/payments/collect", requireRoles("ADMIN", "ACCOUNTANT", "REGISTRAR"), validateBody(collectPaymentSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(ok(await finance.collectPayment(req.body, req.user!.sub), "Payment collected"));
  }));

// Parents pay via POST /portal/pay (ownership-checked); this staff route
// lets the accounts office start a checkout on a family's behalf.
financeRouter.post("/payments/checkout", requireRoles("ADMIN", "ACCOUNTANT"), validateBody(checkoutSchema),
  asyncHandler(async (req, res) => {
    const { invoiceId, ...urls } = req.body;
    res.json(ok(await finance.createCheckout(invoiceId, urls)));
  }));

// Redirect-based checkout confirmation: any signed-in payer (parents come
// back from Stripe to the portal; staff to the finance page) posts the
// session id; the server verifies the payment WITH STRIPE before marking it
// succeeded, so this endpoint can't be abused to forge payments.
const confirmSessionSchema = z.object({ sessionId: z.string().min(1).max(255) });

financeRouter.post("/payments/confirm",
  requireRoles("ADMIN", "ACCOUNTANT", "REGISTRAR", "PARENT", "STUDENT"),
  validateBody(confirmSessionSchema),
  asyncHandler(async (req, res) => {
    res.json(ok(await finance.confirmCheckoutSession(req.body.sessionId)));
  }));

// Transactions ----------------------------------------------------------
const paymentListQuery = paginationSchema.extend({
  status: z.enum(PAYMENT_STATUSES).optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  academicYearId: z.string().optional(), // payments taken during that year
  currency: z.string().length(3).optional(), // list only one currency's payments
});

financeRouter.get("/payments", requireRoles("ADMIN", "ACCOUNTANT", "REGISTRAR"), validateQuery(paymentListQuery),
  asyncHandler(async (req, res) => {
    res.json(ok(await finance.listPayments(parsedQuery(req))));
  }));

financeRouter.get("/payments/:id", requireRoles("ADMIN", "ACCOUNTANT", "REGISTRAR"),
  asyncHandler(async (req, res) => {
    res.json(ok(await finance.getPayment(req.params.id)));
  }));

// Refunds are reserved for the SUPER_ADMIN (requireRoles() with no roles
// admits only SUPER_ADMIN). The refund keeps the payment row for auditing.
financeRouter.post("/payments/:id/refund", requireRoles(), validateBody(refundPaymentSchema),
  asyncHandler(async (req, res) => {
    res.json(ok(await finance.refundPayment(req.params.id, req.body.reason, req.user!.sub), "Payment refunded"));
  }));

// Reporting -------------------------------------------------------------
financeRouter.get("/overview", requireRoles("ADMIN", "ACCOUNTANT", "REGISTRAR"),
  validateQuery(z.object({ academicYearId: z.string().optional() })),
  asyncHandler(async (req, res) => {
    res.json(ok(await finance.financeOverview(parsedQuery<{ academicYearId?: string }>(req).academicYearId)));
  }));

// Per-year finance report (any year, incl. previous ones): totals plus
// grade / month / status breakdowns over the year's invoices.
financeRouter.get("/report", requireRoles("ADMIN", "ACCOUNTANT", "REGISTRAR"),
  validateQuery(z.object({ academicYearId: z.string().min(1) })),
  asyncHandler(async (req, res) => {
    res.json(ok(await finance.financeYearReport(parsedQuery<{ academicYearId: string }>(req).academicYearId)));
  }));
