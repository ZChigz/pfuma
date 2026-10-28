// Who is away from the hostel or the classroom for a reason the system already knows: on exeat, in the sick bay, or suspended. The hostel roll
// call and the class register both ask here, so a learner shows as "On exeat" or "In sick bay" in both and nobody marks them absent by mistake.
import type { Db } from '@/lib/scoped-db';

const DAY = 86_400_000;
const startOf = (iso: string) => new Date(`${iso}T00:00:00+02:00`);

/** Learners on exeat on a day: signed out on or before it, and not signed back in before it began. */
export async function exeatOn(tx: Db, date: string, studentIds: string[]): Promise<Set<string>> {
  if (studentIds.length === 0) return new Set();
  const from = startOf(date);
  const to = new Date(from.getTime() + DAY);
  const rows = await tx.facExeat.findMany({
    where: { studentId: { in: studentIds }, status: { in: ['SIGNED_OUT', 'RETURNED'] }, signedOutAt: { lt: to }, OR: [{ signedInAt: null }, { signedInAt: { gte: from } }] },
    select: { studentId: true },
  });
  return new Set(rows.map((r) => r.studentId));
}

/** Learners in the sick bay at a moment: admitted and not yet discharged. Only that fact leaves the sick bay, never the complaint or the treatment. */
export async function inSickBayAt(tx: Db, at: Date, studentIds: string[]): Promise<Set<string>> {
  if (studentIds.length === 0) return new Set();
  const rows = await tx.facSickBayVisit.findMany({
    where: { studentId: { in: studentIds }, admittedAt: { lte: at }, OR: [{ dischargedAt: null }, { dischargedAt: { gt: at } }] },
    select: { studentId: true },
  });
  return new Set(rows.map((r) => r.studentId));
}

/** Learners kept in the sick bay at any time on a day (admitted by its end, not discharged before its start). */
export async function sickBayStudentIds(tx: Db, date: string, studentIds: string[]): Promise<Set<string>> {
  if (studentIds.length === 0) return new Set();
  const from = startOf(date);
  const to = new Date(from.getTime() + DAY);
  const rows = await tx.facSickBayVisit.findMany({ where: { studentId: { in: studentIds }, admittedAt: { lt: to }, OR: [{ dischargedAt: null }, { dischargedAt: { gt: from } }] }, select: { studentId: true } });
  return new Set(rows.map((r) => r.studentId));
}

export type Away = 'EXEAT' | 'SICK_BAY' | 'SUSPENDED';

/** Exeat first, then sick bay, then suspended: the reason shown when more than one is true. */
export async function awayStatus(tx: Db, schoolId: string, studentIds: string[], at: Date, date: string): Promise<Map<string, Away>> {
  const out = new Map<string, Away>();
  if (studentIds.length === 0) return out;
  const [exeat, sick, students, suspensions] = await Promise.all([
    exeatOn(tx, date, studentIds), inSickBayAt(tx, at, studentIds),
    tx.student.findMany({ where: { schoolId, id: { in: studentIds }, status: 'SUSPENDED' }, select: { id: true } }),
    tx.disciplineAction.findMany({ where: { schoolId, type: 'SUSPENSION', status: 'APPROVED', studentId: { in: studentIds }, startDate: { lte: startOf(date) }, endDate: { gte: startOf(date) } }, select: { studentId: true } }),
  ]);
  for (const id of studentIds) {
    if (exeat.has(id)) out.set(id, 'EXEAT');
    else if (sick.has(id)) out.set(id, 'SICK_BAY');
    else if (students.some((s) => s.id === id) || suspensions.some((s) => s.studentId === id)) out.set(id, 'SUSPENDED');
  }
  return out;
}
