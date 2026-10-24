// Letters HR can produce in a minute: the template is filled in with the school's and the employee's details, given a reference number
// and saved to the employee's Documents tab. The letterhead (name, address, logo) and the signature block are added when it is printed
// (components render the saved text); the text here is only the body.
import { z } from 'zod';
import type { Employee, School } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { audit, canSeePay, employeeById, fullName, hrHolds, isoDateSchema, isoOf, logSensitiveView, need, nextNumber, optText, todayInHarare, type Actor } from '@/lib/hr/common';

export const LETTER_TEMPLATES = ['APPOINTMENT', 'CONTRACT', 'CONFIRMATION', 'SALARY_CHANGE', 'WARNING', 'SUSPENSION', 'CERTIFICATE_OF_SERVICE', 'CONFIRMATION_OF_EMPLOYMENT', 'RECOMMENDATION', 'LEAVING'] as const;
export type LetterTemplate = (typeof LETTER_TEMPLATES)[number];

export const LETTER_LABEL: Record<LetterTemplate, string> = {
  APPOINTMENT: 'Appointment letter', CONTRACT: 'Contract of employment', CONFIRMATION: 'Confirmation after probation', SALARY_CHANGE: 'Salary change', WARNING: 'Warning letter',
  SUSPENSION: 'Suspension letter', CERTIFICATE_OF_SERVICE: 'Certificate of service', CONFIRMATION_OF_EMPLOYMENT: 'Confirmation of employment', RECOMMENDATION: 'Letter of recommendation', LEAVING: 'Leaving letter',
};

const DOC_KIND: Record<LetterTemplate, string> = { APPOINTMENT: 'APPOINTMENT_LETTER', CONTRACT: 'CONTRACT', WARNING: 'DISCIPLINARY', SUSPENSION: 'DISCIPLINARY', CONFIRMATION: 'LETTER', SALARY_CHANGE: 'LETTER', CERTIFICATE_OF_SERVICE: 'CERTIFICATE', CONFIRMATION_OF_EMPLOYMENT: 'LETTER', RECOMMENDATION: 'LETTER', LEAVING: 'LETTER' };
/** Letters that go to disciplinary records are visible to HR, the Head and the Owner only. */
const RESTRICTED: LetterTemplate[] = ['WARNING', 'SUSPENSION'];

export const LetterFields = z.object({
  effectiveDate: isoDateSchema.optional(), endDate: isoDateSchema.optional(), jobTitle: optText(80), salaryText: optText(80), previousSalaryText: optText(80),
  hours: optText(80), noticePeriod: optText(80), probationEnd: isoDateSchema.optional(), reason: optText(600), outcome: optText(300), lastDay: isoDateSchema.optional(), note: optText(800),
});
export type LetterFieldsT = Partial<z.infer<typeof LetterFields>>;

const fmt = (iso?: string | null) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '');

/** Years and months between two dates, for a certificate of service. */
export function serviceLength(startIso: string, endIso: string): string {
  const s = new Date(`${startIso}T00:00:00Z`), e = new Date(`${endIso}T00:00:00Z`);
  let months = (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth());
  if (e.getUTCDate() < s.getUTCDate()) months--;
  months = Math.max(0, months);
  const y = Math.floor(months / 12), m = months % 12;
  return [y ? `${y} year${y === 1 ? '' : 's'}` : '', m ? `${m} month${m === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ') || 'less than a month';
}

/** The text of a letter. Pure: the school, the employee and the fields in, paragraphs out. */
export function renderLetter(t: LetterTemplate, school: Pick<School, 'name'>, e: Pick<Employee, 'title' | 'firstName' | 'surname' | 'jobTitle' | 'startDate' | 'leavingDate' | 'employeeNo'>, f: LetterFieldsT, today: string): { title: string; paragraphs: string[] } {
  const name = fullName(e, true);
  const job = f.jobTitle ?? e.jobTitle;
  const start = isoOf(e.startDate);
  const eff = f.effectiveDate ?? today;
  const dear = `Dear ${name}`;
  const sign = 'Yours faithfully,';
  const body: Record<LetterTemplate, string[]> = {
    APPOINTMENT: [dear, `We are pleased to confirm your appointment as ${job} at ${school.name}, starting on ${fmt(f.effectiveDate ?? start)}.`,
      ...(f.salaryText ? [`Your remuneration will be ${f.salaryText}.`] : []), ...(f.probationEnd ? [`Your appointment is subject to a probation period ending on ${fmt(f.probationEnd)}.`] : []),
      'Please sign and return a copy of this letter to accept the appointment.', sign],
    CONTRACT: [`CONTRACT OF EMPLOYMENT between ${school.name} (the Employer) and ${name} (the Employee, number ${e.employeeNo}).`,
      `1. Position: ${job}.`, `2. Start date: ${fmt(f.effectiveDate ?? start)}.${f.endDate ? ` End date: ${fmt(f.endDate)}.` : ''}`,
      ...(f.probationEnd ? [`3. Probation: until ${fmt(f.probationEnd)}.`] : []), `${f.probationEnd ? '4' : '3'}. Hours of work: ${f.hours ?? 'as set by the Employer'}.`,
      `${f.probationEnd ? '5' : '4'}. Remuneration: ${f.salaryText ?? 'as agreed in writing'}.`, `${f.probationEnd ? '6' : '5'}. Notice: ${f.noticePeriod ?? 'as the Labour Act and the school rules require'}.`,
      'The Employee will carry out the duties of the position and follow the rules of the school. This contract is signed in two copies, one for each party.'],
    CONFIRMATION: [dear, `We are pleased to confirm your appointment as ${job} at ${school.name} following the successful end of your probation on ${fmt(f.effectiveDate ?? today)}.`, sign],
    SALARY_CHANGE: [dear, `With effect from ${fmt(eff)} your remuneration will change${f.previousSalaryText ? ` from ${f.previousSalaryText}` : ''}${f.salaryText ? ` to ${f.salaryText}` : ''}.`, ...(f.reason ? [f.reason] : []), sign],
    WARNING: [dear, `This is a ${f.outcome ?? 'written warning'} about the following matter: ${f.reason ?? ''}`, 'Further breaches of the school rules may lead to stronger disciplinary action. You have the right to appeal to the Head within seven days.', sign],
    SUSPENSION: [dear, `You are suspended from duty with effect from ${fmt(eff)}${f.endDate ? ` until ${fmt(f.endDate)}` : ' pending the outcome of the disciplinary process'}.`, ...(f.reason ? [`Reason: ${f.reason}`] : []), 'You must not come to school or contact learners during the suspension unless you are called to a hearing.', sign],
    CERTIFICATE_OF_SERVICE: ['CERTIFICATE OF SERVICE', `This is to certify that ${name} (${e.employeeNo}) worked at ${school.name} as ${job} from ${fmt(start)} to ${fmt(f.lastDay ?? (e.leavingDate ? isoOf(e.leavingDate) : today))}, a period of ${serviceLength(start, f.lastDay ?? (e.leavingDate ? isoOf(e.leavingDate) : today))}.`, ...(f.note ? [f.note] : []), sign],
    CONFIRMATION_OF_EMPLOYMENT: ['TO WHOM IT MAY CONCERN', `This is to confirm that ${name} is employed at ${school.name} as ${job} and has been since ${fmt(start)}.`, 'This letter is issued at the request of the employee and carries no liability for the school.', sign],
    RECOMMENDATION: ['TO WHOM IT MAY CONCERN', `${name} worked at ${school.name} as ${job} from ${fmt(start)}${e.leavingDate ? ` to ${fmt(isoOf(e.leavingDate))}` : ''}.`, f.note ?? 'During this time they carried out their duties conscientiously and we recommend them.', sign],
    LEAVING: [dear, `We confirm that your employment as ${job} at ${school.name} ends on ${fmt(f.lastDay ?? eff)}.`, ...(f.reason ? [f.reason] : []), 'Please return all school property and complete the exit clearance before your last day. We thank you for your service.', sign],
  };
  return { title: LETTER_LABEL[t], paragraphs: body[t] };
}

/** Makes the letter and saves it to the employee's documents with a reference number (LTR-2026-0007). Inside the caller's transaction. */
export async function saveLetter(tx: Db, user: Actor, e: Employee, template: LetterTemplate, fields: LetterFieldsT) {
  const school = await tx.school.findUniqueOrThrow({ where: { id: user.schoolId }, select: { name: true } });
  const today = todayInHarare();
  const { title, paragraphs } = renderLetter(template, school, e, fields, today);
  const year = Number(today.slice(0, 4));
  const reference = `LTR-${year}-${String(await nextNumber(tx, user.schoolId, `LTR:${year}`)).padStart(4, '0')}`;
  const doc = await tx.employeeDocument.create({
    data: { schoolId: user.schoolId, employeeId: e.id, kind: DOC_KIND[template], title: `${title} ${today}`, reference, body: paragraphs.join('\n\n'), restricted: RESTRICTED.includes(template), uploadedById: user.id },
  });
  await audit(tx, user, 'HR_GENERATE_LETTER', 'EmployeeDocument', doc.id, `${title} for ${fullName(e)} (${reference})`, undefined, { template, reference });
  return { id: doc.id, reference, title, paragraphs };
}

export const GenerateLetterSchema = z.object({ template: z.enum(LETTER_TEMPLATES), fields: LetterFields.optional().transform((v): LetterFieldsT => v ?? {}) });


export async function generateLetter(user: Actor, employeeId: string, raw: unknown) {
  need(user, 'hr.documents.manage');
  const v = GenerateLetterSchema.parse(raw);
  if (RESTRICTED.includes(v.template)) need(user, 'hr.discipline.manage');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const e = await employeeById(tx, user.schoolId, employeeId);
    if ((v.template === 'SALARY_CHANGE' || v.template === 'CONTRACT' || v.template === 'APPOINTMENT') && (v.fields.salaryText || v.template === 'SALARY_CHANGE')) {
      // A letter that quotes pay is a look at pay.
      if (!canSeePay(user)) throw new ServiceError('Letters that quote pay need permission to see pay', 403);
      await logSensitiveView(tx, user, e, 'SALARY', `${v.template.toLowerCase()} letter`);
    }
    return saveLetter(tx, user, e, v.template, v.fields);
  });
}

/** A saved letter for printing. HR, or the employee for their own (not disciplinary ones). */
export async function getLetter(user: Actor, documentId: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const d = await tx.employeeDocument.findFirst({ where: { id: documentId, schoolId: user.schoolId } });
    if (!d || !d.body) throw new ServiceError('Letter not found', 404);
    const e = await employeeById(tx, user.schoolId, d.employeeId);
    const own = e.userId === user.id;
    if (d.restricted) { if (!hrHolds(user, 'hr.discipline.view')) throw new ServiceError('Forbidden', 403); }
    else if (!own) need(user, 'hr.documents.manage', 'hr.employees.view');
    const school = await tx.school.findUniqueOrThrow({ where: { id: user.schoolId }, select: { name: true, address: true, phone: true, email: true, logoUrl: true } });
    return { id: d.id, reference: d.reference, title: d.title, paragraphs: d.body.split('\n\n'), employee: fullName(e, true), school };
  });
}

