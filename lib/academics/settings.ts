// Settings of the Academics module (sessions of the register, subject counts, teaching load, attendance alerts)
// and the date by which schemes of work are due.
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { getScopedDb } from '@/lib/scoped-db';
import { assertWritable, isoDateSchema, loadSettings, resolveTerm, toDay, isoOf, type Actor } from '@/lib/academics/common';

export const SettingsSchema = z
  .object({
    afternoonRegister: z.boolean(),
    perLessonAttendance: z.boolean(),
    lessonPlans: z.boolean(),
    minSubjectsOLevel: z.number().int().min(0).max(30),
    maxSubjectsOLevel: z.number().int().min(1).max(30),
    minSubjectsALevel: z.number().int().min(0).max(15),
    maxSubjectsALevel: z.number().int().min(1).max(15),
    maxPeriodsPerWeek: z.number().int().min(1).max(80),
    absentSmsAlert: z.boolean(),
    chronicAbsenceAlert: z.boolean(),
    consecutiveAbsentDays: z.number().int().min(1).max(30),
    attendanceThresholdPct: z.number().int().min(1).max(100),
  })
  .partial()
  .strict();
export type SettingsInput = z.input<typeof SettingsSchema>;

export async function getSettings(user: Actor) {
  return getScopedDb(user.schoolId, user.id).$tx((tx) => loadSettings(tx, user.schoolId));
}

export async function saveSettings(user: Actor, raw: SettingsInput) {
  const input = SettingsSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const before = await loadSettings(tx, user.schoolId);
    const next = { ...before, ...input };
    if (next.maxSubjectsOLevel < next.minSubjectsOLevel) throw new ServiceError('The most O Level subjects cannot be fewer than the least', 422);
    if (next.maxSubjectsALevel < next.minSubjectsALevel) throw new ServiceError('The most A Level subjects cannot be fewer than the least', 422);
    const changed = Object.keys(input).filter((k) => (input as Record<string, unknown>)[k] !== (before as Record<string, unknown>)[k]);
    if (changed.length === 0) return before;
    const after = await tx.academicsSettings.update({ where: { schoolId: user.schoolId }, data: input });
    await logAudit(
      {
        schoolId: user.schoolId, actorId: user.id, action: 'UPDATE_ACADEMICS_SETTINGS', entityType: 'AcademicsSettings', entityId: after.id,
        detail: `Academics settings changed: ${changed.join(', ')}`,
        before: Object.fromEntries(changed.map((k) => [k, (before as Record<string, unknown>)[k] as never])),
        after: Object.fromEntries(changed.map((k) => [k, (after as Record<string, unknown>)[k] as never])),
      },
      tx,
    );
    return after;
  });
}

/** The Head sets when schemes of work are due for a term (for example the end of week 1). */
export async function setSchemeDueDate(user: Actor, termId: string, dueDate: string | null) {
  const date = dueDate === null ? null : isoDateSchema.parse(dueDate);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await resolveTerm(tx, user.schoolId, termId);
    assertWritable(term);
    if (date && (date < isoOf(term.startDate) || date > isoOf(term.endDate))) throw new ServiceError(`The due date must fall inside ${term.name}`, 422);
    await tx.academicTerm.update({ where: { id: term.id }, data: { schemeDueDate: date ? toDay(date) : null } });
    await logAudit(
      {
        schoolId: user.schoolId, actorId: user.id, action: 'SET_SCHEME_DUE_DATE', entityType: 'AcademicTerm', entityId: term.id,
        detail: `${term.name}: schemes of work due ${date ?? 'no date'}`,
        before: { schemeDueDate: term.schemeDueDate ? isoOf(term.schemeDueDate) : null }, after: { schemeDueDate: date },
      },
      tx,
    );
    return { termId: term.id, schemeDueDate: date };
  });
}
