import { Router, raw } from "express";
import { z } from "zod";
import {
  createFeeStructureSchema, createInvoiceSchema, bulkInvoiceSchema,
  recordPaymentSchema, checkoutSchema, collectPaymentSchema,
  paginationSchema, INVOICE_STATUSES,
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
// Registrar and Admin set up per-grade / per-year payment amounts
// (monthly, termly, annual); the accountant can too.
financeRouter.get("/fee-structures", requireRoles("ADMIN", "REGISTRAR", "ACCOUNTANT"),
  asyncHandler(async (_req, res) => {
    res.json(ok(await finance.listFeeStructures()));
  }));

financeRouter.post("/fee-structures", requireRoles("ADMIN", "REGISTRAR", "ACCOUNTANT"), validateBody(createFeeStructureSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(ok(await finance.createFeeStructure(req.body)));
  }));

// Invoices --------------------------------------------------------------
const invoiceListQuery = paginationSchema.extend({
  status: z.enum(INVOICE_STATUSES).optional(),
  studentId: z.string().optional(),
  gradeLevel: z.string().optional(), // invoice report filtered by grade
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

// Reporting -------------------------------------------------------------
financeRouter.get("/overview", requireRoles("ADMIN", "ACCOUNTANT", "REGISTRAR"),
  asyncHandler(async (_req, res) => {
    res.json(ok(await finance.financeOverview()));
  }));
