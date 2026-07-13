"use client";

import type { ReactNode } from "react";
import { EmptyState, Spinner, cx } from "./ui";

/**
 * Generic data table. Pages describe *what* to render per column; the
 * table handles layout, loading, empty states and row clicks.
 *
 *   <DataTable
 *     columns={[{ header: "Name", cell: (s) => s.name }]}
 *     rows={students}
 *     onRowClick={(s) => router.push(`/students/${s.id}`)}
 *   />
 */
export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  className?: string;
}

export function DataTable<T>({ columns, rows, keyFor, loading, emptyTitle = "Nothing here yet", emptyHint, onRowClick }: {
  columns: Column<T>[];
  rows: T[];
  keyFor: (row: T) => string;
  loading?: boolean;
  emptyTitle?: string;
  emptyHint?: string;
  onRowClick?: (row: T) => void;
}) {
  if (loading) {
    return (
      <div className="flex justify-center py-16 text-brand-600">
        <Spinner />
      </div>
    );
  }
  if (rows.length === 0) return <EmptyState title={emptyTitle} hint={emptyHint} />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            {columns.map((c) => (
              <th key={c.header} className={cx("px-4 py-3 font-medium", c.align === "right" && "text-right", c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={keyFor(row)}
              className={cx("border-b border-slate-100 last:border-0", onRowClick && "cursor-pointer hover:bg-slate-50")}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((c) => (
                <td key={c.header} className={cx("px-4 py-3 text-slate-700", c.align === "right" && "text-right tabular-nums", c.className)}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Simple pager for paginated endpoints. */
export function Pager({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
      <button
        className="rounded px-2 py-1 hover:bg-slate-100 disabled:opacity-40"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        ← Prev
      </button>
      <span className="tabular-nums">
        {page} / {totalPages}
      </span>
      <button
        className="rounded px-2 py-1 hover:bg-slate-100 disabled:opacity-40"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
      >
        Next →
      </button>
    </div>
  );
}
