import type { Role } from "./constants";

/** Standard envelope for every API response. */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Payload embedded in the JWT access token. */
export interface AuthTokenPayload {
  sub: string; // user id
  role: Role;
  email: string;
  name: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: Role;
    /** True while the account still uses a temporary password — the web app forces a change. */
    mustChangePassword?: boolean;
  };
}

export interface DashboardStats {
  students: { total: number; byGrade: Array<{ gradeLevel: string; count: number }> };
  staff: { total: number; teaching: number };
  attendanceTodayRate: number | null;
  finance: {
    invoicedThisMonth: number;
    collectedThisMonth: number;
    outstanding: number;
    overdueInvoices: number;
  };
  payroll: { lastRunLabel: string | null; lastRunNet: number };
  /** Unique signed-in users per day — ADMIN/SUPER_ADMIN only (null for others). */
  visitors: {
    today: number;
    last7Days: number;
    trend: Array<{ date: string; count: number }>; // last 14 days, oldest first
  } | null;
  recentAnnouncements: Array<{ id: string; title: string; audience: string; createdAt: string }>;
}
