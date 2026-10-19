// ZIMSEC (and Cambridge) registration and results. The Exams Officer builds the entry list from data the school already has, checks
// fees and documents, and exports it for submission; when results come out they are loaded back for analysis.
//
// ZIMSEC's entry formats, fees and deadlines change, so nothing here is hard-coded: the Exams Officer enters each session's subject
// codes, fees and dates, and chooses the export columns.
//  • School candidates come from Form 4 (O Level) or Upper 6 (A Level), or other forms for early entries, with their subjects from
//    StudentSubject mapped to the session's subject codes. Private candidates (re-sitters registering at the school as a centre) are typed in.
//  • Checks per candidate: name matches the birth certificate (ticked after looking at it), date of birth, ID number, photo if the
//    session needs one, subject codes, fee paid.
//  • Fees: subjects x fee per subject + any fixed fee. With Finance on, "Create exam fee charges" adds a charge to each school
//    candidate's account and paid or unpaid shows on the list; otherwise it is ticked by hand. Unpaid candidates are flagged, not removed.
//  • The Head approves the entry list; then it exports to Excel or CSV. After approval every change is logged as an amendment.
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { toCsv } from '@/lib/csv';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { notifyUsers } from '@/lib/system/notifications';
import { round2 } from '@/lib/results';
import { holds, idSchema, isoDateSchema, num, resolveTerm, toDay, type Actor } from '@/lib/exams/common';

const need = (user: Actor, ...keys: Parameters<typeof holds>[1][]) => {
  if (!keys.some((k) => holds(user, k))) throw new ServiceError('Forbidden', 403);
};
const dayText = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

// ─── Export columns ──────────────────────────────────────────────────────────

export const EXPORT_COLUMNS = {
  centre: 'Centre number',
  candidateNumber: 'Candidate number',
  surname: 'Surname',
  firstNames: 'First names',
  fullName: 'Full name',
  gender: 'Gender',
  dateOfBirth: 'Date of birth',
  idNumber: 'ID / birth certificate number',
  phone: 'Phone',
  admissionNumber: 'Admission number',
  className: 'Class',
  subjectsJoined: 'Subject codes (one column)',
  subjectsSplit: 'Subject codes (one column each)',
  subjectCount: 'Number of subjects',
  feeTotal: 'Fee total',
  feeStatus: 'Fee status',
  subjectCode: 'Subject code (one row per subject)',
  subjectName: 'Subject name (one row per subject)',
} as const;
export type ExportColumn = keyof typeof EXPORT_COLUMNS;
export const DEFAULT_EXPORT_COLUMNS: ExportColumn[] = ['centre', 'candidateNumber', 'surname', 'firstNames', 'gender', 'dateOfBirth', 'idNumber', 'subjectsSplit'];

const GRADE = /^[A-Z][*+]?$/;

// ─── Sessions ────────────────────────────────────────────────────────────────

export const SessionSchema = z.object({
  board: z.enum(['ZIMSEC', 'CAMBRIDGE']),
  category: z.enum(['O_LEVEL', 'A_LEVEL']),
  session: z.string().trim().min(3, 'Name the session, for example November 2027').max(60),
  centreNumber: z.string().trim().min(1, 'Enter the centre number').max(30),
  registrationOpens: isoDateSchema.nullish(),
  registrationCloses: isoDateSchema.nullish(),
  feePerSubject: z.number().min(0).max(100_000).refine((n) => round2(n) === n, 'Use at most two decimal places'),
  fixedFee: z.number().min(0).max(100_000).default(0),
  currency: z.enum(['USD', 'ZIG']).default('USD'),
  photoRequired: z.boolean().default(true),
  passGrades: z.array(z.string().trim().regex(GRADE, 'A grade is a letter, like A or C')).min(1, 'Name the grades that count as a pass').max(12),
  gradePoints: z.record(z.string(), z.number().int().min(0).max(20)).nullish(),
  exportColumns: z.array(z.enum(Object.keys(EXPORT_COLUMNS) as [ExportColumn, ...ExportColumn[]])).min(1).max(20).default(DEFAULT_EXPORT_COLUMNS),
  exportLayout: z.enum(['CANDIDATE', 'ENTRY']).default('CANDIDATE'),
}).refine((s) => !s.registrationOpens || !s.registrationCloses || s.registrationCloses >= s.registrationOpens, { path: ['registrationCloses'], message: 'Registration cannot close before it opens' });

export interface SessionRow {
  id: string; board: 'ZIMSEC' | 'CAMBRIDGE'; category: 'O_LEVEL' | 'A_LEVEL'; session: string; centreNumber: string; registrationOpens: string | null; registrationCloses: string | null;
  feePerSubject: number; fixedFee: number; currency: string; photoRequired: boolean; passGrades: string[]; gradePoints: Record<string, number> | null; exportColumns: string[]; exportLayout: string;
  status: 'OPEN' | 'APPROVED'; approvedAt: string | null; candidates: number; codes: number;
}

const toRow = (s: Prisma.BoardSessionGetPayload<{ include: { _count: { select: { candidates: true; codes: true } } } }>): SessionRow => ({
  id: s.id, board: s.board, category: s.category, session: s.session, centreNumber: s.centreNumber, registrationOpens: dayText(s.registrationOpens), registrationCloses: dayText(s.registrationCloses),
  feePerSubject: num(s.feePerSubject)!, fixedFee: num(s.fixedFee)!, currency: s.currency, photoRequired: s.photoRequired, passGrades: s.passGrades, gradePoints: (s.gradePoints as Record<string, number> | null) ?? null,
  exportColumns: s.exportColumns, exportLayout: s.exportLayout, status: s.status, approvedAt: s.approvedAt?.toISOString() ?? null, candidates: s._count.candidates, codes: s._count.codes,
});

export async function listSessions(user: Actor): Promise<SessionRow[]> {
  need(user, 'exams.zimsec.manage', 'exams.zimsec.approve', 'exams.zimsec.results_import', 'exams.analytics.view');
  const rows = await getScopedDb(user.schoolId, user.id).boardSession.findMany({ where: { schoolId: user.schoolId }, include: { _count: { select: { candidates: true, codes: true } } }, orderBy: [{ createdAt: 'desc' }] });
  return rows.map(toRow);
}

export async function getSession(user: Actor, id: string): Promise<SessionRow> {
  need(user, 'exams.zimsec.manage', 'exams.zimsec.approve', 'exams.zimsec.results_import', 'exams.analytics.view');
  const s = await getScopedDb(user.schoolId, user.id).boardSession.findFirst({ where: { id, schoolId: user.schoolId }, include: { _count: { select: { candidates: true, codes: true } } } });
  if (!s) throw new ServiceError('Session not found', 404);
  return toRow(s);
}

/** The centre number comes from School Settings unless the Exams Officer types another. */
export async function defaultCentre(user: Actor): Promise<string> {
  const s = await getScopedDb(user.schoolId, user.id).school.findUnique({ where: { id: user.schoolId }, select: { zimsecCentreNumber: true } });
  return s?.zimsecCentreNumber ?? '';
}

async function syncCalendar(tx: Db, schoolId: string, userId: string, s: { id: string; board: string; session: string; registrationOpens: Date | null; registrationCloses: Date | null }) {
  for (const [kind, date, label] of [['open', s.registrationOpens, 'registration opens'], ['close', s.registrationCloses, 'registration closes']] as const) {
    const autoKey = `board:${s.id}:${kind}`;
    if (!date) { await tx.calendarEvent.deleteMany({ where: { schoolId, autoKey } }); continue; }
    const data = { title: `${s.board} ${s.session}: ${label}`, kind: 'EXAM' as const, startDate: date, endDate: date, audience: 'ALL_STAFF' as const };
    await tx.calendarEvent.upsert({ where: { schoolId_autoKey: { schoolId, autoKey } }, update: data, create: { schoolId, autoKey, createdById: userId, ...data } });
  }
}

export async function saveSession(user: Actor, raw: unknown, id?: string) {
  need(user, 'exams.zimsec.manage');
  const input = SessionSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sid = user.schoolId;
    const data = {
      board: input.board, category: input.category, session: input.session, centreNumber: input.centreNumber, registrationOpens: input.registrationOpens ? toDay(input.registrationOpens) : null,
      registrationCloses: input.registrationCloses ? toDay(input.registrationCloses) : null, feePerSubject: input.feePerSubject, fixedFee: input.fixedFee, currency: input.currency,
      photoRequired: input.photoRequired, passGrades: input.passGrades.map((g) => g.toUpperCase()), gradePoints: input.gradePoints ?? undefined, exportColumns: input.exportColumns, exportLayout: input.exportLayout,
    };
    let row;
    if (id) {
      const old = await tx.boardSession.findFirst({ where: { id, schoolId: sid } });
      if (!old) throw new ServiceError('Session not found', 404);
      row = await tx.boardSession.update({ where: { id }, data });
    } else {
      if (await tx.boardSession.findFirst({ where: { schoolId: sid, board: input.board, category: input.category, session: { equals: input.session, mode: 'insensitive' } } })) throw new ServiceError('That session already exists', 409);
      row = await tx.boardSession.create({ data: { schoolId: sid, ...data } });
    }
    await syncCalendar(tx, sid, user.id, row);
    await logAudit({ schoolId: sid, actorId: user.id, action: 'SAVE_BOARD_SESSION', entityType: 'BoardSession', entityId: row.id, detail: `${id ? 'Changed' : 'Added'} ${input.board} ${input.session} (${input.category === 'O_LEVEL' ? 'O Level' : 'A Level'}), fee ${input.feePerSubject} per subject` }, tx);
    return { id: row.id };
  });
}

// ─── Subject codes ───────────────────────────────────────────────────────────

export const CodesSchema = z.object({ codes: z.array(z.object({ code: z.string().trim().min(1).max(20), name: z.string().trim().min(1).max(80), subjectId: idSchema.nullish() })).max(80) });

export interface CodeRow { id: string; code: string; name: string; subjectId: string | null; subject: string | null; entries: number }

export async function listCodes(user: Actor, sessionId: string): Promise<CodeRow[]> {
  need(user, 'exams.zimsec.manage', 'exams.zimsec.approve', 'exams.zimsec.results_import', 'exams.analytics.view');
  const rows = await getScopedDb(user.schoolId, user.id).boardSubjectCode.findMany({ where: { schoolId: user.schoolId, sessionId }, include: { subject: { select: { name: true } }, _count: { select: { entries: true } } }, orderBy: { code: 'asc' } });
  return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, subjectId: r.subjectId, subject: r.subject?.name ?? null, entries: r._count.entries }));
}

/**
 * Replaces the session's subject codes with the list given. A code that candidates are entered for, or that has results, stays.
 * A code is mapped to a school subject by its id, else by the subject's ZIMSEC (or Cambridge) code if the school entered one.
 */
export async function saveCodes(user: Actor, sessionId: string, raw: unknown) {
  need(user, 'exams.zimsec.manage');
  const input = CodesSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sid = user.schoolId;
    const session = await tx.boardSession.findFirst({ where: { id: sessionId, schoolId: sid } });
    if (!session) throw new ServiceError('Session not found', 404);
    const seen = new Set<string>();
    for (const c of input.codes) { if (seen.has(c.code.toLowerCase())) throw new ServiceError(`The code ${c.code} is listed twice`, 422); seen.add(c.code.toLowerCase()); }
    const subjects = await tx.subject.findMany({ where: { schoolId: sid }, select: { id: true, zimsecCode: true, cambridgeCode: true } });
    const byCode = new Map(subjects.map((s) => [(session.board === 'ZIMSEC' ? s.zimsecCode : s.cambridgeCode)?.toLowerCase() ?? '', s.id]));
    byCode.delete('');
    const existing = await tx.boardSubjectCode.findMany({ where: { sessionId, schoolId: sid }, include: { _count: { select: { entries: true, results: true } } } });
    const keep = new Set(input.codes.map((c) => c.code.toLowerCase()));
    for (const e of existing) {
      if (keep.has(e.code.toLowerCase())) continue;
      if (e._count.entries + e._count.results > 0) throw new ServiceError(`${e.code} ${e.name} has candidates entered or results, so it cannot be removed`, 409);
      await tx.boardSubjectCode.delete({ where: { id: e.id } });
    }
    for (const c of input.codes) {
      const subjectId = c.subjectId ?? byCode.get(c.code.toLowerCase()) ?? null;
      if (subjectId && !subjects.some((s) => s.id === subjectId)) throw new ServiceError('Subject not found', 404);
      const old = existing.find((e) => e.code.toLowerCase() === c.code.toLowerCase());
      if (old) await tx.boardSubjectCode.update({ where: { id: old.id }, data: { code: c.code, name: c.name, subjectId } });
      else await tx.boardSubjectCode.create({ data: { schoolId: sid, sessionId, code: c.code, name: c.name, subjectId } });
    }
    await logAudit({ schoolId: sid, actorId: user.id, action: 'SAVE_BOARD_SESSION', entityType: 'BoardSession', entityId: sessionId, detail: `Subject codes for ${session.session}: ${input.codes.length}` }, tx);
    return { codes: input.codes.length };
  });
}

// ─── Candidates and their checks ─────────────────────────────────────────────

export interface Check { key: 'name' | 'dob' | 'id' | 'photo' | 'codes' | 'fee'; label: string; ok: boolean; detail: string }

export interface CandidateRow {
  id: string; studentId: string | null; kind: 'SCHOOL' | 'PRIVATE'; name: string; surname: string; firstNames: string; gender: string | null; dateOfBirth: string | null; idNumber: string | null; phone: string | null;
  admissionNumber: string | null; className: string | null; candidateNumber: string | null; nameChecked: boolean; certificateName: string | null;
  codeIds: string[]; subjects: { code: string; name: string }[]; feeTotal: number; feePaid: boolean; feeSource: 'finance' | 'manual' | 'unpaid'; checks: Check[]; ready: boolean;
}

/** "SURNAME, First Names" or "First Names Surname" -> the parts the board wants. */
export function splitName(full: string): { surname: string; firstNames: string } {
  const t = full.trim().replace(/\s+/g, ' ');
  if (t.includes(',')) { const [s, ...rest] = t.split(','); return { surname: s!.trim(), firstNames: rest.join(',').trim() }; }
  const parts = t.split(' ');
  return parts.length === 1 ? { surname: parts[0]!, firstNames: '' } : { surname: parts[parts.length - 1]!, firstNames: parts.slice(0, -1).join(' ') };
}

export const feeLabel = (s: { board: string; session: string }) => `${s.board} ${s.session} exam entry`;

export const feeTotalOf = (s: { feePerSubject: number; fixedFee: number }, subjects: number) => round2(subjects * s.feePerSubject + (subjects > 0 ? s.fixedFee : 0));

async function loadRows(tx: Db, schoolId: string, session: Prisma.BoardSessionGetPayload<object>): Promise<CandidateRow[]> {
  const cands = await tx.candidate.findMany({
    where: { sessionId: session.id, schoolId },
    include: {
      entries: { include: { code: { select: { id: true, code: true, name: true } } } },
      student: { select: { id: true, firstName: true, surname: true, fullName: true, gender: true, dateOfBirth: true, birthCertificateNumber: true, photoUrl: true, admissionNumber: true, currentClass: { select: { name: true } } } },
    },
  });
  const off = new Set((await tx.schoolModule.findMany({ where: { schoolId, enabled: false }, select: { module: true } })).map((m) => m.module));
  const financeOn = !off.has('finance');
  const label = feeLabel(session);
  const studentIds = cands.map((c) => c.studentId).filter((x): x is string => !!x);
  const charged = financeOn && studentIds.length ? await tx.charge.groupBy({ by: ['studentId'], where: { schoolId, studentId: { in: studentIds }, label }, _sum: { amount: true } }) : [];
  const paid = financeOn && studentIds.length ? await tx.payment.groupBy({ by: ['studentId'], where: { schoolId, studentId: { in: studentIds }, feeLabel: label, status: 'VERIFIED' }, _sum: { amount: true } }) : [];
  const fees = { feePerSubject: num(session.feePerSubject)!, fixedFee: num(session.fixedFee)! };

  return cands
    .map<CandidateRow>((c) => {
      const school = !!c.student;
      const full = c.certificateName ?? c.student?.fullName ?? c.fullName ?? '';
      const parts = c.certificateName ? splitName(c.certificateName) : c.student ? { surname: c.student.surname, firstNames: c.student.firstName } : splitName(c.fullName ?? '');
      const dob = c.student?.dateOfBirth ?? c.dateOfBirth;
      const idn = c.student?.birthCertificateNumber ?? c.idNumber;
      const total = feeTotalOf(fees, c.entries.length);
      const chargeSum = charged.find((x) => x.studentId === c.studentId)?._sum.amount?.toNumber() ?? 0;
      const paidSum = paid.find((x) => x.studentId === c.studentId)?._sum.amount?.toNumber() ?? 0;
      const byFinance = financeOn && school && chargeSum > 0 && paidSum + 0.005 >= chargeSum;
      const feePaid = c.feePaidManual || byFinance;
      const checks: Check[] = [
        { key: 'name', label: 'Name matches the birth certificate', ok: c.nameChecked, detail: c.nameChecked ? 'Checked' : 'Look at the birth certificate and tick when the name matches exactly' },
        { key: 'dob', label: 'Date of birth', ok: !!dob, detail: dob ? dayText(dob)! : 'Missing' },
        { key: 'id', label: 'ID or birth certificate number', ok: !!idn, detail: idn ?? 'Missing' },
        { key: 'photo', label: 'Photo', ok: !session.photoRequired || !!c.student?.photoUrl, detail: !session.photoRequired ? 'Not required' : c.student?.photoUrl ? 'On file' : school ? 'No photo on the student record' : 'Private candidates need a photo to be sent with the entry' },
        { key: 'codes', label: 'Subject codes', ok: c.entries.length > 0, detail: c.entries.length ? c.entries.map((e) => e.code.code).sort().join(', ') : 'No subjects entered' },
        { key: 'fee', label: 'Entry fee paid', ok: feePaid, detail: feePaid ? (byFinance ? 'Paid (Finance)' : 'Paid (ticked)') : `${session.currency} ${total.toFixed(2)} not paid` },
      ];
      return {
        id: c.id, studentId: c.studentId, kind: school ? 'SCHOOL' : 'PRIVATE', name: full, surname: parts.surname, firstNames: parts.firstNames, gender: c.student?.gender ?? c.gender ?? null,
        dateOfBirth: dayText(dob ?? null), idNumber: idn ?? null, phone: c.phone ?? null, admissionNumber: c.student?.admissionNumber ?? null, className: c.student?.currentClass?.name ?? null,
        candidateNumber: c.candidateNumber, nameChecked: c.nameChecked, certificateName: c.certificateName, codeIds: c.entries.map((e) => e.codeId),
        subjects: c.entries.map((e) => ({ code: e.code.code, name: e.code.name })).sort((a, b) => a.code.localeCompare(b.code)), feeTotal: total, feePaid, feeSource: byFinance ? 'finance' : c.feePaidManual ? 'manual' : 'unpaid',
        checks, ready: checks.every((k) => k.ok),
      };
    })
    .sort((a, b) => a.surname.localeCompare(b.surname) || a.firstNames.localeCompare(b.firstNames));
}

export interface EntryList { session: SessionRow; codes: CodeRow[]; candidates: CandidateRow[]; summary: { subject: string; code: string; candidates: number }[]; totals: { candidates: number; ready: number; unpaid: number; feeTotal: number; feeCollected: number }; financeOn: boolean }

export async function entryList(user: Actor, sessionId: string): Promise<EntryList> {
  need(user, 'exams.zimsec.manage', 'exams.zimsec.approve', 'exams.zimsec.results_import', 'exams.analytics.view');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sid = user.schoolId;
    const s = await tx.boardSession.findFirst({ where: { id: sessionId, schoolId: sid }, include: { _count: { select: { candidates: true, codes: true } } } });
    if (!s) throw new ServiceError('Session not found', 404);
    const candidates = await loadRows(tx, sid, s);
    const codes = await tx.boardSubjectCode.findMany({ where: { sessionId, schoolId: sid }, include: { subject: { select: { name: true } }, _count: { select: { entries: true } } }, orderBy: { code: 'asc' } });
    const financeOn = !(await tx.schoolModule.findFirst({ where: { schoolId: sid, module: 'finance', enabled: false } }));
    return {
      session: toRow(s), financeOn,
      codes: codes.map((r) => ({ id: r.id, code: r.code, name: r.name, subjectId: r.subjectId, subject: r.subject?.name ?? null, entries: r._count.entries })),
      candidates,
      summary: codes.map((r) => ({ code: r.code, subject: r.name, candidates: r._count.entries })).filter((r) => r.candidates > 0),
      totals: {
        candidates: candidates.length, ready: candidates.filter((c) => c.ready).length, unpaid: candidates.filter((c) => !c.feePaid).length,
        feeTotal: round2(candidates.reduce((a, c) => a + c.feeTotal, 0)), feeCollected: round2(candidates.filter((c) => c.feePaid).reduce((a, c) => a + c.feeTotal, 0)),
      },
    };
  });
}

async function amend(tx: Db, user: Actor, session: { id: string; status: string }, candidateId: string | null, kind: 'CANDIDATE_ADDED' | 'CANDIDATE_REMOVED' | 'SUBJECT_ADDED' | 'SUBJECT_REMOVED' | 'DETAILS_CHANGED', detail: string) {
  if (session.status !== 'APPROVED') return;
  await tx.boardAmendment.create({ data: { schoolId: user.schoolId, sessionId: session.id, candidateId, kind, detail, madeById: user.id } });
  await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'RECORD_AMENDMENT', entityType: 'BoardSession', entityId: session.id, detail }, tx);
}

async function loadSession(tx: Db, schoolId: string, id: string) {
  const s = await tx.boardSession.findFirst({ where: { id, schoolId } });
  if (!s) throw new ServiceError('Session not found', 404);
  return s;
}

/**
 * Brings in the school's candidates: the students of Form 4 (O Level) or Upper 6 (A Level), plus any other forms chosen for early
 * entries. Their subjects default from StudentSubject, mapped to the session's codes; subjects with no code are reported.
 */
export async function pullSchoolCandidates(user: Actor, sessionId: string, raw: unknown = {}) {
  need(user, 'exams.zimsec.manage');
  const input = z.object({ extraLevelIds: z.array(idSchema).max(6).default([]), termId: idSchema.optional() }).parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sid = user.schoolId;
    const session = await loadSession(tx, sid, sessionId);
    const term = await resolveTerm(tx, sid, input.termId);
    const main = await tx.level.findFirst({ where: { schoolId: sid, order: session.category === 'O_LEVEL' ? 4 : 6 }, select: { id: true } });
    const levelIds = Array.from(new Set([...(main ? [main.id] : []), ...input.extraLevelIds]));
    if (levelIds.length === 0) throw new ServiceError(`The school has no ${session.category === 'O_LEVEL' ? 'Form 4' : 'Form 6 (Upper 6)'} yet`, 409);
    const enrol = await tx.enrollment.findMany({ where: { schoolId: sid, termId: term.id, status: 'ACTIVE', class: { levelId: { in: levelIds } }, student: { status: { in: ['ACTIVE', 'SUSPENDED'] } } }, select: { studentId: true } });
    const have = new Set((await tx.candidate.findMany({ where: { sessionId, schoolId: sid, studentId: { not: null } }, select: { studentId: true } })).map((c) => c.studentId));
    const fresh = enrol.map((e) => e.studentId).filter((id) => !have.has(id));
    const codes = await tx.boardSubjectCode.findMany({ where: { sessionId, schoolId: sid, subjectId: { not: null } } });
    const codeOf = new Map(codes.map((c) => [c.subjectId!, c.id]));
    const takes = fresh.length ? await tx.studentSubject.findMany({ where: { schoolId: sid, termId: term.id, studentId: { in: fresh } }, select: { studentId: true, subjectId: true, subject: { select: { name: true } } } }) : [];
    const unmapped = new Set<string>();
    for (const id of fresh) {
      const c = await tx.candidate.create({ data: { schoolId: sid, sessionId, studentId: id, createdById: user.id } });
      const entries = takes.filter((t) => t.studentId === id);
      const rows = entries.filter((t) => codeOf.has(t.subjectId)).map((t) => ({ schoolId: sid, candidateId: c.id, codeId: codeOf.get(t.subjectId)! }));
      for (const t of entries) if (!codeOf.has(t.subjectId)) unmapped.add(t.subject.name);
      if (rows.length) await tx.candidateEntry.createMany({ data: rows });
      await amend(tx, user, session, c.id, 'CANDIDATE_ADDED', 'Added a school candidate');
    }
    await logAudit({ schoolId: sid, actorId: user.id, action: 'SAVE_CANDIDATE', entityType: 'BoardSession', entityId: sessionId, detail: `Added ${fresh.length} school candidate(s) to ${session.session}` }, tx);
    return { added: fresh.length, alreadyThere: enrol.length - fresh.length, unmappedSubjects: Array.from(unmapped).sort() };
  });
}

export const PrivateSchema = z.object({
  fullName: z.string().trim().min(3, 'Enter the full name').max(120),
  gender: z.enum(['M', 'F']).nullish(),
  dateOfBirth: isoDateSchema,
  idNumber: z.string().trim().min(3, 'Enter the ID or birth certificate number').max(40),
  phone: z.string().trim().max(30).nullish(),
  codeIds: z.array(idSchema).max(20).default([]),
});

export async function addPrivateCandidate(user: Actor, sessionId: string, raw: unknown) {
  need(user, 'exams.zimsec.manage');
  const input = PrivateSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sid = user.schoolId;
    const session = await loadSession(tx, sid, sessionId);
    if (input.codeIds.length) {
      const ok = await tx.boardSubjectCode.count({ where: { id: { in: input.codeIds }, sessionId, schoolId: sid } });
      if (ok !== new Set(input.codeIds).size) throw new ServiceError('A subject code is not part of this session', 422);
    }
    if (await tx.candidate.findFirst({ where: { sessionId, schoolId: sid, idNumber: input.idNumber } })) throw new ServiceError('A candidate with this ID number is already entered', 409);
    const c = await tx.candidate.create({ data: { schoolId: sid, sessionId, fullName: input.fullName, gender: input.gender ?? null, dateOfBirth: toDay(input.dateOfBirth), idNumber: input.idNumber, phone: input.phone ?? null, createdById: user.id } });
    if (input.codeIds.length) await tx.candidateEntry.createMany({ data: Array.from(new Set(input.codeIds)).map((codeId) => ({ schoolId: sid, candidateId: c.id, codeId })) });
    await amend(tx, user, session, c.id, 'CANDIDATE_ADDED', `Added private candidate ${input.fullName}`);
    await logAudit({ schoolId: sid, actorId: user.id, action: 'SAVE_CANDIDATE', entityType: 'Candidate', entityId: c.id, detail: `Added private candidate ${input.fullName} to ${session.session}` }, tx);
    return { id: c.id };
  });
}

export const CandidateEditSchema = z.object({
  codeIds: z.array(idSchema).max(20).optional(),
  nameChecked: z.boolean().optional(),
  certificateName: z.string().trim().max(120).nullish(),
  feePaid: z.boolean().optional(),
  // Private candidates only
  fullName: z.string().trim().min(3).max(120).optional(),
  gender: z.enum(['M', 'F']).nullish(),
  dateOfBirth: isoDateSchema.optional(),
  idNumber: z.string().trim().min(3).max(40).optional(),
  phone: z.string().trim().max(30).nullish(),
});

/** Changes a candidate: subjects, the name check, the exact name on the certificate, the fee tick, or a private candidate's details. */
export async function updateCandidate(user: Actor, candidateId: string, raw: unknown) {
  need(user, 'exams.zimsec.manage');
  const input = CandidateEditSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sid = user.schoolId;
    const c = await tx.candidate.findFirst({ where: { id: candidateId, schoolId: sid }, include: { session: true, entries: { include: { code: true } }, student: { select: { fullName: true } } } });
    if (!c) throw new ServiceError('Candidate not found', 404);
    const who = c.student?.fullName ?? c.fullName ?? 'candidate';
    const data: Prisma.CandidateUpdateInput = {};
    if (input.nameChecked !== undefined) data.nameChecked = input.nameChecked;
    if (input.certificateName !== undefined) data.certificateName = input.certificateName || null;
    if (input.feePaid !== undefined) data.feePaidManual = input.feePaid;
    if (!c.studentId) {
      if (input.fullName !== undefined) data.fullName = input.fullName;
      if (input.gender !== undefined) data.gender = input.gender ?? null;
      if (input.dateOfBirth !== undefined) data.dateOfBirth = toDay(input.dateOfBirth);
      if (input.idNumber !== undefined) data.idNumber = input.idNumber;
      if (input.phone !== undefined) data.phone = input.phone ?? null;
    }
    if (Object.keys(data).length) await tx.candidate.update({ where: { id: candidateId }, data });
    const detailsChanged = input.certificateName !== undefined || input.fullName !== undefined || input.dateOfBirth !== undefined || input.idNumber !== undefined || input.gender !== undefined;
    if (detailsChanged) await amend(tx, user, c.session, candidateId, 'DETAILS_CHANGED', `Changed the details of ${who}`);
    if (input.codeIds) {
      const want = new Set(input.codeIds);
      const codes = await tx.boardSubjectCode.findMany({ where: { id: { in: input.codeIds }, sessionId: c.sessionId, schoolId: sid } });
      if (codes.length !== want.size) throw new ServiceError('A subject code is not part of this session', 422);
      const have = new Map(c.entries.map((e) => [e.codeId, e.code.code]));
      for (const [codeId, code] of Array.from(have)) if (!want.has(codeId)) {
        if (await tx.boardResult.findFirst({ where: { candidateId, codeId } })) throw new ServiceError(`${code} already has a result, so it cannot be removed`, 409);
        await tx.candidateEntry.deleteMany({ where: { candidateId, codeId } });
        await amend(tx, user, c.session, candidateId, 'SUBJECT_REMOVED', `Removed ${code} for ${who}`);
      }
      for (const code of codes) if (!have.has(code.id)) {
        await tx.candidateEntry.create({ data: { schoolId: sid, candidateId, codeId: code.id } });
        await amend(tx, user, c.session, candidateId, 'SUBJECT_ADDED', `Added ${code.code} for ${who}`);
      }
    }
    await logAudit({ schoolId: sid, actorId: user.id, action: 'SAVE_CANDIDATE', entityType: 'Candidate', entityId: candidateId, detail: `Changed ${who} (${c.session.session})` }, tx);
    return { id: candidateId };
  });
}

export async function removeCandidate(user: Actor, candidateId: string) {
  need(user, 'exams.zimsec.manage');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const c = await tx.candidate.findFirst({ where: { id: candidateId, schoolId: user.schoolId }, include: { session: true, student: { select: { fullName: true } } } });
    if (!c) throw new ServiceError('Candidate not found', 404);
    if (await tx.boardResult.count({ where: { candidateId } })) throw new ServiceError('This candidate has results, so they cannot be removed', 409);
    const who = c.student?.fullName ?? c.fullName ?? 'candidate';
    await tx.candidateEntry.deleteMany({ where: { candidateId } });
    await tx.candidate.delete({ where: { id: candidateId } });
    await amend(tx, user, c.session, null, 'CANDIDATE_REMOVED', `Removed ${who} from the entry list`);
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'SAVE_CANDIDATE', entityType: 'Candidate', entityId: candidateId, detail: `Removed ${who} from ${c.session.session}` }, tx);
    return { id: candidateId };
  });
}

// ─── Fees ────────────────────────────────────────────────────────────────────

/** With Finance on: adds a charge for the entry fee to each school candidate's account (once). Private candidates pay at the office. */
export async function createFeeCharges(user: Actor, sessionId: string) {
  need(user, 'exams.zimsec.manage');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sid = user.schoolId;
    const session = await loadSession(tx, sid, sessionId);
    if (await tx.schoolModule.findFirst({ where: { schoolId: sid, module: 'finance', enabled: false } })) throw new ServiceError('Finance is switched off for this school. Tick payments by hand instead.', 409);
    if (session.currency !== 'USD' && session.currency !== 'ZIG') throw new ServiceError('Unsupported currency', 422);
    const term = await tx.academicTerm.findFirst({ where: { schoolId: sid, status: 'OPEN' }, select: { id: true } });
    if (!term) throw new ServiceError('No term is open, so charges cannot be added', 409);
    const rows = await loadRows(tx, sid, session);
    const label = feeLabel(session);
    const done = new Set((await tx.charge.findMany({ where: { schoolId: sid, label, studentId: { in: rows.map((r) => r.studentId).filter((x): x is string => !!x) } }, select: { studentId: true } })).map((c) => c.studentId));
    let created = 0;
    for (const r of rows) {
      if (!r.studentId || done.has(r.studentId) || r.feeTotal <= 0) continue;
      await tx.charge.create({ data: { schoolId: sid, studentId: r.studentId, termId: term.id, label, currency: session.currency, amount: r.feeTotal } });
      created++;
    }
    await logAudit({ schoolId: sid, actorId: user.id, action: 'CREATE_EXAM_FEES', entityType: 'BoardSession', entityId: sessionId, detail: `Added ${created} exam fee charge(s) for ${session.session}` }, tx);
    return { created, skipped: rows.filter((r) => r.studentId && done.has(r.studentId)).length, privateCandidates: rows.filter((r) => !r.studentId).length };
  });
}

// ─── Approval and export ─────────────────────────────────────────────────────

/** The Head approves the entry list. Unpaid candidates are flagged, not removed, so the Head decides; after this, changes are logged as amendments. */
export async function approveEntryList(user: Actor, sessionId: string) {
  need(user, 'exams.zimsec.approve');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sid = user.schoolId;
    const session = await loadSession(tx, sid, sessionId);
    if (session.status === 'APPROVED') throw new ServiceError('The entry list is already approved', 409);
    const rows = await loadRows(tx, sid, session);
    if (rows.length === 0) throw new ServiceError('There are no candidates to approve', 409);
    const noSubjects = rows.filter((r) => r.subjects.length === 0);
    if (noSubjects.length) throw new ServiceError(`${noSubjects.length} candidate(s) have no subjects: ${noSubjects.slice(0, 3).map((r) => r.name).join(', ')}`, 409);
    await tx.boardSession.update({ where: { id: sessionId }, data: { status: 'APPROVED', approvedById: user.id, approvedAt: new Date() } });
    const unpaid = rows.filter((r) => !r.feePaid).length;
    const incomplete = rows.filter((r) => !r.ready).length;
    await logAudit({ schoolId: sid, actorId: user.id, action: 'APPROVE_ENTRY_LIST', entityType: 'BoardSession', entityId: sessionId, detail: `Approved the ${session.board} ${session.session} entry list: ${rows.length} candidate(s), ${unpaid} unpaid, ${incomplete} with checks outstanding` }, tx);
    const officers = await tx.user.findMany({ where: { schoolId: sid, active: true, userRoles: { some: { role: { permissions: { some: { permissionKey: 'exams.zimsec.manage' } } } } } }, select: { id: true } });
    await notifyUsers(tx, sid, officers.map((o) => o.id).filter((id) => id !== user.id), { type: 'ENTRY_LIST_APPROVED', title: `${session.board} ${session.session} entry list approved`, body: 'You can export it now.', link: `/exams/board/${sessionId}`, dedupeKey: `entry-approved:${sessionId}` });
    return { candidates: rows.length, unpaid, incomplete };
  });
}

/** Builds the export in the session's column order. Only an approved list is exported. */
export async function exportEntryList(user: Actor, sessionId: string): Promise<{ fileName: string; headers: string[]; rows: (string | number)[][] }> {
  need(user, 'exams.zimsec.manage', 'exams.zimsec.approve');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sid = user.schoolId;
    const session = await loadSession(tx, sid, sessionId);
    if (session.status !== 'APPROVED') throw new ServiceError('The Head must approve the entry list before it is exported', 409);
    const rows = await loadRows(tx, sid, session);
    const columns = (session.exportColumns.length ? session.exportColumns : DEFAULT_EXPORT_COLUMNS) as ExportColumn[];
    const splitCount = Math.max(1, ...rows.map((r) => r.subjects.length));
    const per = session.exportLayout === 'ENTRY';
    const value = (c: CandidateRow, col: ExportColumn): (string | number)[] => {
      switch (col) {
        case 'centre': return [session.centreNumber];
        case 'candidateNumber': return [c.candidateNumber ?? ''];
        case 'surname': return [c.surname.toUpperCase()];
        case 'firstNames': return [c.firstNames];
        case 'fullName': return [c.name];
        case 'gender': return [c.gender ?? ''];
        case 'dateOfBirth': return [c.dateOfBirth ?? ''];
        case 'idNumber': return [c.idNumber ?? ''];
        case 'phone': return [c.phone ?? ''];
        case 'admissionNumber': return [c.admissionNumber ?? ''];
        case 'className': return [c.className ?? ''];
        case 'subjectsJoined': return [c.subjects.map((s) => s.code).join(',')];
        case 'subjectsSplit': return Array.from({ length: splitCount }, (_, i) => c.subjects[i]?.code ?? '');
        case 'subjectCount': return [c.subjects.length];
        case 'feeTotal': return [c.feeTotal.toFixed(2)];
        case 'feeStatus': return [c.feePaid ? 'Paid' : 'Unpaid'];
        default: return [''];
      }
    };
    const head = (col: ExportColumn) => (col === 'subjectsSplit' ? Array.from({ length: splitCount }, (_, i) => `Subject ${i + 1}`) : [EXPORT_COLUMNS[col]]);
    let headers: string[];
    let out: (string | number)[][];
    if (per) {
      const cols = columns.filter((c) => c !== 'subjectsSplit' && c !== 'subjectsJoined' && c !== 'subjectCode' && c !== 'subjectName');
      headers = [...cols.flatMap(head), 'Subject code', 'Subject name'];
      out = rows.flatMap((c) => c.subjects.map((s) => [...cols.flatMap((col) => value(c, col)), s.code, s.name]));
    } else {
      const cols = columns.filter((c) => c !== 'subjectCode' && c !== 'subjectName');
      headers = cols.flatMap(head);
      out = rows.map((c) => cols.flatMap((col) => value(c, col)));
    }
    await logAudit({ schoolId: sid, actorId: user.id, action: 'EXPORT_ENTRY_LIST', entityType: 'BoardSession', entityId: sessionId, detail: `Exported the ${session.board} ${session.session} entry list (${rows.length} candidates)` }, tx);
    return { fileName: `${session.board} ${session.session} entry list`.replace(/[^A-Za-z0-9 _-]/g, '-'), headers, rows: out };
  });
}

export const exportCsv = (e: { headers: string[]; rows: (string | number)[][] }) => toCsv(e.headers, e.rows);

// ─── Candidate numbers ───────────────────────────────────────────────────────

const NumbersSchema = z.object({
  rows: z.array(z.object({ identifier: z.string().trim().min(1).max(60), candidateNumber: z.string().trim().min(1).max(30) })).min(1).max(1500),
  apply: z.boolean().default(false),
});

export interface NumberReview { line: number; identifier: string; candidateNumber: string; candidate: string | null; status: 'OK' | 'ERROR'; message: string | null }

/**
 * Candidate numbers, once the board issues them: typed in or loaded from a file of (admission number or ID number, candidate number).
 * Without `apply` it only checks. A number can belong to one candidate in a session.
 */
export async function importCandidateNumbers(user: Actor, sessionId: string, raw: unknown): Promise<{ review: NumberReview[]; applied: number }> {
  need(user, 'exams.zimsec.manage');
  const input = NumbersSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sid = user.schoolId;
    const session = await loadSession(tx, sid, sessionId);
    const rows = await loadRows(tx, sid, session);
    const key = (s: string) => s.trim().toUpperCase();
    const byIdent = new Map<string, CandidateRow>();
    for (const r of rows) { if (r.admissionNumber) byIdent.set(key(r.admissionNumber), r); if (r.idNumber) byIdent.set(key(r.idNumber), r); }
    const taken = new Map(rows.filter((r) => r.candidateNumber).map((r) => [r.candidateNumber!, r.id]));
    const seen = new Set<string>();
    const review: NumberReview[] = input.rows.map((x, i) => {
      const c = byIdent.get(key(x.identifier));
      const fail = (message: string): NumberReview => ({ line: i + 2, identifier: x.identifier, candidateNumber: x.candidateNumber, candidate: c?.name ?? null, status: 'ERROR', message });
      if (!c) return fail('No candidate has this admission number or ID number');
      if (seen.has(c.id)) return fail('This candidate appears twice in the file');
      seen.add(c.id);
      const owner = taken.get(x.candidateNumber);
      if (owner && owner !== c.id) return fail('This candidate number belongs to another candidate');
      if (input.rows.some((y, j) => j !== i && y.candidateNumber === x.candidateNumber && byIdent.get(key(y.identifier))?.id !== c.id)) return fail('This candidate number appears for two candidates in the file');
      return { line: i + 2, identifier: x.identifier, candidateNumber: x.candidateNumber, candidate: c.name, status: 'OK', message: null };
    });
    let applied = 0;
    if (input.apply) {
      const bad = review.filter((r) => r.status === 'ERROR');
      if (bad.length) throw new ServiceError(`${bad.length} row(s) have errors. Fix them first.`, 409);
      // Clear first so numbers can swap between candidates without a clash.
      const ids = review.map((r) => byIdent.get(key(r.identifier))!.id);
      await tx.candidate.updateMany({ where: { id: { in: ids } }, data: { candidateNumber: null } });
      for (const r of review) { await tx.candidate.update({ where: { id: byIdent.get(key(r.identifier))!.id }, data: { candidateNumber: r.candidateNumber } }); applied++; }
      await logAudit({ schoolId: sid, actorId: user.id, action: 'IMPORT_CANDIDATE_NUMBERS', entityType: 'BoardSession', entityId: sessionId, detail: `Set ${applied} candidate number(s) for ${session.session}` }, tx);
    }
    return { review, applied };
  });
}

// ─── Results ─────────────────────────────────────────────────────────────────

const ResultsSchema = z.object({
  rows: z.array(z.object({ candidateNumber: z.string().trim().min(1).max(30), subjectCode: z.string().trim().min(1).max(20), grade: z.string().trim().min(1).max(4) })).min(1).max(20_000),
  apply: z.boolean().default(false),
});

export interface ResultReview { line: number; candidateNumber: string; subjectCode: string; grade: string; candidate: string | null; status: 'OK' | 'ERROR'; message: string | null }

/** Released results: candidate number, subject code, grade. Without `apply` it only checks. Results attach to the student's record and the alumni record. */
export async function importResults(user: Actor, sessionId: string, raw: unknown): Promise<{ review: ResultReview[]; applied: number; updated: number }> {
  need(user, 'exams.zimsec.results_import');
  const input = ResultsSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sid = user.schoolId;
    const session = await loadSession(tx, sid, sessionId);
    const cands = await tx.candidate.findMany({ where: { sessionId, schoolId: sid, candidateNumber: { not: null } }, include: { student: { select: { fullName: true } } } });
    const byNumber = new Map(cands.map((c) => [c.candidateNumber!.toUpperCase(), c]));
    const codes = await tx.boardSubjectCode.findMany({ where: { sessionId, schoolId: sid } });
    const byCode = new Map(codes.map((c) => [c.code.toUpperCase(), c]));
    const seen = new Set<string>();
    const review: ResultReview[] = input.rows.map((x, i) => {
      const c = byNumber.get(x.candidateNumber.toUpperCase());
      const code = byCode.get(x.subjectCode.toUpperCase());
      const grade = x.grade.toUpperCase();
      const name = c ? c.student?.fullName ?? c.fullName ?? null : null;
      const fail = (message: string): ResultReview => ({ line: i + 2, candidateNumber: x.candidateNumber, subjectCode: x.subjectCode, grade, candidate: name, status: 'ERROR', message });
      if (!c) return fail('No candidate has this candidate number');
      if (!code) return fail('This subject code is not part of the session');
      if (!GRADE.test(grade) && grade !== 'U' && grade !== 'X') return fail('A grade is a letter, like A or C (or U, X)');
      const k = `${c.id}|${code.id}`;
      if (seen.has(k)) return fail('This candidate and subject appear twice in the file');
      seen.add(k);
      return { line: i + 2, candidateNumber: x.candidateNumber, subjectCode: x.subjectCode, grade, candidate: name, status: 'OK', message: null };
    });
    let applied = 0;
    let updated = 0;
    if (input.apply) {
      const bad = review.filter((r) => r.status === 'ERROR');
      if (bad.length) throw new ServiceError(`${bad.length} row(s) have errors. Fix them first.`, 409);
      for (const r of review) {
        const c = byNumber.get(r.candidateNumber.toUpperCase())!;
        const code = byCode.get(r.subjectCode.toUpperCase())!;
        const old = await tx.boardResult.findUnique({ where: { sessionId_candidateNumber_codeId: { sessionId, candidateNumber: c.candidateNumber!, codeId: code.id } } });
        if (old) { if (old.grade !== r.grade) { await tx.boardResult.update({ where: { id: old.id }, data: { grade: r.grade } }); updated++; } continue; }
        await tx.boardResult.create({ data: { schoolId: sid, sessionId, candidateId: c.id, studentId: c.studentId, candidateNumber: c.candidateNumber!, codeId: code.id, grade: r.grade } });
        applied++;
      }
      await logAudit({ schoolId: sid, actorId: user.id, action: 'IMPORT_BOARD_RESULTS', entityType: 'BoardSession', entityId: sessionId, detail: `Loaded ${applied} new and ${updated} changed result(s) for ${session.session}` }, tx);
    }
    return { review, applied, updated };
  }, { timeout: 60_000 });
}

/** Released grades of a student, for their profile and alumni record. */
export async function boardResultsFor(user: Actor, studentId: string) {
  need(user, 'exams.results.view', 'exams.zimsec.manage', 'exams.zimsec.results_import', 'exams.analytics.view');
  const rows = await getScopedDb(user.schoolId, user.id).boardResult.findMany({
    where: { schoolId: user.schoolId, studentId }, include: { code: { select: { code: true, name: true } }, session: { select: { board: true, session: true, category: true } } }, orderBy: [{ session: { createdAt: 'desc' } }, { code: { code: 'asc' } }],
  });
  const groups = new Map<string, { board: string; session: string; category: string; results: { code: string; subject: string; grade: string }[] }>();
  for (const r of rows) {
    const g = groups.get(r.sessionId) ?? groups.set(r.sessionId, { board: r.session.board, session: r.session.session, category: r.session.category, results: [] }).get(r.sessionId)!;
    g.results.push({ code: r.code.code, subject: r.code.name, grade: r.grade });
  }
  return Array.from(groups.values());
}

