"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { get } from "@/lib/api";
import { formatMoney, fullName, gradeLabel } from "@/lib/format";
import { Card, PageHeader, Spinner } from "@/components/ui";

interface ChildCard {
  id: string;
  admissionNo: string;
  firstName: string;
  lastName: string;
  gradeLevel: string;
  relation: string;
  className: string | null;
  homeroomTeacher: string | null;
  attendanceRate: number | null;
  outstandingBalance: number;
}

/** Parent portal home — one card per child (multi-child support). */
export default function PortalHome() {
  const [children, setChildren] = useState<ChildCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    get<ChildCard[]>("/portal/children").then(setChildren).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="text-sm text-rose-600">{error}</p>;
  if (!children)
    return (
      <div className="flex justify-center py-24 text-brand-600">
        <Spinner />
      </div>
    );

  return (
    <div>
      <PageHeader title="My Children" subtitle="Select a child to see grades, attendance and fees" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {children.map((c) => (
          <Link key={c.id} href={`/portal/${c.id}`}>
            <Card className="h-full p-5 transition-shadow hover:shadow-md">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-lg font-semibold text-brand-700">
                  {c.firstName[0]}
                  {c.lastName[0]}
                </div>
                <div>
                  <h2 className="font-semibold text-slate-900">{fullName(c)}</h2>
                  <p className="text-xs text-slate-500">
                    {gradeLabel(c.gradeLevel)} · {c.className ?? "No class"} · {c.admissionNo}
                  </p>
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-slate-50 p-3">
                  <dt className="text-xs text-slate-500">Attendance</dt>
                  <dd className="mt-0.5 font-semibold text-slate-800">
                    {c.attendanceRate === null ? "—" : `${c.attendanceRate}%`}
                  </dd>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <dt className="text-xs text-slate-500">Fees due</dt>
                  <dd className={`mt-0.5 font-semibold ${c.outstandingBalance > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                    {formatMoney(c.outstandingBalance)}
                  </dd>
                </div>
              </dl>
              {c.homeroomTeacher && (
                <p className="mt-3 text-xs text-slate-400">Homeroom: {c.homeroomTeacher}</p>
              )}
            </Card>
          </Link>
        ))}
        {children.length === 0 && (
          <p className="text-sm text-slate-400">No students are linked to this account yet — please contact the school office.</p>
        )}
      </div>
    </div>
  );
}
