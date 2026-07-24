import { Router } from "express";
import { publicRegistrationSchema } from "@vertik12/shared";
import { validateBody } from "../../middleware/validate";
import { asyncHandler } from "../../middleware/error-handler";
import { registrationRateLimit } from "../../middleware/rate-limit";
import { ok } from "../../lib/pagination";
import * as registration from "./registration.service";

/**
 * Public admissions — the ONLY unauthenticated module besides sign-in.
 *
 * Parents register their children from the landing page while the school's
 * admission window is open; submissions land as PENDING students for a
 * registrar or admin to review. Both routes are rate limited because they
 * are reachable by anyone on the internet.
 */
export const registrationRouter = Router();

// Is the window open, and what should the form say? Called by the landing
// page (to decide whether to show "Register") and by the form itself.
registrationRouter.get(
  "/status",
  asyncHandler(async (_req, res) => {
    res.json(ok(await registration.registrationStatus()));
  }),
);

registrationRouter.post(
  "/",
  registrationRateLimit,
  validateBody(publicRegistrationSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(ok(await registration.submitRegistration(req.body), "Registration submitted"));
  }),
);
