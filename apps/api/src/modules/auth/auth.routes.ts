import { Router } from "express";
import { changePasswordSchema, loginSchema } from "@vertik12/shared";
import { z } from "zod";
import { authenticate } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { asyncHandler } from "../../middleware/error-handler";
import { loginRateLimit, refreshRateLimit, changePasswordRateLimit } from "../../middleware/rate-limit";
import { ok } from "../../lib/pagination";
import * as auth from "./auth.service";

export const authRouter = Router();

authRouter.post(
  "/login",
  loginRateLimit,
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    res.json(ok(await auth.login(req.body)));
  }),
);

const refreshSchema = z.object({ refreshToken: z.string().min(1) });

authRouter.post(
  "/refresh",
  refreshRateLimit,
  validateBody(refreshSchema),
  asyncHandler(async (req, res) => {
    res.json(ok(await auth.refresh(req.body.refreshToken)));
  }),
);

authRouter.post(
  "/logout",
  validateBody(refreshSchema),
  asyncHandler(async (req, res) => {
    await auth.logout(req.body.refreshToken);
    res.json(ok(null, "Logged out"));
  }),
);

authRouter.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    res.json(ok(await auth.me(req.user!.sub)));
  }),
);

authRouter.post(
  "/change-password",
  authenticate,
  changePasswordRateLimit,
  validateBody(changePasswordSchema),
  asyncHandler(async (req, res) => {
    await auth.changePassword(req.user!.sub, req.body.currentPassword, req.body.newPassword);
    res.json(ok(null, "Password updated"));
  }),
);
