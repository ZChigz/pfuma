// Positions and averages.
//
//  • Overall average = the mean of the student's subject term marks over the subjects they actually take (subjects left
//    out as exempt do not count). Not a raw total, so students with different numbers of electives compare fairly.
//  • Ties use standard competition ranking on values rounded to 2 decimal places: 1, 2, 2, 4.
import { round2 } from '@/lib/results/legacy';

export interface Ranked { position: number; size: number }

/** Highest value first; equal values share a position and the next one is skipped. Items without a value are not ranked. */
export function rankDescending<T extends { id: string; value: number | null }>(items: T[]): Map<string, Ranked> {
  const ranked = items.filter((i): i is T & { value: number } => i.value !== null && Number.isFinite(i.value)).map((i) => ({ id: i.id, v: round2(i.value) }));
  ranked.sort((a, b) => b.v - a.v);
  const out = new Map<string, Ranked>();
  let position = 1;
  ranked.forEach((r, i) => {
    if (i > 0 && r.v !== ranked[i - 1]!.v) position = i + 1;
    out.set(r.id, { position, size: ranked.length });
  });
  return out;
}

/** The mean of the subject term marks that count (null entries are subjects left out), to 2 decimal places; null when none count. */
export function overallAverage(termMarks: (number | null)[]): number | null {
  const counted = termMarks.filter((m): m is number => m !== null && Number.isFinite(m));
  if (counted.length === 0) return null;
  return round2(counted.reduce((a, b) => a + b, 0) / counted.length);
}

/** "Position 2 of 42". */
export const positionText = (r: Ranked | undefined | null) => (r ? `${r.position} of ${r.size}` : '');
