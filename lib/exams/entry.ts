// The gate every change to marks goes through: the person must be the teacher of the assignment (or an administrator), the
// assignment live, and the mark sheet open for marks (not submitted, verified or published).
import { ServiceError } from '@/lib/api';
import type { Db } from '@/lib/scoped-db';
import { EDITABLE, STATUS_LABEL, assertLive, assertOwnAssignment, ensureSheet, loadAssignment, type Actor } from '@/lib/exams/common';

export async function openForEntry(tx: Db, user: Actor, assignmentId: string) {
  const a = await loadAssignment(tx, user.schoolId, assignmentId);
  assertOwnAssignment(user, a, 'exams.marks.enter');
  assertLive(a);
  const sheet = await ensureSheet(tx, user.schoolId, a);
  if (!EDITABLE.includes(sheet.status)) {
    throw new ServiceError(`This mark sheet is ${STATUS_LABEL[sheet.status].toLowerCase()}, so marks cannot be changed. ${sheet.status === 'SUBMITTED' ? 'Wait for the verifier, or ask them to return it.' : 'Only the Head can open it again.'}`, 409);
  }
  return { a, sheet };
}
