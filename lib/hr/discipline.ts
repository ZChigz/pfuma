// Staff disciplinary records: visible only to HR, the Head and the Owner. Every look is logged.
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { audit, employeeById, fullName, idSchema, isoDateSchema, isoOf, logSensitiveView, need, optText, textSchema, toDay, type Actor } from '@/lib/hr/common';

export const DisciplineSchema = z.object({
  id: idSchema.optional(), employeeId: idSchema, category: textSchema('the category', 2, 60), description: textSchema('what happened', 5, 2000), incidentDate: isoDateSchema,
  hearingDate: isoDateSchema.optional(), panel: optText(300), outcome: z.enum(['VERBAL_WARNING', 'WRITTEN_WARNING', 'FINAL_WARNING', 'SUSPENSION', 'DISMISSAL', 'NO_ACTION']).optional(),
  appeal: optText(1000), documentKeys: z.array(z.string().trim().min(3).max(300)).max(10).default([]),
}).refine((v) => !v.hearingDate || v.hearingDate >= v.incidentDate, { path: ['hearingDate'], message: 'The hearing cannot be before the incident' });

export async function saveDiscipline(user: Actor, raw: unknown) {
  need(user, 'hr.discipline.manage');
  const { id, ...v } = DisciplineSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const e = await employeeById(tx, user.schoolId, v.employeeId);
    const data = { category: v.category, description: v.description, incidentDate: toDay(v.incidentDate), hearingDate: v.hearingDate ? toDay(v.hearingDate) : null, panel: v.panel ?? null, outcome: v.outcome ?? null, appeal: v.appeal ?? null, documentKeys: v.documentKeys };
    let row;
    if (id) {
      const before = await tx.staffDisciplinary.findFirst({ where: { id, schoolId: user.schoolId, employeeId: v.employeeId } });
      if (!before) throw new ServiceError('Record not found', 404);
      row = await tx.staffDisciplinary.update({ where: { id }, data });
      await audit(tx, user, 'HR_SAVE_DISCIPLINE', 'StaffDisciplinary', id, `Updated a disciplinary record of ${fullName(e)}`, { outcome: before.outcome }, { outcome: v.outcome ?? null });
    } else {
      row = await tx.staffDisciplinary.create({ data: { schoolId: user.schoolId, employeeId: v.employeeId, recordedById: user.id, ...data } });
      await audit(tx, user, 'HR_SAVE_DISCIPLINE', 'StaffDisciplinary', row.id, `Opened a disciplinary record of ${fullName(e)} (${v.category})`, undefined, { category: v.category, outcome: v.outcome ?? null });
    }
    return { id: row.id };
  });
}

export async function listDiscipline(user: Actor, employeeId: string) {
  need(user, 'hr.discipline.view', 'hr.discipline.manage');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const e = await employeeById(tx, user.schoolId, employeeId);
    const rows = await tx.staffDisciplinary.findMany({ where: { schoolId: user.schoolId, employeeId }, orderBy: { incidentDate: 'desc' } });
    if (rows.length) await logSensitiveView(tx, user, e, 'DISCIPLINE', 'disciplinary record');
    return rows.map((r) => ({ ...r, incidentDate: isoOf(r.incidentDate), hearingDate: r.hearingDate ? isoOf(r.hearingDate) : null, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() }));
  });
}
