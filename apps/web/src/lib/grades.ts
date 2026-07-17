"use client";

import { useEffect, useState } from "react";
import { get } from "./api";

/**
 * The school's grade ladder — admin-configured (naming varies by country),
 * fetched once per session and shared by every dropdown. Call
 * `invalidateGrades()` after the admin edits the ladder so open pages
 * refresh on their next mount.
 */
export interface GradeDef {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
}

let cache: GradeDef[] | null = null;
let inflight: Promise<GradeDef[]> | null = null;

export function fetchGrades(): Promise<GradeDef[]> {
  if (cache) return Promise.resolve(cache);
  inflight ??= get<GradeDef[]>("/academics/grades")
    .then((g) => {
      cache = g;
      return g;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function invalidateGrades() {
  cache = null;
}

export function useGrades(): GradeDef[] {
  const [grades, setGrades] = useState<GradeDef[]>(cache ?? []);
  useEffect(() => {
    let alive = true;
    fetchGrades().then((g) => {
      if (alive) setGrades(g);
    }).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return grades;
}

/** Display label for a grade code, from the ladder when known. */
export function gradeName(grades: GradeDef[], code: string): string {
  const hit = grades.find((g) => g.code === code);
  if (hit) return hit.name;
  return code === "K" ? "Kindergarten" : `Grade ${code}`;
}
