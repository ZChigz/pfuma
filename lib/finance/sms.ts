// Text messages Finance sends (receipt copies, balances, reminders). They are queued in the same outbox the rest of Pfuma uses, and only when the
// Communication module is on for the school; a guardian who has asked not to get messages gets none.
import type { Db } from '@/lib/scoped-db';

export async function communicationOn(tx: Db, schoolId: string): Promise<boolean> {
  return !(await tx.schoolModule.findFirst({ where: { schoolId, module: 'communication', enabled: false }, select: { module: true } }));
}

export interface Contact { guardianId: string; name: string; phone: string }

/** The guardians who pay a learner's fees (else the primary guardian) and may be sent messages. */
export async function feePayerContacts(tx: Db, schoolId: string, studentId: string): Promise<Contact[]> {
  const links = await tx.studentGuardian.findMany({
    where: { studentId, canReceiveSms: true, student: { schoolId } },
    select: { isFeePayer: true, isPrimary: true, guardian: { select: { id: true, fullName: true, phone: true } } },
  });
  const payers = links.filter((l) => l.isFeePayer);
  const chosen = payers.length ? payers : links.filter((l) => l.isPrimary);
  return chosen.map((l) => ({ guardianId: l.guardian.id, name: l.guardian.fullName, phone: l.guardian.phone }));
}

/** Queues a message to each contact. `key` makes sending the same notice twice do nothing. Returns how many were queued. */
export async function queueSms(tx: Db, schoolId: string, contacts: Contact[], body: string, o: { studentId?: string; key?: string } = {}): Promise<number> {
  if (contacts.length === 0) return 0;
  if (!(await communicationOn(tx, schoolId))) return 0;
  const res = await tx.messageOutbox.createMany({
    data: contacts.map((c) => ({ schoolId, toPhone: c.phone, body: body.slice(0, 600), studentId: o.studentId ?? null, guardianId: c.guardianId, dedupeKey: o.key ? `${o.key}:${c.guardianId}` : null })),
    skipDuplicates: true,
  });
  return res.count;
}
