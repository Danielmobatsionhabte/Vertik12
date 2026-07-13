import type { Paginated, PaginationQuery } from "@vertik12/shared";

/** Converts a page query into Prisma skip/take. */
export function toSkipTake(q: PaginationQuery) {
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
}

export function paginate<T>(items: T[], total: number, q: PaginationQuery): Paginated<T> {
  return {
    items,
    total,
    page: q.page,
    pageSize: q.pageSize,
    totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
  };
}

/** Standard success envelope. */
export const ok = <T>(data: T, message?: string) => ({ success: true as const, data, ...(message ? { message } : {}) });
