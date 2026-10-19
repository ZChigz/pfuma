// Class statistics for the mark grid and the verification screen: entered count, mean, highest, lowest, pass rate, grade spread
// and marks that sit far from the class mean.
import { round2 } from '@/lib/results/legacy';

export interface ClassStats {
  count: number;
  mean: number | null;
  highest: number | null;
  lowest: number | null;
  /** Percent of the counted values at or above the pass mark; null when nothing counts. */
  passRate: number | null;
  sd: number | null;
}

export function classStats(values: number[], passMark: number): ClassStats {
  if (values.length === 0) return { count: 0, mean: null, highest: null, lowest: null, passRate: null, sd: null };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return {
    count: values.length,
    mean: round2(mean),
    highest: Math.max(...values),
    lowest: Math.min(...values),
    passRate: round2((values.filter((v) => v >= passMark).length / values.length) * 100),
    sd: round2(Math.sqrt(variance)),
  };
}

/** Indices of values more than `sdLimit` standard deviations from the mean (needs a few values and some spread). */
export function outliers(values: (number | null)[], sdLimit = 3): number[] {
  const present = values.filter((v): v is number => v !== null);
  if (present.length < 5) return [];
  const mean = present.reduce((a, b) => a + b, 0) / present.length;
  const sd = Math.sqrt(present.reduce((a, b) => a + (b - mean) ** 2, 0) / present.length);
  if (sd === 0) return [];
  const out: number[] = [];
  values.forEach((v, i) => { if (v !== null && Math.abs(v - mean) > sdLimit * sd) out.push(i); });
  return out;
}

/** Count of each grade, in the order given. */
export function gradeSpread(grades: (string | null)[], order: string[]): { grade: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const g of grades) if (g) counts.set(g, (counts.get(g) ?? 0) + 1);
  return order.map((grade) => ({ grade, count: counts.get(grade) ?? 0 }));
}
