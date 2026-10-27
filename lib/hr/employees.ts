// Staff directory and employee records. One Employee per person who works at the school, whoever pays them; records are never deleted
// (a leaver keeps their history with a leaving date and a reason). Sensitive fields (ID number, medical notes, salary, bank details)
// are shown only to HR, the Owner and the employee themselves, and every look by someone else is written to HrSensitiveView.
import { z } from 'zod';
import type { Employee, EmployeeCategory, EmployeeStatus, HrEmployer, Prisma } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import * as guards from '@/lib/access/guards';
import { maskTail } from '@/lib/access/serializers/mask';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { normalizeZimbabwePhone } from '@/lib/phone';
import {
  audit, runsIn, canSeePay, centsSchema, currencySchema, employeeById, fullName, hrHolds, idSchema, isoDateSchema, logSensitiveView, need, nextEmployeeNo,
  optText, reasonSchema, tellEmployee, tellHolders, textSchema, toDay, isoOf, todayInHarare, type Actor,
} from '@/lib/hr/common';
import { ensureHrDefaults } from '@/lib/hr/defaults';
import { communicationOn } from '@/lib/finance/sms';

const CATEGORIES = ['TEACHING', 'ADMINISTRATION', 'ANCILLARY', 'BOARDING', 'SECURITY', 'GROUNDS'] as const;
const EMPLOYERS = ['GOVERNMENT', 'SCHOOL'] as const;
const GENDERS = ['M', 'F'] as const;
const WORKING_STATUSES = ['ACTIVE', 'ON_LEAVE', 'SUSPENDED'] as const;

// ─── Directory ───────────────────────────────────────────────────────────────

export interface DirectoryRow {
  id: string; employeeNo: string; name: string; photoKey: string | null; jobTitle: string; department: string | null; category: EmployeeCategory;
  employer: HrEmployer; status: EmployeeStatus; phone: string | null; gender: string | null; hasLogin: boolean;
}

export const DirectoryQuery = z.object({
  q: z.string().trim().max(80).optional(), departmentId: idSchema.optional(), category: z.enum(CATEGORIES).optional(), employer: z.enum(EMPLOYERS).optional(),
  status: z.enum(['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'RESIGNED', 'RETIRED', 'DISMISSED', 'DECEASED']).optional(), gender: z.enum(GENDERS).optional(),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(500).default(50),
});

/**
 * The directory. Someone with only hr.directory.view sees names, titles, departments and the WORK phone; a person who may see full
 * records also sees the personal phone when there is no work number.
 */
export async function listDirectory(user: Actor, raw: unknown = {}) {
  need(user, 'hr.directory.view', 'hr.employees.view');
  const q = DirectoryQuery.parse(raw);
  const full = hrHolds(user, 'hr.employees.view');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const where: Prisma.EmployeeWhereInput = {
      schoolId: user.schoolId,
      ...(q.departmentId ? { departmentId: q.departmentId } : {}), ...(q.category ? { category: q.category } : {}), ...(q.employer ? { employer: q.employer } : {}),
      ...(q.status ? { status: q.status } : {}), ...(q.gender ? { gender: q.gender } : {}),
      ...(q.q ? { OR: [{ firstName: { contains: q.q, mode: 'insensitive' } }, { surname: { contains: q.q, mode: 'insensitive' } }, { employeeNo: { contains: q.q, mode: 'insensitive' } }, { jobTitle: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const [total, rows, depts] = await Promise.all([
      tx.employee.count({ where }),
      tx.employee.findMany({ where, orderBy: [{ surname: 'asc' }, { firstName: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      tx.department.findMany({ where: { schoolId: user.schoolId }, select: { id: true, name: true } }),
    ]);
    const dept = new Map(depts.map((d) => [d.id, d.name]));
    const items: DirectoryRow[] = rows.map((e) => ({
      id: e.id, employeeNo: e.employeeNo, name: fullName(e, true), photoKey: e.photoKey, jobTitle: e.jobTitle, department: e.departmentId ? (dept.get(e.departmentId) ?? null) : null,
      category: e.category, employer: e.employer, status: e.status, phone: e.workPhone ?? (full ? e.personalPhone : null), gender: full ? e.gender : null, hasLogin: !!e.userId,
    }));
    return { total, page: q.page, pageSize: q.pageSize, items, departments: depts };
  });
}

/** The directory as CSV (the same columns the person sees on screen). */
export async function exportDirectory(user: Actor, raw: unknown = {}): Promise<string> {
  need(user, 'hr.directory.view', 'hr.employees.view');
  const { items } = await listDirectory(user, { ...(raw as object), page: 1, pageSize: 500 });
  const cell = (v: string | null) => `"${(v ?? '').replace(/"/g, '""')}"`;
  return ['Employee no,Name,Job title,Department,Category,Employer,Status,Phone', ...items.map((r) => [r.employeeNo, r.name, r.jobTitle, r.department, r.category, r.employer === 'GOVERNMENT' ? 'Government' : 'School', r.status, r.phone].map((v) => cell(v as string | null)).join(','))].join('\n') + '\n';
}

// ─── One record ──────────────────────────────────────────────────────────────

export async function getEmployee(user: Actor, id: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const e = await employeeById(tx, user.schoolId, id);
    const own = e.userId === user.id;
    const full = own || hrHolds(user, 'hr.employees.view');
    if (!full) need(user, 'hr.directory.view');
    const pay = own || canSeePay(user);
    const dept = e.departmentId ? await tx.department.findFirst({ where: { id: e.departmentId, schoolId: user.schoolId }, select: { name: true } }) : null;
    const manager = e.lineManagerId ? await tx.employee.findFirst({ where: { id: e.lineManagerId, schoolId: user.schoolId } }) : null;
    const base = {
      id: e.id, employeeNo: e.employeeNo, name: fullName(e, true), title: e.title, firstName: e.firstName, surname: e.surname, photoKey: e.photoKey, jobTitle: e.jobTitle,
      departmentId: e.departmentId, department: dept?.name ?? null, category: e.category, employer: e.employer, status: e.status, workPhone: e.workPhone,
      lineManager: manager ? { id: manager.id, name: fullName(manager) } : null, userId: full ? e.userId : null,
      access: { full, pay, own },
    };
    if (!full) return { ...base, personal: null, employment: null, nextOfKin: [], qualifications: [], documents: [], history: [], pay: null };

    const [nok, quals, docs, history, exit] = await Promise.all([
      tx.employeeNextOfKin.findMany({ where: { schoolId: user.schoolId, employeeId: id }, orderBy: { createdAt: 'asc' } }),
      tx.employeeQualification.findMany({ where: { schoolId: user.schoolId, employeeId: id }, orderBy: { createdAt: 'asc' } }),
      tx.employeeDocument.findMany({ where: { schoolId: user.schoolId, employeeId: id, ...(!own && hrHolds(user, 'hr.discipline.view') ? {} : { restricted: false }) }, orderBy: { createdAt: 'desc' } }),
      tx.employeeHistory.findMany({ where: { schoolId: user.schoolId, employeeId: id, ...(pay ? {} : { NOT: { field: { startsWith: 'pay.' } } }) }, orderBy: { createdAt: 'desc' }, take: 200 }),
      tx.employeeExit.findUnique({ where: { employeeId: id } }),
    ]);

    const personal = {
      gender: e.gender, dateOfBirth: e.dateOfBirth ? isoOf(e.dateOfBirth) : null, nationality: e.nationality, maritalStatus: e.maritalStatus, homeAddress: e.homeAddress,
      personalPhone: e.personalPhone, personalEmail: e.personalEmail,
      nationalId: pay ? e.nationalId : null, medicalNotes: pay ? e.medicalNotes : null,
    };
    if (pay && !own) {
      if (e.nationalId) await logSensitiveView(tx, user, e, 'NATIONAL_ID', 'record');
      if (e.medicalNotes) await logSensitiveView(tx, user, e, 'MEDICAL', 'record');
    }
    const employment = {
      ecNumber: e.ecNumber, postedOn: e.postedOn ? isoOf(e.postedOn) : null, startDate: isoOf(e.startDate), leavingDate: e.leavingDate ? isoOf(e.leavingDate) : null,
      leavingReason: e.leavingReason, exit: exit ? { reason: exit.reason, lastDay: isoOf(exit.lastDay), noticeServed: exit.noticeServed, certificateRef: exit.certificateRef } : null,
    };
    const payView = pay && e.employer === 'SCHOOL' ? await readPay(tx, user, e, !own) : null;
    return {
      ...base, personal, employment,
      nextOfKin: nok, qualifications: quals.map((q) => ({ ...q, expiresOn: q.expiresOn ? isoOf(q.expiresOn) : null })),
      documents: docs.map((d) => ({ ...d, expiresOn: d.expiresOn ? isoOf(d.expiresOn) : null })),
      history: history.map((h) => ({ id: h.id, field: h.field, oldValue: h.oldValue, newValue: h.newValue, effectiveDate: isoOf(h.effectiveDate), changedById: h.changedById, reason: h.reason, createdAt: h.createdAt.toISOString() })),
      pay: payView,
    };
  });
}

// ─── Create and change ───────────────────────────────────────────────────────

const personFields = {
  title: optText(20), firstName: textSchema('the first name', 1, 60), surname: textSchema('the surname', 1, 60), gender: z.enum(GENDERS).optional(),
  dateOfBirth: isoDateSchema.optional(), nationalId: optText(30), medicalNotes: optText(1000), nationality: optText(60), maritalStatus: optText(30), homeAddress: optText(300),
  personalPhone: optText(30), personalEmail: z.string().trim().email('Enter a valid email address').max(120).optional().or(z.literal('').transform(() => undefined)),
  workPhone: optText(30), photoKey: optText(300),
};
const jobFields = {
  jobTitle: textSchema('the job title', 2, 80), departmentId: idSchema.optional(), category: z.enum(CATEGORIES), employer: z.enum(EMPLOYERS),
  ecNumber: optText(30), postedOn: isoDateSchema.optional(), startDate: isoDateSchema, lineManagerId: idSchema.optional(), postId: idSchema.optional(),
};

export const CreateEmployeeSchema = z.object({ ...personFields, ...jobFields }).superRefine((v, ctx) => {
  if (v.employer === 'GOVERNMENT' && !v.ecNumber) ctx.addIssue({ code: 'custom', path: ['ecNumber'], message: 'Government-paid staff need their EC number' });
  if (v.employer === 'SCHOOL' && v.ecNumber) ctx.addIssue({ code: 'custom', path: ['ecNumber'], message: 'Only government-paid staff have an EC number' });
});

export const UpdateEmployeeSchema = z.object({
  title: personFields.title, firstName: personFields.firstName.optional(), surname: personFields.surname.optional(), gender: personFields.gender, dateOfBirth: personFields.dateOfBirth,
  nationalId: personFields.nationalId, medicalNotes: personFields.medicalNotes, nationality: personFields.nationality, maritalStatus: personFields.maritalStatus, homeAddress: personFields.homeAddress,
  personalPhone: personFields.personalPhone, personalEmail: personFields.personalEmail, workPhone: personFields.workPhone, photoKey: personFields.photoKey,
  jobTitle: jobFields.jobTitle.optional(), departmentId: z.union([idSchema, z.null()]).optional(), category: jobFields.category.optional(), employer: jobFields.employer.optional(),
  ecNumber: z.union([optText(30), z.null()]).optional(), postedOn: jobFields.postedOn, startDate: jobFields.startDate.optional(), lineManagerId: z.union([idSchema, z.null()]).optional(), postId: z.union([idSchema, z.null()]).optional(),
  // Needed when the employer type changes; written to the history with every tracked change.
  reason: z.string().trim().max(300).optional(),
});

async function checkRefs(tx: Db, schoolId: string, v: { departmentId?: string | null; lineManagerId?: string | null; postId?: string | null }, selfId?: string) {
  if (v.postId && !(await tx.post.findFirst({ where: { id: v.postId, schoolId, status: 'APPROVED' }, select: { id: true } }))) throw new ServiceError('Post not found or not approved', 404);
  if (v.departmentId && !(await tx.department.findFirst({ where: { id: v.departmentId, schoolId }, select: { id: true } }))) throw new ServiceError('Department not found', 404);
  if (v.lineManagerId) {
    if (v.lineManagerId === selfId) throw new ServiceError('A person cannot be their own line manager', 422);
    if (!(await tx.employee.findFirst({ where: { id: v.lineManagerId, schoolId }, select: { id: true } }))) throw new ServiceError('Line manager not found', 404);
  }
}

const dateOrNull = (v: string | undefined | null) => (v ? toDay(v) : null);

async function history(tx: Db, user: Actor, employeeId: string, field: string, oldValue: unknown, newValue: unknown, reason?: string | null, effective?: string) {
  const s = (v: unknown) => (v == null || v === '' ? null : String(v));
  if (s(oldValue) === s(newValue)) return false;
  await tx.employeeHistory.create({ data: { schoolId: user.schoolId, employeeId, field, oldValue: s(oldValue), newValue: s(newValue), effectiveDate: toDay(effective ?? todayInHarare()), changedById: user.id, reason: reason || null } });
  return true;
}

export async function createEmployee(user: Actor, raw: unknown) {
  need(user, 'hr.employees.manage');
  const v = CreateEmployeeSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await ensureHrDefaults(tx, user.schoolId);
    await checkRefs(tx, user.schoolId, v);
    if (v.ecNumber && (await tx.employee.findFirst({ where: { schoolId: user.schoolId, ecNumber: v.ecNumber }, select: { id: true } }))) throw new ServiceError('Another employee already has this EC number', 409);
    const e = await tx.employee.create({
      data: {
        schoolId: user.schoolId, employeeNo: await nextEmployeeNo(tx, user.schoolId), createdById: user.id,
        title: v.title ?? null, firstName: v.firstName, surname: v.surname, gender: v.gender ?? null, dateOfBirth: dateOrNull(v.dateOfBirth), nationalId: v.nationalId ?? null,
        medicalNotes: v.medicalNotes ?? null, nationality: v.nationality ?? null, maritalStatus: v.maritalStatus ?? null, homeAddress: v.homeAddress ?? null,
        personalPhone: v.personalPhone ?? null, personalEmail: v.personalEmail ?? null, workPhone: v.workPhone ?? null, photoKey: v.photoKey ?? null,
        jobTitle: v.jobTitle, departmentId: v.departmentId ?? null, category: v.category, employer: v.employer, ecNumber: v.ecNumber ?? null, postedOn: dateOrNull(v.postedOn),
        startDate: toDay(v.startDate), lineManagerId: v.lineManagerId ?? null, postId: v.postId ?? null,
      },
    });
    await history(tx, user, e.id, 'status', null, 'ACTIVE', 'Record created', v.startDate);
    await history(tx, user, e.id, 'jobTitle', null, v.jobTitle, 'Record created', v.startDate);
    await audit(tx, user, 'HR_SAVE_EMPLOYEE', 'Employee', e.id, `Added ${fullName(e)} (${e.employeeNo}, ${e.employer === 'GOVERNMENT' ? 'government-paid' : 'school-paid'})`, undefined, { employeeNo: e.employeeNo, employer: e.employer, category: e.category, jobTitle: e.jobTitle });
    return { id: e.id, employeeNo: e.employeeNo };
  });
}

const TRACKED = ['jobTitle', 'departmentId', 'category', 'employer', 'ecNumber', 'lineManagerId', 'postId'] as const;

export async function updateEmployee(user: Actor, id: string, raw: unknown) {
  need(user, 'hr.employees.manage');
  const { reason, ...v } = UpdateEmployeeSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const e = await employeeById(tx, user.schoolId, id);
    await checkRefs(tx, user.schoolId, v, e.id);
    const employer = v.employer ?? e.employer;
    const ec = v.ecNumber === undefined ? e.ecNumber : v.ecNumber;
    if (employer === 'GOVERNMENT' && !ec) throw new ServiceError('Government-paid staff need their EC number', 422);
    if (employer === 'SCHOOL' && ec) throw new ServiceError('Only government-paid staff have an EC number', 422);
    if (v.employer && v.employer !== e.employer && (!reason || reason.length < 5)) throw new ServiceError('Changing who pays a person needs a reason', 422);
    if (ec && ec !== e.ecNumber && (await tx.employee.findFirst({ where: { schoolId: user.schoolId, ecNumber: ec, id: { not: id } }, select: { id: true } }))) throw new ServiceError('Another employee already has this EC number', 409);
    if (v.employer === 'GOVERNMENT' && e.employer === 'SCHOOL' && (await tx.hrPayrollLine.findFirst({ where: { schoolId: user.schoolId, employeeId: id, runId: { in: (await runsIn(tx, user.schoolId, ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED'])).map((r) => r.id) } }, select: { id: true } }))) {
      throw new ServiceError('This person is in a payroll run that has not been paid yet. Finish or return the run first.', 409);
    }
    const data: Prisma.EmployeeUncheckedUpdateInput = {};
    const set = <K extends keyof Employee>(k: K, val: Employee[K]) => { (data as Record<string, unknown>)[k as string] = val; };
    for (const k of ['title', 'firstName', 'surname', 'gender', 'nationalId', 'medicalNotes', 'nationality', 'maritalStatus', 'homeAddress', 'personalPhone', 'personalEmail', 'workPhone', 'photoKey', 'jobTitle', 'category', 'employer'] as const) {
      if (v[k] !== undefined) set(k, v[k] as never);
    }
    if (v.dateOfBirth !== undefined) data.dateOfBirth = dateOrNull(v.dateOfBirth);
    if (v.startDate !== undefined) data.startDate = toDay(v.startDate);
    if (v.postedOn !== undefined) data.postedOn = dateOrNull(v.postedOn);
    if (v.departmentId !== undefined) data.departmentId = v.departmentId;
    if (v.lineManagerId !== undefined) data.lineManagerId = v.lineManagerId;
    if (v.postId !== undefined) data.postId = v.postId;
    if (v.ecNumber !== undefined) data.ecNumber = v.ecNumber ?? null;
    if (employer === 'SCHOOL') data.ecNumber = null;
    if (Object.keys(data).length === 0) return { id };
    const after = await tx.employee.update({ where: { id }, data });
    const changed: string[] = [];
    for (const k of TRACKED) if (await history(tx, user, id, k, e[k], after[k], reason)) changed.push(k);
    const sensitive = ['nationalId', 'medicalNotes'].filter((k) => v[k as 'nationalId' | 'medicalNotes'] !== undefined);
    await audit(tx, user, 'HR_SAVE_EMPLOYEE', 'Employee', id, `Changed ${fullName(after)}${changed.length ? `: ${changed.join(', ')}` : ''}${reason ? ` (${reason})` : ''}`,
      Object.fromEntries(TRACKED.map((k) => [k, e[k] ?? null])), { ...Object.fromEntries(TRACKED.map((k) => [k, after[k] ?? null])), ...(sensitive.length ? { sensitiveFieldsChanged: sensitive } : {}) });
    return { id };
  });
}

export const StatusSchema = z.object({ status: z.enum(WORKING_STATUSES), reason: reasonSchema(3), effectiveDate: isoDateSchema.optional() });

/** Active, on leave or suspended. A leaver goes through "end employment" (contracts), which records the date, reason and clearance. */
export async function setEmployeeStatus(user: Actor, id: string, raw: unknown) {
  need(user, 'hr.employees.manage');
  const v = StatusSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const e = await employeeById(tx, user.schoolId, id);
    if (['RESIGNED', 'RETIRED', 'DISMISSED', 'DECEASED'].includes(e.status)) throw new ServiceError('This person has left. Their record is kept as it is.', 409);
    if (e.status === v.status) return { id, status: e.status };
    await tx.employee.update({ where: { id }, data: { status: v.status } });
    await history(tx, user, id, 'status', e.status, v.status, v.reason, v.effectiveDate);
    await audit(tx, user, 'HR_EMPLOYEE_STATUS', 'Employee', id, `${fullName(e)}: ${e.status} to ${v.status} (${v.reason})`, { status: e.status }, { status: v.status });
    return { id, status: v.status };
  });
}

// ─── Next of kin, qualifications, documents ──────────────────────────────────

export const NextOfKinSchema = z.object({
  id: idSchema.optional(), name: textSchema('the name', 2, 100), relationship: textSchema('the relationship', 2, 40), phone: textSchema('the phone number', 5, 30),
  address: optText(300), isEmergency: z.boolean().default(false),
});
export const QualificationSchema = z.object({
  id: idSchema.optional(), kind: z.enum(['QUALIFICATION', 'SUBJECT', 'REGISTRATION']).default('QUALIFICATION'), title: textSchema('the title', 2, 150), institution: optText(150),
  year: z.number().int().min(1930).max(2100).optional(), documentKey: optText(300), expiresOn: isoDateSchema.optional(),
});
export const DocumentSchema = z.object({
  id: idSchema.optional(), kind: z.enum(['CONTRACT', 'ID_COPY', 'CERTIFICATE', 'APPOINTMENT_LETTER', 'DISCIPLINARY', 'LETTER', 'OTHER']), title: textSchema('the title', 2, 150),
  fileKey: optText(300), expiresOn: isoDateSchema.optional(),
});

export async function saveNextOfKin(user: Actor, employeeId: string, raw: unknown) {
  need(user, 'hr.employees.manage');
  const v = NextOfKinSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const e = await employeeById(tx, user.schoolId, employeeId);
    return writeNextOfKin(tx, user, e, v);
  });
}

async function writeNextOfKin(tx: Db, user: Actor, e: Employee, v: z.infer<typeof NextOfKinSchema>) {
  const data = { name: v.name, relationship: v.relationship, phone: v.phone, address: v.address ?? null, isEmergency: v.isEmergency };
  let row;
  if (v.id) {
    if (!(await tx.employeeNextOfKin.findFirst({ where: { id: v.id, employeeId: e.id } }))) throw new ServiceError('Next of kin not found', 404);
    row = await tx.employeeNextOfKin.update({ where: { id: v.id }, data });
  } else row = await tx.employeeNextOfKin.create({ data: { schoolId: user.schoolId, employeeId: e.id, ...data } });
  await audit(tx, user, 'HR_SAVE_EMPLOYEE_ITEM', 'EmployeeNextOfKin', row.id, `Next of kin of ${fullName(e)}: ${v.name} (${v.relationship})`, undefined, data);
  return { id: row.id };
}

export async function saveQualification(user: Actor, employeeId: string, raw: unknown) {
  need(user, 'hr.employees.manage');
  const v = QualificationSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const e = await employeeById(tx, user.schoolId, employeeId);
    const data = { kind: v.kind, title: v.title, institution: v.institution ?? null, year: v.year ?? null, documentKey: v.documentKey ?? null, expiresOn: dateOrNull(v.expiresOn) };
    let row;
    if (v.id) {
      if (!(await tx.employeeQualification.findFirst({ where: { id: v.id, employeeId } }))) throw new ServiceError('Qualification not found', 404);
      row = await tx.employeeQualification.update({ where: { id: v.id }, data });
    } else row = await tx.employeeQualification.create({ data: { schoolId: user.schoolId, employeeId, ...data } });
    await audit(tx, user, 'HR_SAVE_EMPLOYEE_ITEM', 'EmployeeQualification', row.id, `${v.kind.toLowerCase()} of ${fullName(e)}: ${v.title}`, undefined, { title: v.title, kind: v.kind });
    return { id: row.id };
  });
}

export async function saveDocument(user: Actor, employeeId: string, raw: unknown) {
  need(user, 'hr.documents.manage');
  const v = DocumentSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const e = await employeeById(tx, user.schoolId, employeeId);
    const restricted = v.kind === 'DISCIPLINARY';
    const data = { kind: v.kind, title: v.title, fileKey: v.fileKey ?? null, expiresOn: dateOrNull(v.expiresOn), restricted };
    let row;
    if (v.id) {
      if (!(await tx.employeeDocument.findFirst({ where: { id: v.id, employeeId } }))) throw new ServiceError('Document not found', 404);
      row = await tx.employeeDocument.update({ where: { id: v.id }, data });
    } else row = await tx.employeeDocument.create({ data: { schoolId: user.schoolId, employeeId, uploadedById: user.id, ...data } });
    await audit(tx, user, 'HR_SAVE_EMPLOYEE_ITEM', 'EmployeeDocument', row.id, `Document of ${fullName(e)}: ${v.title}`, undefined, { kind: v.kind, title: v.title });
    return { id: row.id };
  });
}

// ─── Pay (school-paid staff only) ────────────────────────────────────────────

export const PayMethodSchema = z.enum(['BANK', 'ECOCASH', 'CASH']);

export const SetPaySchema = z.object({
  gradeId: idSchema.nullable().optional(), payBasis: z.enum(['MONTHLY', 'DAILY', 'HOURLY']).default('MONTHLY'),
  basicUsdCents: centsSchema.default(0), basicZigCents: centsSchema.default(0), splitUsdBps: z.number().int().min(0).max(10000).nullable().optional(), splitTotalUsdCents: centsSchema.nullable().optional(),
  rateCents: centsSchema.nullable().optional(), rateCurrency: currencySchema.nullable().optional(),
  paymentMethod: PayMethodSchema, bankName: optText(80), bankBranch: optText(80), accountNumber: optText(40), ecocashNumber: optText(30),
  zimraTaxNo: optText(30), nssaNo: optText(30), medicalAidNo: optText(40), pensionNo: optText(40), effectiveFrom: isoDateSchema.optional(),
  reason: reasonSchema(5),
}).superRefine((v, ctx) => {
  if (v.paymentMethod === 'BANK' && (!v.accountNumber || !v.bankName)) ctx.addIssue({ code: 'custom', path: ['accountNumber'], message: 'Enter the bank and the account number' });
  if (v.paymentMethod === 'ECOCASH' && !(v.ecocashNumber && normalizeZimbabwePhone(v.ecocashNumber))) ctx.addIssue({ code: 'custom', path: ['ecocashNumber'], message: 'Enter a valid EcoCash number' });
  if (v.payBasis !== 'MONTHLY' && !(v.rateCents && v.rateCurrency)) ctx.addIssue({ code: 'custom', path: ['rateCents'], message: 'Casual and hourly staff need a rate and its currency' });
  if (v.payBasis === 'MONTHLY' && !(v.basicUsdCents > 0 || v.basicZigCents > 0 || (v.splitUsdBps != null && (v.splitTotalUsdCents ?? 0) > 0))) ctx.addIssue({ code: 'custom', path: ['basicUsdCents'], message: 'Enter the basic pay (in USD, ZiG, or a split)' });
  if (v.splitUsdBps != null && v.splitTotalUsdCents == null) ctx.addIssue({ code: 'custom', path: ['splitTotalUsdCents'], message: 'A split rule needs the total pay (in USD)' });
});

const PAY_FIELDS = ['gradeId', 'payBasis', 'basicUsdCents', 'basicZigCents', 'splitUsdBps', 'splitTotalUsdCents', 'rateCents', 'rateCurrency', 'paymentMethod', 'bankName', 'bankBranch', 'accountNumber', 'ecocashNumber', 'zimraTaxNo', 'nssaNo', 'medicalAidNo', 'pensionNo'] as const;
const BANK_FIELDS = new Set(['paymentMethod', 'bankName', 'bankBranch', 'accountNumber', 'ecocashNumber']);

async function readPay(tx: Db, user: Actor, e: Employee, log: boolean) {
  const p = await tx.employeePay.findUnique({ where: { employeeId: e.id } });
  if (!p) return null;
  if (log) {
    await logSensitiveView(tx, user, e, 'SALARY', 'pay set-up');
    if (p.accountNumber || p.ecocashNumber) await logSensitiveView(tx, user, e, 'BANK', 'payment details');
  }
  const comps = await tx.employeePayComponent.findMany({ where: { schoolId: user.schoolId, employeeId: e.id }, orderBy: { startsOn: 'asc' } });
  const defs = await tx.payComponent.findMany({ where: { schoolId: user.schoolId } });
  const name = new Map(defs.map((d) => [d.id, d]));
  const loans = await tx.loan.findMany({ where: { schoolId: user.schoolId, employeeId: e.id }, orderBy: { createdAt: 'desc' } });
  // A person reading their own pay without hr.pay.view sees the figures, but tax and NSSA numbers cut to their last 4 characters and no bank account number.
  const mine = e.userId === user.id && !hrHolds(user, 'hr.pay.view');
  const fields = Object.fromEntries(PAY_FIELDS.map((f) => [f, p[f] ?? null]));
  if (mine) Object.assign(fields, { zimraTaxNo: maskTail(p.zimraTaxNo, 4), nssaNo: maskTail(p.nssaNo, 4), accountNumber: null });
  return {
    ...fields, effectiveFrom: isoOf(p.effectiveFrom),
    components: comps.map((c) => ({ id: c.id, componentId: c.componentId, name: name.get(c.componentId)?.name ?? '?', kind: name.get(c.componentId)?.kind ?? 'ALLOWANCE', amountCents: c.amountCents, currency: c.currency, startsOn: isoOf(c.startsOn), endsOn: c.endsOn ? isoOf(c.endsOn) : null, active: c.active, childStudentId: c.childStudentId })),
    loans: loans.map((l) => ({ id: l.id, principalCents: l.principalCents, balanceCents: l.balanceCents, instalmentCents: l.instalmentCents, currency: l.currency, status: l.status, startMonth: l.startMonth })),
  };
}

/** A person's own pay, or anyone's for HR and the Owner; a look at someone else's is logged. */
export async function getPay(user: Actor, employeeId: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const e = await employeeById(tx, user.schoolId, employeeId);
    const own = e.userId === user.id;
    if (!own) need(user, 'hr.pay.view');
    return readPay(tx, user, e, !own);
  });
}

async function queueStaffSms(tx: Db, schoolId: string, phone: string | null | undefined, body: string, key: string) {
  const to = phone ? normalizeZimbabwePhone(phone) : null;
  if (!to || !(await communicationOn(tx, schoolId))) return false;
  const r = await tx.messageOutbox.createMany({ data: [{ schoolId, toPhone: to, body, dedupeKey: key }], skipDuplicates: true });
  return r.count > 0;
}

/**
 * Sets or changes a school-paid person's pay. Every changed field is written to the history with before and after and the reason; a
 * change to bank or EcoCash details also sends the employee an SMS.
 */
export async function setPay(user: Actor, employeeId: string, raw: unknown) {
  need(user, 'hr.pay.manage');
  const v = SetPaySchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const e = await employeeById(tx, user.schoolId, employeeId);
    if (e.employer !== 'SCHOOL') throw new ServiceError('Government-paid staff are paid by the state and have no pay set-up here', 409);
    if (['RESIGNED', 'RETIRED', 'DISMISSED', 'DECEASED'].includes(e.status)) throw new ServiceError('This person has left', 409);
    if (v.gradeId && !(await tx.payGrade.findFirst({ where: { id: v.gradeId, schoolId: user.schoolId } }))) throw new ServiceError('Pay grade not found', 404);
    const data = {
      gradeId: v.gradeId ?? null, payBasis: v.payBasis, basicUsdCents: v.basicUsdCents, basicZigCents: v.basicZigCents, splitUsdBps: v.splitUsdBps ?? null, splitTotalUsdCents: v.splitTotalUsdCents ?? null,
      rateCents: v.rateCents ?? null, rateCurrency: v.rateCurrency ?? null, paymentMethod: v.paymentMethod,
      bankName: v.paymentMethod === 'BANK' ? (v.bankName ?? null) : null, bankBranch: v.paymentMethod === 'BANK' ? (v.bankBranch ?? null) : null, accountNumber: v.paymentMethod === 'BANK' ? (v.accountNumber ?? null) : null,
      ecocashNumber: v.paymentMethod === 'ECOCASH' ? (normalizeZimbabwePhone(v.ecocashNumber ?? '') ?? null) : null,
      zimraTaxNo: v.zimraTaxNo ?? null, nssaNo: v.nssaNo ?? null, medicalAidNo: v.medicalAidNo ?? null, pensionNo: v.pensionNo ?? null,
    };
    const before = await tx.employeePay.findUnique({ where: { employeeId } });
    const effective = v.effectiveFrom ?? todayInHarare();
    const row = before
      ? await tx.employeePay.update({ where: { employeeId }, data: { ...data, effectiveFrom: toDay(effective) } })
      : await tx.employeePay.create({ data: { schoolId: user.schoolId, employeeId, ...data, effectiveFrom: toDay(effective) } });
    const changed: string[] = [];
    let bankChanged = false;
    for (const f of PAY_FIELDS) {
      if (await history(tx, user, employeeId, `pay.${f}`, before?.[f], row[f], v.reason, effective)) {
        changed.push(f);
        if (BANK_FIELDS.has(f)) bankChanged = true;
      }
    }
    if (before && changed.length === 0) return { id: row.id, changed: [] };
    await audit(tx, user, 'HR_CHANGE_PAY', 'EmployeePay', row.id, `${before ? 'Changed' : 'Set up'} pay of ${fullName(e)}: ${changed.join(', ') || 'new set-up'} (${v.reason})`,
      before ? { fields: changed } : undefined, { fields: changed, reason: v.reason });
    if (bankChanged && before) {
      const phone = e.personalPhone ?? e.workPhone;
      const sms = await queueStaffSms(tx, user.schoolId, phone, 'Your payment details at school were changed. If you did not ask for this, tell the Head or HR today.', `bank:${employeeId}:${row.updatedAt.getTime()}`);
      await tellEmployee(tx, user.schoolId, e, { title: 'Your payment details were changed', body: sms ? undefined : 'If you did not ask for this, tell HR today.', link: '/hr/me' });
    }
    return { id: row.id, changed };
  });
}

export const ComponentSchema = z.object({
  componentId: idSchema, amountCents: centsSchema, currency: currencySchema.default('USD'), startsOn: isoDateSchema, endsOn: isoDateSchema.optional(),
  childStudentId: idSchema.optional(), consentKey: optText(300), reason: reasonSchema(5),
}).refine((v) => !v.endsOn || v.endsOn >= v.startsOn, 'The end date is before the start date')
  .refine((v) => !v.childStudentId || !!v.consentKey, 'Child fees can be deducted only with the employee\'s signed consent');

export async function saveComponent(user: Actor, employeeId: string, raw: unknown) {
  need(user, 'hr.pay.manage');
  const v = ComponentSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const e = await employeeById(tx, user.schoolId, employeeId);
    if (e.employer !== 'SCHOOL') throw new ServiceError('Government-paid staff have no allowances or deductions here', 409);
    const def = await tx.payComponent.findFirst({ where: { id: v.componentId, schoolId: user.schoolId } });
    if (!def) throw new ServiceError('Pay component not found', 404);
    if (v.childStudentId && !(await tx.student.findFirst({ where: { id: v.childStudentId, schoolId: user.schoolId }, select: { id: true } }))) throw new ServiceError('Learner not found', 404);
    const row = await tx.employeePayComponent.create({
      data: {
        schoolId: user.schoolId, employeeId, componentId: v.componentId, amountCents: v.amountCents, currency: v.currency, startsOn: toDay(v.startsOn), endsOn: v.endsOn ? toDay(v.endsOn) : null,
        childStudentId: v.childStudentId ?? null, consentKey: v.consentKey ?? null, consentAt: v.childStudentId ? new Date() : null,
      },
    });
    await history(tx, user, employeeId, `pay.component.${def.code}`, null, `${v.amountCents} ${v.currency}`, v.reason, v.startsOn);
    await audit(tx, user, 'HR_CHANGE_PAY', 'EmployeePayComponent', row.id, `${def.name} for ${fullName(e)}: ${v.amountCents} cents ${v.currency} from ${v.startsOn} (${v.reason})`, undefined, { componentId: v.componentId, amountCents: v.amountCents, currency: v.currency });
    return { id: row.id };
  });
}

export const EndComponentSchema = z.object({ endsOn: isoDateSchema, reason: reasonSchema(5) });

export async function endComponent(user: Actor, id: string, raw: unknown) {
  need(user, 'hr.pay.manage');
  const v = EndComponentSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const c = await tx.employeePayComponent.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!c) throw new ServiceError('Not found', 404);
    if (v.endsOn < isoOf(c.startsOn)) throw new ServiceError('The end date is before the start date', 422);
    const def = await tx.payComponent.findFirst({ where: { id: c.componentId } });
    await tx.employeePayComponent.update({ where: { id }, data: { endsOn: toDay(v.endsOn), active: false } });
    await history(tx, user, c.employeeId, `pay.component.${def?.code ?? c.componentId}`, `${c.amountCents} ${c.currency}`, 'ended', v.reason, v.endsOn);
    await audit(tx, user, 'HR_CHANGE_PAY', 'EmployeePayComponent', id, `Ended ${def?.name ?? 'a component'} on ${v.endsOn} (${v.reason})`, { endsOn: c.endsOn ? isoOf(c.endsOn) : null }, { endsOn: v.endsOn });
    return { id };
  });
}

export const LoanSchema = z.object({
  employeeId: idSchema, principalCents: centsSchema.refine((n) => n > 0, 'Enter the amount lent'), currency: currencySchema.default('USD'),
  instalmentCents: centsSchema.refine((n) => n > 0, 'Enter the monthly instalment'), startMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Enter a month as YYYY-MM'), reason: reasonSchema(3),
}).refine((v) => v.instalmentCents <= v.principalCents, 'The instalment is more than the loan');

/** A salary advance or loan. The monthly runs take the instalment (never more than what is left) until the balance is zero. */
export async function createLoan(user: Actor, raw: unknown) {
  need(user, 'hr.pay.manage');
  const v = LoanSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const e = await employeeById(tx, user.schoolId, v.employeeId);
    if (e.employer !== 'SCHOOL') throw new ServiceError('Government-paid staff have no loans here', 409);
    const l = await tx.loan.create({ data: { schoolId: user.schoolId, employeeId: v.employeeId, principalCents: v.principalCents, currency: v.currency, instalmentCents: v.instalmentCents, balanceCents: v.principalCents, startMonth: v.startMonth, reason: v.reason, createdById: user.id } });
    await history(tx, user, v.employeeId, 'pay.loan', null, `${v.principalCents} ${v.currency}`, v.reason);
    await audit(tx, user, 'HR_SAVE_LOAN', 'Loan', l.id, `Loan of ${v.principalCents} cents ${v.currency} to ${fullName(e)}, ${v.instalmentCents} a month from ${v.startMonth}`, undefined, { principalCents: v.principalCents, instalmentCents: v.instalmentCents, currency: v.currency });
    return { id: l.id };
  });
}

// ─── A login for an employee ─────────────────────────────────────────────────

export const LinkUserSchema = z.object({ userId: idSchema });

/** Links an existing login to the employee (so Academics and attendance know who they are). One login belongs to one employee. */
export async function linkUser(user: Actor, employeeId: string, raw: unknown) {
  need(user, 'hr.employees.manage');
  const { userId } = LinkUserSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const e = await employeeById(tx, user.schoolId, employeeId);
    if (e.userId) throw new ServiceError('This person already has a login', 409);
    const u = await tx.user.findFirst({ where: { id: userId, schoolId: user.schoolId, isSupport: false } });
    if (!u) throw new ServiceError('User not found', 404);
    if (await tx.employee.findFirst({ where: { userId, schoolId: user.schoolId }, select: { id: true } })) throw new ServiceError('This login already belongs to another employee', 409);
    await tx.employee.update({ where: { id: employeeId }, data: { userId } });
    await audit(tx, user, 'HR_LINK_USER', 'Employee', employeeId, `Linked ${fullName(e)} to login ${u.email}`, { userId: null }, { userId });
    return { id: employeeId, userId };
  });
}

// ─── Staff change requests (self-service) ────────────────────────────────────

const DetailsChange = z.object({ homeAddress: optText(300), personalPhone: optText(30), personalEmail: personFields.personalEmail, maritalStatus: optText(30) }).strict();
const BankChange = z.object({ paymentMethod: PayMethodSchema, bankName: optText(80), bankBranch: optText(80), accountNumber: optText(40), ecocashNumber: optText(30) }).strict();

export const RequestChangeSchema = z.discriminatedUnion('group', [
  z.object({ group: z.literal('DETAILS'), changes: DetailsChange, reason: optText(300) }),
  z.object({ group: z.literal('BANK'), changes: BankChange, reason: optText(300) }),
  z.object({ group: z.literal('NEXT_OF_KIN'), changes: NextOfKinSchema, reason: optText(300) }),
]);

/** A staff member asks to change their own details; HR approves (bank details also need the Owner). */
export async function requestChange(user: Actor, raw: unknown) {
  need(user, 'hr.self.details');
  const v = RequestChangeSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const e = await tx.employee.findFirst({ where: { schoolId: user.schoolId, userId: user.id } });
    if (!e) throw new ServiceError('You have no staff record yet. Ask HR to link your login to it.', 404);
    if (v.group === 'BANK') {
      if (e.employer !== 'SCHOOL') throw new ServiceError('Government-paid staff have no payment details here', 409);
      const c = v.changes;
      if (c.paymentMethod === 'BANK' && !(c.accountNumber && c.bankName)) throw new ServiceError('Enter the bank and the account number', 422);
      if (c.paymentMethod === 'ECOCASH' && !(c.ecocashNumber && normalizeZimbabwePhone(c.ecocashNumber))) throw new ServiceError('Enter a valid EcoCash number', 422);
    }
    const pending = await tx.employeeChangeRequest.findFirst({ where: { schoolId: user.schoolId, employeeId: e.id, group: v.group, status: { in: ['PENDING', 'HR_APPROVED'] } }, select: { id: true } });
    if (pending && v.group !== 'NEXT_OF_KIN') throw new ServiceError('You already have a request of this kind waiting', 409);
    const r = await tx.employeeChangeRequest.create({ data: { schoolId: user.schoolId, employeeId: e.id, group: v.group, changes: v.changes as Prisma.InputJsonValue, reason: v.reason ?? null, requestedById: user.id } });
    await audit(tx, user, 'HR_REQUEST_CHANGE', 'EmployeeChangeRequest', r.id, `${fullName(e)} asked to change their ${v.group.toLowerCase().replace('_', ' ')}`, undefined, { group: v.group });
    await tellHolders(tx, user, 'hr.employees.manage', { title: 'A staff member asked to change their details', body: `${fullName(e)}: ${v.group.toLowerCase().replace('_', ' ')}`, link: '/hr/requests' });
    return { id: r.id };
  });
}

export async function listChangeRequests(user: Actor) {
  const hr = hrHolds(user, 'hr.employees.manage') || hrHolds(user, 'hr.pay.view');
  if (!hr) need(user, 'hr.self.details');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const own = hr ? null : await tx.employee.findFirst({ where: { schoolId: user.schoolId, userId: user.id }, select: { id: true } });
    if (!hr && !own) return [];
    const rows = await tx.employeeChangeRequest.findMany({ where: { schoolId: user.schoolId, ...(hr ? {} : { employeeId: own!.id }) }, orderBy: { createdAt: 'desc' }, take: 200 });
    const emps = await tx.employee.findMany({ where: { schoolId: user.schoolId, id: { in: rows.map((r) => r.employeeId) } } });
    const name = new Map(emps.map((e) => [e.id, fullName(e)]));
    return rows.map((r) => ({
      id: r.id, employeeId: r.employeeId, employee: name.get(r.employeeId) ?? '?', group: r.group, status: r.status, reason: r.reason, rejectionReason: r.rejectionReason,
      // The new bank account number is shown to the people who decide on it, not to everyone with the list.
      changes: r.group === 'BANK' && !hr ? null : r.changes, createdAt: r.createdAt.toISOString(), hrDecidedById: r.hrDecidedById, ownerDecidedById: r.ownerDecidedById,
    }));
  });
}

export const DecideChangeSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT']), reason: z.string().trim().max(300).optional() });

/**
 * HR approves a details or next-of-kin change and it is applied. A bank change needs two different people: HR first, then the Owner.
 * Nobody decides their own request. A rejection needs a reason.
 */
export async function decideChange(user: Actor, id: string, raw: unknown) {
  const v = DecideChangeSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const r = await tx.employeeChangeRequest.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!r) throw new ServiceError('Request not found', 404);
    if (!['PENDING', 'HR_APPROVED'].includes(r.status)) throw new ServiceError('This request has already been decided', 409);
    const e = await employeeById(tx, user.schoolId, r.employeeId);
    if (r.requestedById === user.id || e.userId === user.id) throw new ServiceError('You cannot decide your own request', 403);
    const secondStep = r.status === 'HR_APPROVED';
    // First step: HR. Second step (bank only): the Owner.
    if (secondStep) {
      // Rule 9: the pair that approves a bank change is HR and the Owner, two different people.
      const first = await tx.userRole.findMany({ where: { userId: r.hrDecidedById ?? '' }, select: { role: { select: { key: true } } } });
      guards.bankChangeNeedsHrAndOwner({ id: r.hrDecidedById ?? '', roles: first.map((k) => k.role.key) }, user);
    }
    // The first step is HR's own: the key must be granted to a role (an HR Officer), not just held through the Owner's "*".
    else if (!(user.grants ?? []).includes('hr.employees.manage')) throw new ServiceError('HR approves a bank change first; then the Owner approves it.', 403);
    if (secondStep && r.hrDecidedById === user.id) throw new ServiceError('A bank change needs two different people to approve it', 403);

    if (v.decision === 'REJECT') {
      if (!v.reason || v.reason.length < 3) throw new ServiceError('Give a reason for rejecting', 422);
      await tx.employeeChangeRequest.update({ where: { id }, data: { status: 'REJECTED', rejectedById: user.id, rejectionReason: v.reason } });
      await audit(tx, user, 'HR_DECIDE_CHANGE', 'EmployeeChangeRequest', id, `Rejected ${fullName(e)}'s ${r.group.toLowerCase()} change (${v.reason})`, { status: r.status }, { status: 'REJECTED' });
      await tellEmployee(tx, user.schoolId, e, { title: 'Your change request was not approved', body: v.reason, link: '/hr/me' });
      return { id, status: 'REJECTED' as const };
    }

    if (r.group === 'BANK' && !secondStep) {
      await tx.employeeChangeRequest.update({ where: { id }, data: { status: 'HR_APPROVED', hrDecidedById: user.id, hrDecidedAt: new Date() } });
      await audit(tx, user, 'HR_DECIDE_CHANGE', 'EmployeeChangeRequest', id, `HR approved ${fullName(e)}'s bank change; waiting for the Owner`, { status: 'PENDING' }, { status: 'HR_APPROVED' });
      await tellHolders(tx, user, 'hr.payroll.approve', { title: 'A bank detail change needs your approval', body: fullName(e), link: '/hr/requests' });
      return { id, status: 'HR_APPROVED' as const };
    }

    // Apply it.
    const ch = r.changes as Record<string, unknown>;
    if (r.group === 'DETAILS') {
      const parsed = DetailsChange.parse(ch);
      const data: Prisma.EmployeeUncheckedUpdateInput = {};
      for (const k of Object.keys(parsed) as (keyof typeof parsed)[]) if (parsed[k] !== undefined) (data as Record<string, unknown>)[k] = parsed[k];
      await tx.employee.update({ where: { id: e.id }, data });
      for (const k of Object.keys(parsed) as (keyof typeof parsed)[]) if (parsed[k] !== undefined) await history(tx, user, e.id, k, (e as never as Record<string, unknown>)[k], parsed[k], 'Approved staff request');
    } else if (r.group === 'NEXT_OF_KIN') {
      await writeNextOfKin(tx, user, e, NextOfKinSchema.parse(ch));
    } else {
      const c = BankChange.parse(ch);
      const before = await tx.employeePay.findUnique({ where: { employeeId: e.id } });
      if (!before) throw new ServiceError('This person has no pay set-up yet. HR sets it up first.', 409);
      const data = {
        paymentMethod: c.paymentMethod, bankName: c.paymentMethod === 'BANK' ? (c.bankName ?? null) : null, bankBranch: c.paymentMethod === 'BANK' ? (c.bankBranch ?? null) : null,
        accountNumber: c.paymentMethod === 'BANK' ? (c.accountNumber ?? null) : null, ecocashNumber: c.paymentMethod === 'ECOCASH' ? (normalizeZimbabwePhone(c.ecocashNumber ?? '') ?? null) : null,
      };
      const after = await tx.employeePay.update({ where: { employeeId: e.id }, data });
      for (const f of ['paymentMethod', 'bankName', 'bankBranch', 'accountNumber', 'ecocashNumber'] as const) await history(tx, user, e.id, `pay.${f}`, before[f], after[f], 'Staff request, approved by HR and the Owner');
      await queueStaffSms(tx, user.schoolId, e.personalPhone ?? e.workPhone, 'Your payment details at school were changed. If you did not ask for this, tell the Head or HR today.', `bank:${e.id}:${id}`);
      await tellEmployee(tx, user.schoolId, e, { title: 'Your payment details were changed', body: 'If you did not ask for this, tell HR today.', link: '/hr/me' });
    }
    await tx.employeeChangeRequest.update({
      where: { id },
      data: { status: 'APPROVED', appliedAt: new Date(), ...(secondStep ? { ownerDecidedById: user.id, ownerDecidedAt: new Date() } : { hrDecidedById: user.id, hrDecidedAt: new Date() }) },
    });
    await audit(tx, user, 'HR_DECIDE_CHANGE', 'EmployeeChangeRequest', id, `Approved ${fullName(e)}'s ${r.group.toLowerCase()} change`, { status: r.status }, { status: 'APPROVED' });
    await tellEmployee(tx, user.schoolId, e, { title: 'Your change request was approved', link: '/hr/me' });
    return { id, status: 'APPROVED' as const };
  });
}

// ─── The signed-in person's own record ───────────────────────────────────────

export async function myEmployeeId(user: Actor): Promise<string | null> {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => (await tx.employee.findFirst({ where: { schoolId: user.schoolId, userId: user.id }, select: { id: true } }))?.id ?? null);
}

export async function getMyRecord(user: Actor) {
  need(user, 'hr.self.details');
  const id = await myEmployeeId(user);
  if (!id) throw new ServiceError('You have no staff record yet. Ask HR to link your login to it.', 404);
  return getEmployee(user, id);
}

/** The allowances and deductions a school can give (Payroll set-up). */
export async function listPayComponents(user: Actor) {
  need(user, 'hr.pay.manage', 'hr.pay.view', 'hr.payroll.prepare');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await ensureHrDefaults(tx, user.schoolId);
    return tx.payComponent.findMany({ where: { schoolId: user.schoolId, active: true }, orderBy: [{ kind: 'asc' }, { name: 'asc' }], select: { id: true, code: true, name: true, kind: true, taxable: true, variable: true } });
  });
}

/** Logins that do not belong to an employee yet, to link one. */
export async function listUnlinkedUsers(user: Actor) {
  need(user, 'hr.employees.manage');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const linked = (await tx.employee.findMany({ where: { schoolId: user.schoolId, userId: { not: null } }, select: { userId: true } })).map((e) => e.userId!);
    return tx.user.findMany({ where: { schoolId: user.schoolId, active: true, isSupport: false, id: { notIn: linked } }, orderBy: { fullName: 'asc' }, select: { id: true, fullName: true, email: true } });
  });
}
