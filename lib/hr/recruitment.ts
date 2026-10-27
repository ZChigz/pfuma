// Establishment, recruitment and contracts. New posts are approved by the Head and the Owner (two different people) before anyone is
// hired, because they add to the wage bill. Vacancies open on approved posts; applicants move through the stages; hiring turns the
// applicant into an employee with a draft contract. Contracts carry their own end and review dates, with reminders at 60 and 30 days.
// Government teacher postings skip all of this: HR adds them directly with their EC number and posting date.
import { z } from 'zod';
import type { Contract, Employee, EmployeeCategory } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import * as guards from '@/lib/access/guards';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import {
  audit, centsSchema, currencySchema, employeeById, fullName, hrHolds, idSchema, isoDateSchema, isoOf, nextEmployeeNo, need, optText, tellHolders, textSchema, toDay, todayInHarare,
  type Actor,
} from '@/lib/hr/common';
import { ensureHrDefaults } from '@/lib/hr/defaults';
import { createEmployee } from '@/lib/hr/employees';
import { saveLetter } from '@/lib/hr/letters';
import { balanceOf } from '@/lib/hr/leave';
import { addDays } from '@/lib/academics/common';
import { notifyUsers } from '@/lib/system/notifications';
import { approverIds } from '@/lib/students/common';

const CATEGORIES = ['TEACHING', 'ADMINISTRATION', 'ANCILLARY', 'BOARDING', 'SECURITY', 'GROUNDS'] as const;
const LEFT = ['RESIGNED', 'RETIRED', 'DISMISSED', 'DECEASED'];

// ─── Posts (the establishment) ───────────────────────────────────────────────

export const PostSchema = z.object({
  title: textSchema('the title', 2, 80), departmentId: idSchema.optional(), category: z.enum(CATEGORIES), employer: z.enum(['GOVERNMENT', 'SCHOOL']).default('SCHOOL'),
  count: z.number().int().min(1).max(500), currency: currencySchema.default('USD'), monthlyCostCents: centsSchema, note: optText(500),
});

/** Asks for a new post. The request carries the expected monthly cost (per person and in total). */
export async function requestPost(user: Actor, raw: unknown) {
  need(user, 'hr.posts.manage');
  const v = PostSchema.parse(raw);
  if (v.employer === 'SCHOOL' && v.monthlyCostCents <= 0) throw new ServiceError('Enter the expected monthly cost of a school-paid post', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    if (v.departmentId && !(await tx.department.findFirst({ where: { id: v.departmentId, schoolId: user.schoolId }, select: { id: true } }))) throw new ServiceError('Department not found', 404);
    const p = await tx.post.create({ data: { schoolId: user.schoolId, requestedById: user.id, ...v, departmentId: v.departmentId ?? null, note: v.note ?? null } });
    await audit(tx, user, 'HR_SAVE_POST', 'Post', p.id, `Asked for ${v.count} × ${v.title}, ${v.monthlyCostCents} cents ${v.currency} a month each`, undefined, { title: v.title, count: v.count, monthlyCostCents: v.monthlyCostCents, currency: v.currency });
    await tellHolders(tx, user, 'hr.posts.approve', { title: `New post to approve: ${v.count} × ${v.title}`, body: `Expected cost ${(v.count * v.monthlyCostCents) / 100} ${v.currency} a month`, link: '/hr/posts' });
    return { id: p.id, monthlyTotalCents: v.count * v.monthlyCostCents };
  });
}

export const DecidePostSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT']), reason: z.string().trim().max(500).optional() });

/**
 * A new post needs the Head and the Owner, two different people. The one who asked cannot approve it. Anyone who may approve can
 * reject it, with a reason.
 */
export async function decidePost(user: Actor, id: string, raw: unknown) {
  need(user, 'hr.posts.approve');
  const v = DecidePostSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const p = await tx.post.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!p) throw new ServiceError('Post not found', 404);
    if (p.status !== 'PENDING') throw new ServiceError(`This post is ${p.status.toLowerCase()} already`, 409);
    if (p.requestedById === user.id) throw new ServiceError('You asked for this post, so someone else must decide on it.', 403);
    if (v.decision === 'REJECT') {
      if (!v.reason || v.reason.length < 3) throw new ServiceError('Give a reason for rejecting', 422);
      await tx.post.update({ where: { id }, data: { status: 'REJECTED', rejectedById: user.id, rejectionReason: v.reason } });
      await audit(tx, user, 'HR_APPROVE_POST', 'Post', id, `Rejected the post ${p.title}: ${v.reason}`, { status: 'PENDING' }, { status: 'REJECTED' });
      return { id, status: 'REJECTED' as const };
    }
    const seats = guards.postApprovalSeats(user);
    const asHead = seats.includes('head'), asOwner = seats.includes('owner');
    if (!asHead && !asOwner) throw new ServiceError('A new post is approved by the Head and by the Owner.', 403);
    // Fill the slot this person can fill; one person can never fill both.
    let slot: 'head' | 'owner';
    if (asHead && !p.headApprovedById && p.ownerApprovedById !== user.id) slot = 'head';
    else if (asOwner && !p.ownerApprovedById && p.headApprovedById !== user.id) slot = 'owner';
    else throw new ServiceError(p.headApprovedById === user.id || p.ownerApprovedById === user.id ? 'You have approved this post already. The Head and the Owner must be two different people.' : 'This approval has been given already; the other approval is still needed.', 409);
    const data = slot === 'head' ? { headApprovedById: user.id, headApprovedAt: new Date() } : { ownerApprovedById: user.id, ownerApprovedAt: new Date() };
    const both = slot === 'head' ? !!p.ownerApprovedById : !!p.headApprovedById;
    await tx.post.update({ where: { id }, data: { ...data, ...(both ? { status: 'APPROVED', approvedById: user.id } : {}) } });
    await audit(tx, user, 'HR_APPROVE_POST', 'Post', id, `${slot === 'head' ? 'Head' : 'Owner'} approved the post ${p.title}${both ? ' (fully approved)' : ''}`, { status: 'PENDING' }, { status: both ? 'APPROVED' : 'PENDING', slot });
    if (both) await notifyUsers(tx, user.schoolId, [p.requestedById], { type: 'HR', title: `The post ${p.title} was approved`, link: '/hr/posts' });
    return { id, status: both ? ('APPROVED' as const) : ('PENDING' as const), awaiting: both ? null : slot === 'head' ? 'owner' : 'head' };
  });
}

/** The establishment: every post with how many are filled and vacant, and what it costs. */
export async function listPosts(user: Actor) {
  need(user, 'hr.posts.manage', 'hr.posts.approve', 'hr.reports.view', 'hr.directory.view');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const posts = await tx.post.findMany({ where: { schoolId: user.schoolId }, orderBy: [{ status: 'asc' }, { title: 'asc' }] });
    const filled = await tx.employee.groupBy({ by: ['postId'], where: { schoolId: user.schoolId, postId: { not: null }, status: { notIn: LEFT as never[] } }, _count: { _all: true } });
    const f = new Map(filled.map((x) => [x.postId, x._count._all]));
    const vac = await tx.vacancy.findMany({ where: { schoolId: user.schoolId, status: 'OPEN' }, select: { postId: true } });
    const depts = new Map((await tx.department.findMany({ where: { schoolId: user.schoolId }, select: { id: true, name: true } })).map((d) => [d.id, d.name]));
    const money = hrHolds(user, 'hr.posts.approve') || hrHolds(user, 'hr.posts.manage');
    return posts.map((p) => {
      const filledN = f.get(p.id) ?? 0;
      return {
        id: p.id, title: p.title, department: p.departmentId ? depts.get(p.departmentId) ?? null : null, category: p.category, employer: p.employer, count: p.count, filled: filledN, vacant: Math.max(0, p.count - filledN),
        status: p.status, currency: p.currency, monthlyCostCents: money ? p.monthlyCostCents : null, monthlyTotalCents: money ? p.monthlyCostCents * p.count : null, note: p.note, rejectionReason: p.rejectionReason,
        headApproved: !!p.headApprovedById, ownerApproved: !!p.ownerApprovedById, openVacancies: vac.filter((x) => x.postId === p.id).length,
      };
    });
  });
}

// ─── Vacancies and applicants ────────────────────────────────────────────────

export const VacancySchema = z.object({ postId: idSchema, title: textSchema('the title', 2, 100), requirements: optText(2000), closingDate: isoDateSchema });

export async function openVacancy(user: Actor, raw: unknown) {
  need(user, 'hr.recruitment.manage');
  const v = VacancySchema.parse(raw);
  if (v.closingDate < todayInHarare()) throw new ServiceError('The closing date has passed', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const p = await tx.post.findFirst({ where: { id: v.postId, schoolId: user.schoolId } });
    if (!p) throw new ServiceError('Post not found', 404);
    if (p.status !== 'APPROVED') throw new ServiceError('A vacancy can be opened only on an approved post', 409);
    if (p.employer === 'GOVERNMENT') throw new ServiceError('Government teachers are posted by the ministry; add them directly instead of advertising', 409);
    const filled = await tx.employee.count({ where: { schoolId: user.schoolId, postId: p.id, status: { notIn: LEFT as never[] } } });
    const open = await tx.vacancy.count({ where: { schoolId: user.schoolId, postId: p.id, status: 'OPEN' } });
    if (filled + open >= p.count) throw new ServiceError('Every place on this post is filled or already advertised', 409);
    const row = await tx.vacancy.create({ data: { schoolId: user.schoolId, postId: p.id, title: v.title, requirements: v.requirements ?? null, closingDate: toDay(v.closingDate), createdById: user.id } });
    await audit(tx, user, 'HR_SAVE_VACANCY', 'Vacancy', row.id, `Opened the vacancy ${v.title}, closing ${v.closingDate}`, undefined, { postId: p.id, closingDate: v.closingDate });
    return { id: row.id };
  });
}

export async function closeVacancy(user: Actor, id: string) {
  need(user, 'hr.recruitment.manage');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const v = await tx.vacancy.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!v) throw new ServiceError('Vacancy not found', 404);
    if (v.status !== 'OPEN') throw new ServiceError('This vacancy is closed already', 409);
    await tx.vacancy.update({ where: { id }, data: { status: 'CLOSED' } });
    await audit(tx, user, 'HR_SAVE_VACANCY', 'Vacancy', id, `Closed the vacancy ${v.title}`, { status: 'OPEN' }, { status: 'CLOSED' });
    return { id };
  });
}

export async function listVacancies(user: Actor) {
  need(user, 'hr.recruitment.manage', 'hr.posts.approve');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const rows = await tx.vacancy.findMany({ where: { schoolId: user.schoolId }, orderBy: { closingDate: 'desc' }, take: 100 });
    const apps = await tx.applicant.groupBy({ by: ['vacancyId', 'stage'], where: { schoolId: user.schoolId, vacancyId: { in: rows.map((r) => r.id) } }, _count: { _all: true } });
    return rows.map((r) => ({ id: r.id, postId: r.postId, title: r.title, requirements: r.requirements, closingDate: isoOf(r.closingDate), status: r.status, applicants: Object.fromEntries(apps.filter((a) => a.vacancyId === r.id).map((a) => [a.stage, a._count._all])) }));
  });
}

export const ApplicantSchema = z.object({ vacancyId: idSchema, name: textSchema('the name', 2, 100), phone: optText(30), email: z.string().trim().email().max(120).optional().or(z.literal('').transform(() => undefined)), cvKey: optText(300), qualifications: optText(1000), notes: optText(1000) });

export async function addApplicant(user: Actor, raw: unknown) {
  need(user, 'hr.recruitment.manage');
  const v = ApplicantSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const vac = await tx.vacancy.findFirst({ where: { id: v.vacancyId, schoolId: user.schoolId } });
    if (!vac) throw new ServiceError('Vacancy not found', 404);
    if (vac.status !== 'OPEN') throw new ServiceError('This vacancy is closed', 409);
    const a = await tx.applicant.create({ data: { schoolId: user.schoolId, vacancyId: v.vacancyId, name: v.name, phone: v.phone ?? null, email: v.email ?? null, cvKey: v.cvKey ?? null, qualifications: v.qualifications ?? null, notes: v.notes ?? null } });
    await audit(tx, user, 'HR_SAVE_APPLICANT', 'Applicant', a.id, `Applicant ${v.name} for ${vac.title}`, undefined, { vacancyId: v.vacancyId });
    return { id: a.id };
  });
}

const FORWARD = ['APPLIED', 'SHORTLISTED', 'INTERVIEWED', 'OFFERED'] as const;
export const StageSchema = z.object({ stage: z.enum(['SHORTLISTED', 'INTERVIEWED', 'OFFERED', 'REJECTED']), reason: z.string().trim().max(300).optional() });

/** Applied → Shortlisted → Interviewed → Offered, one step at a time; rejected from any stage with a reason. Hired only by hiring. */
export async function moveApplicant(user: Actor, id: string, raw: unknown) {
  need(user, 'hr.recruitment.manage');
  const v = StageSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const a = await tx.applicant.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!a) throw new ServiceError('Applicant not found', 404);
    if (a.stage === 'HIRED' || a.stage === 'REJECTED') throw new ServiceError(`This applicant is ${a.stage.toLowerCase()} already`, 409);
    if (v.stage === 'REJECTED') {
      if (!v.reason || v.reason.length < 3) throw new ServiceError('Give a reason for rejecting', 422);
    } else {
      const from = FORWARD.indexOf(a.stage as (typeof FORWARD)[number]), to = FORWARD.indexOf(v.stage);
      if (to !== from + 1) throw new ServiceError(`An applicant moves one stage at a time (${a.stage.toLowerCase()} → ${FORWARD[from + 1]?.toLowerCase()})`, 409);
      if (v.stage === 'OFFERED') {
        const scores = await tx.interviewScore.count({ where: { applicantId: id } });
        if (scores === 0) throw new ServiceError('Record the interview panel\'s scores before making an offer', 409);
      }
    }
    await tx.applicant.update({ where: { id }, data: { stage: v.stage, rejectionReason: v.stage === 'REJECTED' ? v.reason : null } });
    await audit(tx, user, 'HR_SAVE_APPLICANT', 'Applicant', id, `${a.name}: ${a.stage} to ${v.stage}${v.reason ? ` (${v.reason})` : ''}`, { stage: a.stage }, { stage: v.stage });
    return { id, stage: v.stage };
  });
}

export const ScoreSchema = z.object({
  scores: z.array(z.object({ criterion: textSchema('the criterion', 2, 60), score: z.number().int().min(1, 'Scores are 1 to 5').max(5, 'Scores are 1 to 5'), comment: optText(300) })).min(1).max(12),
  recommendation: z.enum(['HIRE', 'CONSIDER', 'DO_NOT_HIRE']),
});

/** One panel member's scores (1 to 5 per criterion) and recommendation. A panel member re-scoring replaces their own scores. */
export async function scoreApplicant(user: Actor, applicantId: string, raw: unknown) {
  need(user, 'hr.recruitment.manage');
  const v = ScoreSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const a = await tx.applicant.findFirst({ where: { id: applicantId, schoolId: user.schoolId } });
    if (!a) throw new ServiceError('Applicant not found', 404);
    if (!['SHORTLISTED', 'INTERVIEWED'].includes(a.stage)) throw new ServiceError('Only shortlisted applicants are interviewed', 409);
    if (new Set(v.scores.map((s) => s.criterion.toLowerCase())).size !== v.scores.length) throw new ServiceError('Each criterion is scored once', 422);
    for (const s of v.scores) {
      await tx.interviewScore.upsert({
        where: { applicantId_panelistId_criterion: { applicantId, panelistId: user.id, criterion: s.criterion } },
        update: { score: s.score, comment: s.comment ?? null, recommendation: v.recommendation },
        create: { schoolId: user.schoolId, applicantId, panelistId: user.id, criterion: s.criterion, score: s.score, comment: s.comment ?? null, recommendation: v.recommendation },
      });
    }
    await audit(tx, user, 'HR_SCORE_APPLICANT', 'Applicant', applicantId, `Scored ${a.name}: ${v.recommendation.toLowerCase().replace('_', ' ')}`, undefined, { average: v.scores.reduce((s, x) => s + x.score, 0) / v.scores.length });
    return { id: applicantId };
  });
}

/** Applicants of a vacancy with their panel average and recommendations, best first. */
export async function listApplicants(user: Actor, vacancyId: string) {
  need(user, 'hr.recruitment.manage');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const rows = await tx.applicant.findMany({ where: { schoolId: user.schoolId, vacancyId }, orderBy: { createdAt: 'asc' } });
    const scores = await tx.interviewScore.findMany({ where: { schoolId: user.schoolId, applicantId: { in: rows.map((r) => r.id) } } });
    return rows.map((a) => {
      const mine = scores.filter((s) => s.applicantId === a.id);
      const avg = mine.length ? Math.round((mine.reduce((s, x) => s + x.score, 0) / mine.length) * 100) / 100 : null;
      const rec = new Map<string, string>();
      for (const s of mine) if (s.recommendation) rec.set(s.panelistId, s.recommendation);
      return { id: a.id, name: a.name, phone: a.phone, email: a.email, stage: a.stage, qualifications: a.qualifications, notes: a.notes, hasCv: !!a.cvKey, rejectionReason: a.rejectionReason, average: avg, panelists: rec.size, recommendations: Array.from(rec.values()), hiredEmployeeId: a.hiredEmployeeId };
    }).sort((a, b) => (b.average ?? 0) - (a.average ?? 0));
  });
}

export const HireSchema = z.object({
  startDate: isoDateSchema, jobTitle: textSchema('the job title', 2, 80).optional(), kind: z.enum(['PERMANENT', 'FIXED_TERM', 'TEMPORARY', 'CASUAL']), endDate: isoDateSchema.optional(), probationEnd: isoDateSchema.optional(),
  hours: optText(80), noticePeriod: optText(80),
});

/** Hiring turns an offered applicant into an employee (school-paid) with a draft contract. */
export async function hireApplicant(user: Actor, applicantId: string, raw: unknown) {
  need(user, 'hr.recruitment.manage', 'hr.employees.manage');
  if (!hrHolds(user, 'hr.employees.manage')) throw new ServiceError('Forbidden', 403);
  const v = HireSchema.parse(raw);
  if ((v.kind === 'FIXED_TERM' || v.kind === 'TEMPORARY') && !v.endDate) throw new ServiceError('A fixed-term or temporary contract needs an end date', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await ensureHrDefaults(tx, user.schoolId);
    const a = await tx.applicant.findFirst({ where: { id: applicantId, schoolId: user.schoolId } });
    if (!a) throw new ServiceError('Applicant not found', 404);
    if (a.stage !== 'OFFERED') throw new ServiceError('Only an applicant who has been made an offer can be hired', 409);
    const vac = await tx.vacancy.findFirstOrThrow({ where: { id: a.vacancyId } });
    const post = await tx.post.findFirstOrThrow({ where: { id: vac.postId } });
    const filled = await tx.employee.count({ where: { schoolId: user.schoolId, postId: post.id, status: { notIn: LEFT as never[] } } });
    if (filled >= post.count) throw new ServiceError('Every place on this post is filled', 409);
    const parts = a.name.trim().split(/\s+/);
    const firstName = parts[0]!, surname = parts.length > 1 ? parts.slice(1).join(' ') : parts[0]!;
    const e = await tx.employee.create({
      data: {
        schoolId: user.schoolId, employeeNo: await nextEmployeeNo(tx, user.schoolId), createdById: user.id, firstName, surname, personalPhone: a.phone, personalEmail: a.email,
        jobTitle: v.jobTitle ?? post.title, departmentId: post.departmentId, category: post.category, employer: 'SCHOOL', postId: post.id, startDate: toDay(v.startDate),
      },
    });
    const contract = await tx.contract.create({
      data: { schoolId: user.schoolId, employeeId: e.id, kind: v.kind, startDate: toDay(v.startDate), endDate: v.endDate ? toDay(v.endDate) : null, probationEnd: v.probationEnd ? toDay(v.probationEnd) : null, jobTitle: e.jobTitle, terms: { hours: v.hours ?? null, noticePeriod: v.noticePeriod ?? null, monthlyCostCents: post.monthlyCostCents, currency: post.currency }, createdById: user.id },
    });
    await tx.applicant.update({ where: { id: applicantId }, data: { stage: 'HIRED', hiredEmployeeId: e.id } });
    if (filled + 1 >= post.count) await tx.vacancy.update({ where: { id: vac.id }, data: { status: 'FILLED' } });
    await tx.employeeHistory.create({ data: { schoolId: user.schoolId, employeeId: e.id, field: 'status', oldValue: null, newValue: 'ACTIVE', effectiveDate: toDay(v.startDate), changedById: user.id, reason: `Hired from vacancy ${vac.title}` } });
    await audit(tx, user, 'HR_HIRE_APPLICANT', 'Employee', e.id, `Hired ${a.name} as ${e.jobTitle} (${e.employeeNo})`, { stage: 'OFFERED' }, { stage: 'HIRED', employeeId: e.id, contractId: contract.id });
    return { employeeId: e.id, employeeNo: e.employeeNo, contractId: contract.id };
  });
}

export const GovernmentTeacherSchema = z.object({
  title: optText(20), firstName: textSchema('the first name', 1, 60), surname: textSchema('the surname', 1, 60), gender: z.enum(['M', 'F']).optional(), nationalId: optText(30),
  ecNumber: textSchema('the EC number', 3, 30), postedOn: isoDateSchema, departmentId: idSchema.optional(), jobTitle: textSchema('the job title', 2, 80).default('Teacher'),
  personalPhone: optText(30), workPhone: optText(30),
});

/** A teacher posted by the ministry: no vacancy, no applicants. Government-paid, with the EC number and the posting date. */
export async function addGovernmentTeacher(user: Actor, raw: unknown) {
  const v = GovernmentTeacherSchema.parse(raw);
  return createEmployee(user, { ...v, category: 'TEACHING', employer: 'GOVERNMENT', startDate: v.postedOn });
}

// ─── Contracts ───────────────────────────────────────────────────────────────

export const ContractSchema = z.object({
  employeeId: idSchema, kind: z.enum(['PERMANENT', 'FIXED_TERM', 'TEMPORARY', 'CASUAL']), startDate: isoDateSchema, endDate: isoDateSchema.optional(), probationEnd: isoDateSchema.optional(),
  jobTitle: textSchema('the job title', 2, 80), gradeId: idSchema.optional(), hours: optText(80), noticePeriod: optText(80), salaryText: optText(80),
});

function checkContractDates(v: { kind: string; startDate: string; endDate?: string; probationEnd?: string }) {
  if ((v.kind === 'FIXED_TERM' || v.kind === 'TEMPORARY') && !v.endDate) throw new ServiceError('A fixed-term or temporary contract needs an end date', 422);
  if (v.endDate && v.endDate < v.startDate) throw new ServiceError('The end date is before the start date', 422);
  if (v.probationEnd && v.probationEnd < v.startDate) throw new ServiceError('The probation cannot end before the contract starts', 422);
}

export async function createContract(user: Actor, raw: unknown, previousContractId?: string) {
  need(user, 'hr.contracts.manage');
  const v = ContractSchema.parse(raw);
  checkContractDates(v);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const e = await employeeById(tx, user.schoolId, v.employeeId);
    if (e.employer !== 'SCHOOL') throw new ServiceError('Government-paid teachers have the ministry\'s terms, not a school contract', 409);
    if (LEFT.includes(e.status)) throw new ServiceError('This person has left', 409);
    if (v.gradeId && !(await tx.payGrade.findFirst({ where: { id: v.gradeId, schoolId: user.schoolId } }))) throw new ServiceError('Pay grade not found', 404);
    const c = await tx.contract.create({
      data: {
        schoolId: user.schoolId, employeeId: e.id, kind: v.kind, startDate: toDay(v.startDate), endDate: v.endDate ? toDay(v.endDate) : null, probationEnd: v.probationEnd ? toDay(v.probationEnd) : null,
        jobTitle: v.jobTitle, gradeId: v.gradeId ?? null, terms: { hours: v.hours ?? null, noticePeriod: v.noticePeriod ?? null, salaryText: v.salaryText ?? null }, previousContractId: previousContractId ?? null, createdById: user.id,
      },
    });
    await audit(tx, user, 'HR_SAVE_CONTRACT', 'Contract', c.id, `Draft ${v.kind.toLowerCase().replace('_', '-')} contract for ${fullName(e)}`, undefined, { kind: v.kind, startDate: v.startDate, endDate: v.endDate ?? null });
    return { id: c.id };
  });
}

/** Makes the contract active, writes it from the template into the employee's documents, and ends the one it renews. */
export async function activateContract(user: Actor, id: string) {
  need(user, 'hr.contracts.manage');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const c = await tx.contract.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!c) throw new ServiceError('Contract not found', 404);
    if (c.status !== 'DRAFT') throw new ServiceError(`This contract is ${c.status.toLowerCase()}`, 409);
    const e = await employeeById(tx, user.schoolId, c.employeeId);
    const other = await tx.contract.findFirst({ where: { schoolId: user.schoolId, employeeId: c.employeeId, status: 'ACTIVE', id: { not: id } } });
    if (other && other.id !== c.previousContractId) throw new ServiceError('This person has another active contract. End it or renew it instead.', 409);
    if (other) await tx.contract.update({ where: { id: other.id }, data: { status: 'EXPIRED' } });
    const terms = (c.terms ?? {}) as { hours?: string | null; noticePeriod?: string | null; salaryText?: string | null };
    const letter = await saveLetter(tx, user, e, 'CONTRACT', {
      effectiveDate: isoOf(c.startDate), endDate: c.endDate ? isoOf(c.endDate) : undefined, probationEnd: c.probationEnd ? isoOf(c.probationEnd) : undefined, jobTitle: c.jobTitle,
      hours: terms.hours ?? undefined, noticePeriod: terms.noticePeriod ?? undefined, salaryText: terms.salaryText ?? undefined,
    });
    await tx.contract.update({ where: { id }, data: { status: 'ACTIVE', fileKey: letter.id } });
    await audit(tx, user, 'HR_SAVE_CONTRACT', 'Contract', id, `Activated the contract of ${fullName(e)} (${letter.reference})`, { status: 'DRAFT' }, { status: 'ACTIVE', reference: letter.reference });
    return { id, status: 'ACTIVE' as const, reference: letter.reference };
  });
}

export const SignedCopySchema = z.object({ signedFileKey: textSchema('the file', 3, 300) });

export async function attachSignedContract(user: Actor, id: string, raw: unknown) {
  need(user, 'hr.contracts.manage');
  const v = SignedCopySchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const c = await tx.contract.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!c) throw new ServiceError('Contract not found', 404);
    await tx.contract.update({ where: { id }, data: { signedFileKey: v.signedFileKey } });
    await audit(tx, user, 'HR_SAVE_CONTRACT', 'Contract', id, 'Attached the signed copy of a contract');
    return { id };
  });
}

/** A renewal is a new contract linked to the old one; the old one ends when the new one is activated. */
export async function renewContract(user: Actor, id: string, raw: unknown) {
  need(user, 'hr.contracts.manage');
  const old = await getScopedDb(user.schoolId, user.id).$tx((tx) => tx.contract.findFirst({ where: { id, schoolId: user.schoolId } }));
  if (!old) throw new ServiceError('Contract not found', 404);
  if (!['ACTIVE', 'EXPIRED'].includes(old.status)) throw new ServiceError('Only an active or expired contract is renewed', 409);
  const given = z.object({ startDate: isoDateSchema.optional(), endDate: isoDateSchema.optional(), kind: z.enum(['PERMANENT', 'FIXED_TERM', 'TEMPORARY', 'CASUAL']).optional(), jobTitle: textSchema('the job title', 2, 80).optional(), hours: optText(80), noticePeriod: optText(80), salaryText: optText(80) }).parse(raw);
  const terms = (old.terms ?? {}) as { hours?: string; noticePeriod?: string; salaryText?: string };
  const start = given.startDate ?? (old.endDate ? addDays(isoOf(old.endDate), 1) : todayInHarare());
  return createContract(user, { employeeId: old.employeeId, kind: given.kind ?? old.kind, startDate: start, endDate: given.endDate, jobTitle: given.jobTitle ?? old.jobTitle, gradeId: old.gradeId ?? undefined, hours: given.hours ?? terms.hours ?? undefined, noticePeriod: given.noticePeriod ?? terms.noticePeriod ?? undefined, salaryText: given.salaryText ?? terms.salaryText ?? undefined }, old.id)
    .then(async (r) => {
      await getScopedDb(user.schoolId, user.id).$tx((tx) => audit(tx, user, 'HR_RENEW_CONTRACT', 'Contract', r.id, `Renewal of a contract (previous ${old.id})`, undefined, { previousContractId: old.id }));
      return r;
    });
}

export async function listContracts(user: Actor, employeeId?: string) {
  need(user, 'hr.contracts.manage', 'hr.employees.view');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const rows = await tx.contract.findMany({ where: { schoolId: user.schoolId, ...(employeeId ? { employeeId } : {}) }, orderBy: { startDate: 'desc' }, take: 300 });
    const emps = new Map((await tx.employee.findMany({ where: { schoolId: user.schoolId, id: { in: rows.map((r) => r.employeeId) } } })).map((e) => [e.id, fullName(e)]));
    return rows.map((c: Contract) => ({ id: c.id, employeeId: c.employeeId, employee: emps.get(c.employeeId) ?? '?', kind: c.kind, jobTitle: c.jobTitle, status: c.status, startDate: isoOf(c.startDate), endDate: c.endDate ? isoOf(c.endDate) : null, probationEnd: c.probationEnd ? isoOf(c.probationEnd) : null, previousContractId: c.previousContractId, signed: !!c.signedFileKey, documentId: c.fileKey }));
  });
}

/** Contracts and probations ending in the next N days (default 90). */
export async function contractsEnding(user: Actor, days = 90) {
  need(user, 'hr.contracts.manage', 'hr.reports.view', 'hr.employees.view');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const today = todayInHarare(), until = addDays(today, days);
    const rows = await tx.contract.findMany({ where: { schoolId: user.schoolId, status: 'ACTIVE', OR: [{ endDate: { gte: toDay(today), lte: toDay(until) } }, { probationEnd: { gte: toDay(today), lte: toDay(until) } }] }, orderBy: { endDate: 'asc' } });
    const emps = new Map((await tx.employee.findMany({ where: { schoolId: user.schoolId, id: { in: rows.map((r) => r.employeeId) } } })).map((e) => [e.id, fullName(e)]));
    const left = (iso: string) => Math.round((new Date(`${iso}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000);
    return rows.flatMap((c) => [
      ...(c.endDate && isoOf(c.endDate) >= today && isoOf(c.endDate) <= until ? [{ contractId: c.id, employee: emps.get(c.employeeId) ?? '?', what: 'Contract ends', date: isoOf(c.endDate), daysLeft: left(isoOf(c.endDate)) }] : []),
      ...(c.probationEnd && isoOf(c.probationEnd) >= today && isoOf(c.probationEnd) <= until ? [{ contractId: c.id, employee: emps.get(c.employeeId) ?? '?', what: 'Probation ends', date: isoOf(c.probationEnd), daysLeft: left(isoOf(c.probationEnd)) }] : []),
    ]).sort((a, b) => a.date.localeCompare(b.date));
  });
}

/**
 * Daily: contracts that have run out become Expired, and HR and the Head are told 60 and 30 days before a contract or a probation ends
 * (each reminder once, however often this runs).
 */
export async function runContractSchedule(tx: Db, schoolId: string, today = todayInHarare()) {
  const s = await tx.hrSettings.findUnique({ where: { schoolId } });
  const marks = [...(s?.contractReminderDays ?? [60, 30])].sort((a, b) => b - a);
  const expired = await tx.contract.updateMany({ where: { schoolId, status: 'ACTIVE', endDate: { lt: toDay(today) } }, data: { status: 'EXPIRED' } });
  const heads = (await tx.user.findMany({ where: { schoolId, active: true, isSupport: false, userRoles: { some: { role: { key: 'HEAD' } } } }, select: { id: true } })).map((u) => u.id);
  const hr = await approverIds(tx, schoolId, 'hr.contracts.manage');
  const to = Array.from(new Set([...hr, ...heads]));
  let reminded = 0;
  const rows = await tx.contract.findMany({ where: { schoolId, status: 'ACTIVE', OR: [{ endDate: { gte: toDay(today) } }, { probationEnd: { gte: toDay(today) } }] } });
  const emps = new Map((await tx.employee.findMany({ where: { schoolId, id: { in: rows.map((r) => r.employeeId) } } })).map((e) => [e.id, fullName(e)]));
  for (const c of rows) {
    for (const [what, date] of [['contract', c.endDate], ['probation', c.probationEnd]] as const) {
      if (!date) continue;
      const left = Math.round((date.getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000);
      if (left < 0) continue;
      // The first mark that is still ahead of us: 60 while more than 30 days remain, then 30.
      const mark = marks.filter((m) => left <= m).sort((a, b) => a - b)[0];
      if (mark == null) continue;
      reminded += await notifyUsers(tx, schoolId, to, { type: 'HR', title: `${emps.get(c.employeeId) ?? 'A contract'}: ${what} ends in ${left} days`, body: `${what === 'contract' ? 'Contract' : 'Probation'} ends on ${isoOf(date)}`, link: `/hr/contracts`, dedupeKey: `contract:${c.id}:${what}:${mark}` });
    }
  }
  return { expired: expired.count, reminded };
}

// ─── Ending employment ───────────────────────────────────────────────────────

const EXIT_STATUS = { RESIGNATION: 'RESIGNED', END_OF_CONTRACT: 'RESIGNED', RETIREMENT: 'RETIRED', DISMISSAL: 'DISMISSED', DEATH: 'DECEASED' } as const;

export const EndEmploymentSchema = z.object({
  reason: z.enum(['RESIGNATION', 'END_OF_CONTRACT', 'RETIREMENT', 'DISMISSAL', 'DEATH']), lastDay: isoDateSchema, noticeServed: z.boolean().default(false),
  finalPay: z.array(z.object({ label: textSchema('the item', 2, 80), kind: z.enum(['PAY', 'DEDUCTION']), amountCents: centsSchema, currency: currencySchema.default('USD') })).max(20).default([]),
  clearance: z.array(z.object({ item: textSchema('the item', 2, 80), done: z.boolean() })).max(20).default([{ item: 'Keys', done: false }, { item: 'School property', done: false }, { item: 'Library books', done: false }]),
  note: optText(500),
});

/**
 * Ends employment: the reason, the last day, notice, final pay items and the exit clearance are recorded, the status and leaving date are
 * set, active contracts end, pending leave is cancelled, a certificate of service is made, and the login is switched off. The record
 * and its history are kept.
 */
export async function endEmployment(user: Actor, employeeId: string, raw: unknown) {
  need(user, 'hr.contracts.manage');
  const v = EndEmploymentSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const e = await employeeById(tx, user.schoolId, employeeId);
    if (LEFT.includes(e.status)) throw new ServiceError('This person has left already', 409);
    if (v.lastDay < isoOf(e.startDate)) throw new ServiceError('The last day is before the start date', 422);
    const status = EXIT_STATUS[v.reason];
    await tx.employee.update({ where: { id: employeeId }, data: { status, leavingDate: toDay(v.lastDay), leavingReason: v.reason } });
    await tx.employeeExit.create({ data: { schoolId: user.schoolId, employeeId, reason: v.reason, lastDay: toDay(v.lastDay), noticeServed: v.noticeServed, finalPay: v.finalPay, clearance: v.clearance, processedById: user.id } });
    await tx.employeeHistory.create({ data: { schoolId: user.schoolId, employeeId, field: 'status', oldValue: e.status, newValue: status, effectiveDate: toDay(v.lastDay), changedById: user.id, reason: `${v.reason.toLowerCase().replace('_', ' ')}${v.note ? `: ${v.note}` : ''}` } });
    await tx.contract.updateMany({ where: { schoolId: user.schoolId, employeeId, status: { in: ['ACTIVE', 'DRAFT'] } }, data: { status: 'TERMINATED', terminatedOn: toDay(v.lastDay) } });
    await tx.leaveRequest.updateMany({ where: { schoolId: user.schoolId, employeeId, status: 'PENDING' }, data: { status: 'CANCELLED', decisionReason: 'Employment ended' } });
    // Leave days owed: shown so HR can add the payout to the final payroll as a one-off item.
    const vac = await tx.leaveType.findFirst({ where: { schoolId: user.schoolId, code: 'VACATION' } });
    const owed = vac ? Math.max(0, (await balanceOf(tx, user.schoolId, e, vac, Number(v.lastDay.slice(0, 4)), v.lastDay)).remaining) : 0;
    const cert = await saveLetter(tx, user, { ...e, leavingDate: toDay(v.lastDay) }, 'CERTIFICATE_OF_SERVICE', { lastDay: v.lastDay, note: v.note });
    let loginOff = false;
    if (e.userId) {
      const holdsTop = await tx.userRole.findFirst({ where: { userId: e.userId, role: { key: { in: ['OWNER', 'ADMINISTRATOR'] } } }, select: { id: true } });
      if (!holdsTop && e.userId !== user.id) {
        await tx.user.update({ where: { id: e.userId }, data: { active: false, tokenVersion: { increment: 1 }, permVersion: { increment: 1 } } });
        loginOff = true;
      }
    }
    await audit(tx, user, 'HR_END_EMPLOYMENT', 'Employee', employeeId, `Employment of ${fullName(e)} ended on ${v.lastDay}: ${v.reason.toLowerCase().replace('_', ' ')}`, { status: e.status }, { status, lastDay: v.lastDay, reason: v.reason, loginSwitchedOff: loginOff });
    return { id: employeeId, status, certificate: cert.reference, leaveDaysOwed: owed, loginSwitchedOff: loginOff, finalPay: v.finalPay };
  });
}

export type { Employee, EmployeeCategory };
