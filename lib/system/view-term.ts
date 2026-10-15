// The term a person is LOOKING at (term switcher). It is a per-browser choice kept
// in a cookie and checked against the school on every read. It never changes which
// term is open.
import { cookies } from 'next/headers';
import { getOpenTerm, listTerms } from '@/lib/academic/terms';
import type { Db } from '@/lib/scoped-db';

export const VIEW_TERM_COOKIE = 'pfuma_term';

/** Picks the term to show: the chosen one if it belongs to the school, else the open term, else the newest. */
export function pickViewTerm<T extends { id: string; status: string }>(terms: T[], chosenId: string | undefined): T | null {
  return terms.find((t) => t.id === chosenId) ?? terms.find((t) => t.status === 'OPEN') ?? terms[0] ?? null;
}

export async function getViewTerm(schoolId: string, db: Db) {
  const terms = await listTerms(schoolId, db);
  let chosen: string | undefined;
  try {
    chosen = cookies().get(VIEW_TERM_COOKIE)?.value;
  } catch {
    // Not inside a request (a test or a script): show the open term.
  }
  return { terms, term: pickViewTerm(terms, chosen), openTerm: terms.find((t) => t.status === 'OPEN') ?? null };
}

export { getOpenTerm };
