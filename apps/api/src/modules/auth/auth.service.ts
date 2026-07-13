import type { AuthResponse, LoginInput, Role } from "@vertik12/shared";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../lib/errors";
import {
  hashPassword, hashToken, signAccessToken, signRefreshToken,
  verifyPassword, verifyRefreshToken,
} from "../../lib/auth-tokens";

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function issueTokens(user: { id: string; email: string; firstName: string; lastName: string; role: string; mustChangePassword: boolean }): Promise<AuthResponse> {
  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role as Role,
    name: `${user.firstName} ${user.lastName}`,
  });
  const refreshToken = signRefreshToken(user.id);
  await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash: hashToken(refreshToken), expiresAt: new Date(Date.now() + REFRESH_TTL_MS) },
  });
  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id, email: user.email, firstName: user.firstName,
      lastName: user.lastName, role: user.role as Role,
      mustChangePassword: user.mustChangePassword,
    },
  };
}

export async function login(input: LoginInput): Promise<AuthResponse> {
  const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  // Same error for unknown email and wrong password — don't leak which emails exist.
  if (!user || !user.isActive || !(await verifyPassword(input.password, user.passwordHash))) {
    throw ApiError.unauthorized("Invalid email or password");
  }
  return issueTokens(user);
}

/** Rotates the refresh token: the presented token is revoked and a new pair is issued. */
export async function refresh(token: string): Promise<AuthResponse> {
  const { sub } = verifyRefreshToken(token);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw ApiError.unauthorized("Refresh token is no longer valid");
  }
  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });

  const user = await prisma.user.findUnique({ where: { id: sub } });
  if (!user || !user.isActive) throw ApiError.unauthorized("Account is disabled");
  return issueTokens(user);
}

export async function logout(token: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function me(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true, firstName: true, lastName: true, role: true, mustChangePassword: true,
      staff: { select: { id: true, staffNo: true, designation: true } },
      student: { select: { id: true, admissionNo: true, gradeLevel: true } },
    },
  });
  if (!user) throw ApiError.notFound("User");
  return user;
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
    throw ApiError.badRequest("Current password is incorrect");
  }
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false },
  });
  // Force re-login everywhere else.
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}
