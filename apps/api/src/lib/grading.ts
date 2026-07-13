import { GRADE_BANDS } from "@vertik12/shared";
import { prisma } from "./prisma";

/**
 * Grading is configurable per school/country (Super Admin › Grading):
 * the admin defines bands like "≥95 = A+" or "≥90 = A", and every grade
 * the system generates (exam results, report cards) uses that scale.
 * Falls back to the built-in default scale until the admin sets one.
 */
export interface Band {
  letter: string;
  minPercent: number;
  points: number;
}

export async function getGradeScale(): Promise<Band[]> {
  const bands = await prisma.gradeBand.findMany({ orderBy: { minPercent: "desc" } });
  if (bands.length > 0) {
    return bands.map((b) => ({ letter: b.letter, minPercent: b.minPercent, points: b.points }));
  }
  return GRADE_BANDS.map((b) => ({ letter: b.letter, minPercent: b.min, points: b.points }));
}

/** Highest band whose lower bound the percentage reaches. */
export function gradeFor(percentage: number, scale: Band[]): Band {
  return scale.find((b) => percentage >= b.minPercent) ?? scale[scale.length - 1]!;
}

/** Replace the whole scale atomically. */
export async function setGradeScale(bands: Array<{ letter: string; minPercent: number; points: number }>) {
  const sorted = [...bands].sort((a, b) => b.minPercent - a.minPercent);
  await prisma.$transaction([
    prisma.gradeBand.deleteMany(),
    prisma.gradeBand.createMany({
      data: sorted.map((b, i) => ({ ...b, sortOrder: i })),
    }),
  ]);
  return getGradeScale();
}
