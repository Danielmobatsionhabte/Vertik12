import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { BRAND } from "@vertik12/shared";
import { env, isProd } from "./config/env";
import { errorHandler } from "./middleware/error-handler";
import { authRouter } from "./modules/auth/auth.routes";
import { studentsRouter } from "./modules/students/students.routes";
import { staffRouter } from "./modules/staff/staff.routes";
import { academicsRouter } from "./modules/academics/academics.routes";
import { attendanceRouter } from "./modules/attendance/attendance.routes";
import { examsRouter } from "./modules/exams/exams.routes";
import { financeRouter } from "./modules/finance/finance.routes";
import { payrollRouter } from "./modules/payroll/payroll.routes";
import { announcementsRouter } from "./modules/announcements/announcements.routes";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes";
import { adminRouter } from "./modules/admin/admin.routes";
import { portalRouter } from "./modules/portal/portal.routes";
import { messagesRouter } from "./modules/messages/messages.routes";
import { assignmentsRouter } from "./modules/assignments/assignments.routes";
import { auditLogger } from "./middleware/audit";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN.split(","), credentials: true }));
  app.use(morgan(isProd ? "combined" : "dev"));

  // The Stripe webhook route needs the raw body for signature verification,
  // so JSON parsing must skip it (the route applies express.raw itself).
  // Assignment routes accept base64 document uploads (≤5 MB before
  // encoding), so they get a larger body cap than the 1 MB default.
  const uploadJson = express.json({ limit: "8mb" });
  const standardJson = express.json({ limit: "1mb" });
  const UPLOAD_PATHS = ["/api/v1/assignments", "/api/v1/portal/assignments"];
  app.use((req, res, next) => {
    if (req.originalUrl === "/api/v1/finance/payments/webhook") return next();
    const parser = UPLOAD_PATHS.some((p) => req.originalUrl.startsWith(p)) ? uploadJson : standardJson;
    parser(req, res, next);
  });

  app.get("/health", (_req, res) =>
    res.json({ status: "ok", app: BRAND.appName, poweredBy: BRAND.poweredBy, time: new Date().toISOString() }),
  );

  const api = express.Router();
  api.use(auditLogger); // audit trail for every mutating call (Super Admin › Audit Logs)
  api.use("/auth", authRouter);
  api.use("/students", studentsRouter);
  api.use("/staff", staffRouter);
  api.use("/academics", academicsRouter);
  api.use("/attendance", attendanceRouter);
  api.use("/exams", examsRouter);
  api.use("/finance", financeRouter);
  api.use("/payroll", payrollRouter);
  api.use("/announcements", announcementsRouter);
  api.use("/dashboard", dashboardRouter);
  api.use("/admin", adminRouter);
  api.use("/portal", portalRouter);
  api.use("/messages", messagesRouter);
  api.use("/assignments", assignmentsRouter);
  app.use("/api/v1", api);

  app.use((_req, res) => res.status(404).json({ success: false, message: "Route not found" }));
  app.use(errorHandler);

  return app;
}
