// The exam timetable. The Exams Officer schedules each exam period's papers so that no student sits two papers at once; the Deputy
// approves it; it then shows on the Calendar and prints per level and per student.
//
//  • An exam period names its dates, the levels that sit it and the kind of assessment it feeds (End-of-term exam, Mock exam). Each
//    paper makes the common assessment its marks land in, so marks entered later go to the right place.
//  • Clash rules (lib/exams/clashes.ts): a student cannot sit two papers in one session and a room cannot hold two papers at once or
//    more candidates than its exam capacity (blocked); more than 2 papers in a day or 3 hours back to back are warnings.
//  • Normal timetable lessons are suspended for those levels on those days (shown on the Academics timetable).
import { z } from 'zod';
import type { ExamSession, Prisma } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { notifyUsers } from '@/lib/system/notifications';
import { deputyIds, peopleWith } from '@/lib/academics/common';
import { round2 } from '@/lib/results';
import { allocateSeats, endTime, findClashes, type Clash, type ClashPaper } from '@/lib/exams/clashes';
import { ensureDefaultTypes, holds, idSchema, isFull, isoDateSchema, num, toDay, type Actor } from '@/lib/exams/common';

const need = (user: Actor, ...keys: Parameters<typeof holds>[1][]) => {
  if (!keys.some((k) => holds(user, k))) throw new ServiceError('Forbidden', 403);
};

const dayText = (d: Date) => d.toISOString().slice(0, 10);
const hm = z.string().trim().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Enter a time as HH:MM');

// ─── Periods ─────────────────────────────────────────────────────────────────

export const PeriodSchema = z.object({
  termId: idSchema,
  name: z.string().trim().min(2, 'Name the exam period').max(120),
  startDate: isoDateSchema,
  endDate: isoDateSchema,
  typeId: idSchema,
  levelIds: z.array(idSchema).min(1, 'Choose at least one form').max(8),
}).refine((p) => p.endDate >= p.startDate, { path: ['endDate'], message: 'The end date cannot be before the start date' });

export interface PeriodRow {
  id: string; name: string; termId: string; startDate: string; endDate: string; status: 'DRAFT' | 'PENDING' | 'APPROVED';
  typeName: string; levels: { id: string; name: string }[]; papers: number;
}

export async function listPeriods(user: Actor, termId?: string): Promise<PeriodRow[]> {
  if (!isFull(user) && !holds(user, 'exams.timetable.manage') && !holds(user, 'exams.timetable.approve') && !holds(user, 'exams.invigilation.manage') && !holds(user, 'exams.marks.enter')) throw new ServiceError('Forbidden', 403);
  const seeAll = isFull(user) || holds(user, 'exams.timetable.manage') || holds(user, 'exams.timetable.approve') || holds(user, 'exams.invigilation.manage');
  const rows = await getScopedDb(user.schoolId, user.id).examPeriod.findMany({
    where: { schoolId: user.schoolId, ...(termId ? { termId } : {}), ...(seeAll ? {} : { status: 'APPROVED' }) },
    include: { type: { select: { name: true } }, levels: { include: { level: { select: { id: true, name: true, order: true } } } }, _count: { select: { papers: true } } },
    orderBy: [{ startDate: 'desc' }],
  });
  return rows.map((p) => ({
    id: p.id, name: p.name, termId: p.termId, startDate: dayText(p.startDate), endDate: dayText(p.endDate), status: p.status, typeName: p.type.name,
    levels: p.levels.map((l) => l.level).sort((a, b) => a.order - b.order).map((l) => ({ id: l.id, name: l.name })), papers: p._count.papers,
  }));
}

async function loadPeriod(tx: Db, schoolId: string, id: string) {
  const p = await tx.examPeriod.findFirst({ where: { id, schoolId }, include: { levels: true, term: { select: { name: true, status: true } } } });
  if (!p) throw new ServiceError('Exam period not found', 404);
  return p;
}

const assertEditable = (p: { status: string; term: { name: string; status: string } }) => {
  if (p.term.status === 'CLOSED') throw new ServiceError(`${p.term.name} is closed`, 409);
  if (p.status === 'APPROVED') throw new ServiceError('This timetable is approved. Ask the Deputy to reopen it before changing it.', 409);
  if (p.status === 'PENDING') throw new ServiceError('This timetable is waiting for the Deputy. Ask them to return it before changing it.', 409);
};

export async function savePeriod(user: Actor, raw: unknown, id?: string) {
  need(user, 'exams.timetable.manage');
  const input = PeriodSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sid = user.schoolId;
    const term = await tx.academicTerm.findFirst({ where: { id: input.termId, schoolId: sid } });
    if (!term) throw new ServiceError('Term not found', 404);
    if (term.status === 'CLOSED') throw new ServiceError(`${term.name} is closed`, 409);
    await ensureDefaultTypes(tx, sid);
    if (!(await tx.assessmentType.findFirst({ where: { id: input.typeId, schoolId: sid, isProject: false } }))) throw new ServiceError('Assessment type not found', 404);
    const levels = await tx.level.findMany({ where: { id: { in: input.levelIds }, schoolId: sid }, select: { id: true } });
    if (levels.length !== new Set(input.levelIds).size) throw new ServiceError('Form not found', 404);
    let periodId = id;
    if (id) {
      const p = await loadPeriod(tx, sid, id);
      assertEditable(p);
      const outside = await tx.examPaper.count({ where: { periodId: id, OR: [{ date: { lt: toDay(input.startDate) } }, { date: { gt: toDay(input.endDate) } }, { levelId: { notIn: input.levelIds } }] } });
      if (outside) throw new ServiceError(`${outside} paper(s) are outside these dates or forms. Move or remove them first.`, 409);
      await tx.examPeriod.update({ where: { id }, data: { name: input.name, startDate: toDay(input.startDate), endDate: toDay(input.endDate), typeId: input.typeId } });
      await tx.examPeriodLevel.deleteMany({ where: { periodId: id, levelId: { notIn: input.levelIds } } });
    } else {
      periodId = (await tx.examPeriod.create({ data: { schoolId: sid, termId: term.id, name: input.name, startDate: toDay(input.startDate), endDate: toDay(input.endDate), typeId: input.typeId, createdById: user.id } })).id;
    }
    const have = new Set((await tx.examPeriodLevel.findMany({ where: { periodId: periodId! }, select: { levelId: true } })).map((l) => l.levelId));
    const add = Array.from(new Set(input.levelIds)).filter((l) => !have.has(l));
    if (add.length) await tx.examPeriodLevel.createMany({ data: add.map((levelId) => ({ schoolId: sid, periodId: periodId!, levelId })) });
    await logAudit({ schoolId: sid, actorId: user.id, action: 'SAVE_EXAM_PERIOD', entityType: 'ExamPeriod', entityId: periodId!, detail: `${id ? 'Changed' : 'Created'} exam period ${input.name} (${input.startDate} to ${input.endDate})` }, tx);
    return { id: periodId! };
  });
}

export async function deletePeriod(user: Actor, id: string) {
  need(user, 'exams.timetable.manage');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const p = await loadPeriod(tx, user.schoolId, id);
    assertEditable(p);
    if (await tx.examPaper.count({ where: { periodId: id } })) throw new ServiceError('Remove the papers of this period first', 409);
    await tx.examPeriodLevel.deleteMany({ where: { periodId: id } });
    await tx.examPeriod.delete({ where: { id } });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'SAVE_EXAM_PERIOD', entityType: 'ExamPeriod', entityId: id, detail: `Removed exam period ${p.name}` }, tx);
    return { id };
  });
}

// ─── Who sits a paper ────────────────────────────────────────────────────────

export interface Candidate { id: string; admissionNumber: string; name: string; classId: string | null; className: string | null; candidateNumber: string | null }

/** The students of the paper's level who take its subject this term, by candidate number when issued, else admission number. */
export async function candidatesOf(tx: Db, schoolId: string, paper: { subjectId: string; levelId: string }, termId: string): Promise<Candidate[]> {
  const takers = await tx.studentSubject.findMany({ where: { schoolId, termId, subjectId: paper.subjectId }, select: { studentId: true } });
  if (takers.length === 0) return [];
  const enrol = await tx.enrollment.findMany({
    where: { schoolId, termId, status: 'ACTIVE', studentId: { in: takers.map((t) => t.studentId) }, class: { levelId: paper.levelId } },
    select: { classId: true, class: { select: { name: true } }, student: { select: { id: true, admissionNumber: true, firstName: true, surname: true } } },
  });
  const numbers = enrol.length
    ? await tx.candidate.findMany({ where: { schoolId, studentId: { in: enrol.map((e) => e.student.id) }, candidateNumber: { not: null } }, select: { studentId: true, candidateNumber: true }, orderBy: { createdAt: 'desc' } })
    : [];
  const numberOf = new Map<string, string>();
  for (const n of numbers) if (n.studentId && !numberOf.has(n.studentId)) numberOf.set(n.studentId, n.candidateNumber!);
  return enrol
    .map((e) => ({ id: e.student.id, admissionNumber: e.student.admissionNumber, name: `${e.student.surname.toUpperCase()}, ${e.student.firstName}`, classId: e.classId, className: e.class.name, candidateNumber: numberOf.get(e.student.id) ?? null }))
    .sort((a, b) => (a.candidateNumber && b.candidateNumber ? a.candidateNumber.localeCompare(b.candidateNumber, 'en', { numeric: true }) : a.admissionNumber.localeCompare(b.admissionNumber, 'en', { numeric: true })));
}

const paperInclude = {
  subject: { select: { name: true } }, level: { select: { name: true } },
  rooms: { include: { room: { select: { name: true } } }, orderBy: { createdAt: 'asc' as const } },
  assessment: { select: { id: true } },
} satisfies Prisma.ExamPaperInclude;
type PaperRow = Prisma.ExamPaperGetPayload<{ include: typeof paperInclude }>;

const toClashPaper = (p: PaperRow): ClashPaper => ({
  id: p.id, name: p.name, subjectId: p.subjectId, levelId: p.levelId, date: dayText(p.date), session: p.session, startTime: p.startTime, durationMinutes: p.durationMinutes,
  rooms: p.rooms.map((r) => ({ roomId: r.roomId, roomName: r.room.name, examCapacity: r.examCapacity })),
});

/** Clashes for the whole period: blocked ones stop it being submitted or approved. */
export async function clashesOf(tx: Db, schoolId: string, periodId: string): Promise<{ clashes: Clash[]; candidates: Map<string, number> }> {
  const period = await tx.examPeriod.findFirstOrThrow({ where: { id: periodId, schoolId }, select: { termId: true } });
  const papers = await tx.examPaper.findMany({ where: { periodId, schoolId }, include: paperInclude });
  const sitting = new Map<string, string[]>();
  const names = new Map<string, string>();
  for (const p of papers) {
    const c = await candidatesOf(tx, schoolId, p, period.termId);
    sitting.set(p.id, c.map((x) => x.id));
    for (const x of c) names.set(x.id, x.name);
  }
  return { clashes: findClashes(papers.map(toClashPaper), sitting, names), candidates: new Map(Array.from(sitting, ([k, v]) => [k, v.length])) };
}

// ─── Papers ──────────────────────────────────────────────────────────────────

export const PaperSchema = z.object({
  periodId: idSchema,
  subjectId: idSchema,
  levelId: idSchema,
  paperNumber: z.number().int().min(1).max(9).default(1),
  name: z.string().trim().min(2, 'Name the paper').max(120),
  durationMinutes: z.number().int().min(10, 'A paper lasts at least 10 minutes').max(480),
  date: isoDateSchema,
  session: z.enum(['MORNING', 'AFTERNOON']),
  startTime: hm,
  maxMark: z.number().gt(0).max(1000).refine((n) => round2(n) === n, 'Use at most two decimal places'),
});

export interface PaperView {
  id: string; periodId: string; subjectId: string; subject: string; levelId: string; level: string; paperNumber: number; name: string; durationMinutes: number;
  date: string; session: ExamSession; startTime: string; endTime: string; maxMark: number; candidates: number; hasMarks: boolean;
  rooms: { roomId: string; room: string; examCapacity: number }[]; assessmentId: string | null;
}

export interface PeriodDetail {
  period: PeriodRow & { termName: string; submittedAt: string | null; approvedAt: string | null };
  papers: PaperView[];
  clashes: Clash[];
  canSubmit: boolean;
}

export async function getPeriod(user: Actor, id: string): Promise<PeriodDetail> {
  if (!isFull(user) && !holds(user, 'exams.timetable.manage') && !holds(user, 'exams.timetable.approve') && !holds(user, 'exams.invigilation.manage') && !holds(user, 'exams.marks.enter')) throw new ServiceError('Forbidden', 403);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const p = await tx.examPeriod.findFirst({
      where: { id, schoolId: user.schoolId },
      include: { type: { select: { name: true } }, term: { select: { name: true } }, levels: { include: { level: { select: { id: true, name: true, order: true } } } } },
    });
    if (!p) throw new ServiceError('Exam period not found', 404);
    const staff = isFull(user) || holds(user, 'exams.timetable.manage') || holds(user, 'exams.timetable.approve') || holds(user, 'exams.invigilation.manage');
    if (!staff && p.status !== 'APPROVED') throw new ServiceError('Exam period not found', 404);
    const papers = await tx.examPaper.findMany({ where: { periodId: id, schoolId: user.schoolId }, include: paperInclude, orderBy: [{ date: 'asc' }, { session: 'asc' }, { startTime: 'asc' }, { name: 'asc' }] });
    const { clashes, candidates } = await clashesOf(tx, user.schoolId, id);
    const withMarks = papers.length
      ? await tx.assessmentMark.groupBy({ by: ['assessmentId'], where: { schoolId: user.schoolId, assessment: { examPaperId: { in: papers.map((x) => x.id) } }, OR: [{ value: { not: null } }, { code: { not: null } }] } })
      : [];
    const marked = new Set(withMarks.map((m) => m.assessmentId));
    return {
      period: {
        id: p.id, name: p.name, termId: p.termId, termName: p.term.name, startDate: dayText(p.startDate), endDate: dayText(p.endDate), status: p.status, typeName: p.type.name, papers: papers.length,
        levels: p.levels.map((l) => l.level).sort((a, b) => a.order - b.order).map((l) => ({ id: l.id, name: l.name })),
        submittedAt: p.submittedAt?.toISOString() ?? null, approvedAt: p.approvedAt?.toISOString() ?? null,
      },
      papers: papers.map((x) => ({
        id: x.id, periodId: x.periodId, subjectId: x.subjectId, subject: x.subject.name, levelId: x.levelId, level: x.level.name, paperNumber: x.paperNumber, name: x.name, durationMinutes: x.durationMinutes,
        date: dayText(x.date), session: x.session, startTime: x.startTime, endTime: endTime(x), maxMark: num(x.maxMark)!, candidates: candidates.get(x.id) ?? 0, hasMarks: !!x.assessment && marked.has(x.assessment.id),
        rooms: x.rooms.map((r) => ({ roomId: r.roomId, room: r.room.name, examCapacity: r.examCapacity })), assessmentId: x.assessment?.id ?? null,
      })),
      clashes,
      canSubmit: papers.length > 0 && !clashes.some((c) => c.severity === 'block'),
    };
  });
}

const blockedMessage = (clashes: Clash[]) => clashes.filter((c) => c.severity === 'block').map((c) => c.message).join('; ');

/**
 * Adds or changes a paper. Clashes that put one student in two papers of a session, or one room in two papers, refuse the change; the
 * paper's common assessment (where its marks land) is made with it and follows its title, date and maximum mark.
 */
export async function savePaper(user: Actor, raw: unknown, id?: string) {
  need(user, 'exams.timetable.manage');
  const input = PaperSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sid = user.schoolId;
    const period = await tx.examPeriod.findFirst({ where: { id: input.periodId, schoolId: sid }, include: { levels: true, term: { select: { name: true, status: true } }, type: true } });
    if (!period) throw new ServiceError('Exam period not found', 404);
    assertEditable(period);
    if (!period.levels.some((l) => l.levelId === input.levelId)) throw new ServiceError('This form does not sit this exam period', 422);
    if (input.date < dayText(period.startDate) || input.date > dayText(period.endDate)) throw new ServiceError(`A paper must be set inside the exam period (${dayText(period.startDate)} to ${dayText(period.endDate)})`, 422);
    const offered = await tx.subjectLevel.findFirst({ where: { schoolId: sid, subjectId: input.subjectId, levelId: input.levelId }, select: { id: true } })
      ?? await tx.teacherAssignment.findFirst({ where: { schoolId: sid, termId: period.termId, subjectId: input.subjectId, OR: [{ class: { levelId: input.levelId } }, { group: { levelId: input.levelId } }] }, select: { id: true } });
    if (!offered) throw new ServiceError('This subject is not offered at this form', 422);
    if (input.session === 'MORNING' ? input.startTime >= '12:00' : input.startTime < '12:00') throw new ServiceError(`A ${input.session.toLowerCase()} paper starts ${input.session === 'MORNING' ? 'before' : 'at or after'} 12:00`, 422);

    let paperId = id;
    if (id) {
      const old = await tx.examPaper.findFirst({ where: { id, periodId: period.id, schoolId: sid }, include: { assessment: { select: { id: true } } } });
      if (!old) throw new ServiceError('Paper not found', 404);
      if (old.assessment && (old.subjectId !== input.subjectId || old.levelId !== input.levelId)) {
        if (await tx.assessmentMark.count({ where: { assessmentId: old.assessment.id, OR: [{ value: { not: null } }, { code: { not: null } }] } })) throw new ServiceError('Marks have been entered for this paper, so its subject and form cannot change', 409);
      }
      if (old.assessment && num(old.maxMark) !== input.maxMark && (await tx.assessmentMark.count({ where: { assessmentId: old.assessment.id, OR: [{ value: { not: null } }, { code: { not: null } }] } }))) {
        throw new ServiceError('Marks have been entered for this paper, so its maximum mark cannot change. Copy the assessment instead.', 409);
      }
      await tx.examPaper.update({ where: { id }, data: { subjectId: input.subjectId, levelId: input.levelId, paperNumber: input.paperNumber, name: input.name, durationMinutes: input.durationMinutes, date: toDay(input.date), session: input.session, startTime: input.startTime, maxMark: input.maxMark } });
    } else {
      if (await tx.examPaper.findFirst({ where: { periodId: period.id, subjectId: input.subjectId, levelId: input.levelId, paperNumber: input.paperNumber } })) throw new ServiceError('This subject already has a paper with that number in this period', 409);
      paperId = (await tx.examPaper.create({ data: { schoolId: sid, periodId: period.id, subjectId: input.subjectId, levelId: input.levelId, paperNumber: input.paperNumber, name: input.name, durationMinutes: input.durationMinutes, date: toDay(input.date), session: input.session, startTime: input.startTime, maxMark: input.maxMark } })).id;
    }

    // The assessment the paper's marks land in.
    const existing = await tx.assessment.findFirst({ where: { examPaperId: paperId!, schoolId: sid } });
    if (existing) {
      await tx.assessment.update({ where: { id: existing.id }, data: { title: input.name, date: toDay(input.date), subjectId: input.subjectId, levelId: input.levelId, ...(num(existing.maxMark) !== input.maxMark ? { maxMark: input.maxMark } : {}) } });
    } else {
      await tx.assessment.create({ data: { schoolId: sid, termId: period.termId, levelId: input.levelId, subjectId: input.subjectId, typeId: period.typeId, title: input.name, date: toDay(input.date), maxMark: input.maxMark, countsToTerm: true, examPaperId: paperId!, createdById: user.id } });
    }

    const { clashes } = await clashesOf(tx, sid, period.id);
    // Only clashes that this paper is part of, and that cannot be fixed by adding rooms later, refuse the change.
    const mine = clashes.filter((c) => c.severity === 'block' && c.paperIds.includes(paperId!) && (c.kind === 'STUDENT_SAME_SESSION' || c.kind === 'ROOM_DOUBLE_BOOKED'));
    if (mine.length) throw new ServiceError(`This would clash: ${blockedMessage(mine)}`, 409);
    await logAudit({ schoolId: sid, actorId: user.id, action: 'SAVE_EXAM_PAPER', entityType: 'ExamPaper', entityId: paperId!, detail: `${id ? 'Changed' : 'Added'} ${input.name} on ${input.date}, ${input.session.toLowerCase()} ${input.startTime}, ${input.durationMinutes} minutes, out of ${input.maxMark}` }, tx);
    return { id: paperId!, warnings: clashes.filter((c) => c.severity === 'warn' && c.paperIds.includes(paperId!)).map((c) => c.message) };
  });
}

export async function deletePaper(user: Actor, id: string) {
  need(user, 'exams.timetable.manage');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const paper = await tx.examPaper.findFirst({ where: { id, schoolId: user.schoolId }, include: { period: { include: { term: { select: { name: true, status: true } } } }, assessment: { select: { id: true } } } });
    if (!paper) throw new ServiceError('Paper not found', 404);
    assertEditable(paper.period);
    if (paper.assessment) {
      if (await tx.assessmentMark.count({ where: { assessmentId: paper.assessment.id } })) throw new ServiceError('Marks have been entered for this paper, so it cannot be removed. Marks are never deleted.', 409);
      await tx.assessment.delete({ where: { id: paper.assessment.id } });
    }
    await tx.examPaperRoom.deleteMany({ where: { paperId: id } });
    await tx.invigilation.deleteMany({ where: { paperId: id } });
    await tx.examPaper.delete({ where: { id } });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'SAVE_EXAM_PAPER', entityType: 'ExamPaper', entityId: id, detail: `Removed ${paper.name}` }, tx);
    return { id };
  });
}

const RoomsSchema = z.object({ rooms: z.array(z.object({ roomId: idSchema, examCapacity: z.number().int().min(1).max(500).optional() })).max(12) });

/** The rooms a paper is written in, in the order candidates fill them. The exam capacity defaults to half the classroom capacity, rounded up. */
export async function setPaperRooms(user: Actor, paperId: string, raw: unknown) {
  need(user, 'exams.timetable.manage');
  const input = RoomsSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sid = user.schoolId;
    const paper = await tx.examPaper.findFirst({ where: { id: paperId, schoolId: sid }, include: { period: { include: { term: { select: { name: true, status: true } } } } } });
    if (!paper) throw new ServiceError('Paper not found', 404);
    assertEditable(paper.period);
    const ids = input.rooms.map((r) => r.roomId);
    if (new Set(ids).size !== ids.length) throw new ServiceError('A room can only be listed once', 422);
    const rooms = await tx.room.findMany({ where: { id: { in: ids }, schoolId: sid, active: true } });
    if (rooms.length !== ids.length) throw new ServiceError('Room not found', 404);
    const byId = new Map(rooms.map((r) => [r.id, r]));
    await tx.examPaperRoom.deleteMany({ where: { paperId } });
    for (const r of input.rooms) {
      await tx.examPaperRoom.create({ data: { schoolId: sid, paperId, roomId: r.roomId, examCapacity: r.examCapacity ?? Math.max(1, Math.ceil(byId.get(r.roomId)!.capacity / 2)) } });
    }
    const { clashes } = await clashesOf(tx, sid, paper.periodId);
    const dbl = clashes.filter((c) => c.kind === 'ROOM_DOUBLE_BOOKED' && c.paperIds.includes(paperId));
    if (dbl.length) throw new ServiceError(`This would clash: ${blockedMessage(dbl)}`, 409);
    await logAudit({ schoolId: sid, actorId: user.id, action: 'SAVE_EXAM_PAPER', entityType: 'ExamPaper', entityId: paperId, detail: `Rooms for ${paper.name}: ${rooms.map((r) => r.name).join(', ') || 'none'}` }, tx);
    return { paperId, clashes: clashes.filter((c) => c.paperIds.includes(paperId)) };
  });
}

// ─── Approval ────────────────────────────────────────────────────────────────

export async function submitPeriod(user: Actor, id: string) {
  need(user, 'exams.timetable.manage');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sid = user.schoolId;
    const p = await loadPeriod(tx, sid, id);
    if (p.term.status === 'CLOSED') throw new ServiceError(`${p.term.name} is closed`, 409);
    if (p.status !== 'DRAFT') throw new ServiceError('This timetable has already been sent to the Deputy', 409);
    const papers = await tx.examPaper.count({ where: { periodId: id } });
    if (papers === 0) throw new ServiceError('Add the papers before sending the timetable for approval', 409);
    const { clashes } = await clashesOf(tx, sid, id);
    const blocked = clashes.filter((c) => c.severity === 'block');
    if (blocked.length) throw new ServiceError(`Fix these first: ${blockedMessage(blocked)}`, 409);
    await tx.examPeriod.update({ where: { id }, data: { status: 'PENDING', submittedById: user.id, submittedAt: new Date() } });
    await logAudit({ schoolId: sid, actorId: user.id, action: 'SUBMIT_EXAM_TIMETABLE', entityType: 'ExamPeriod', entityId: id, detail: `Sent ${p.name} to the Deputy for approval` }, tx);
    const approvers = Array.from(new Set([...(await peopleWith(tx, sid, 'exams.timetable.approve', user.id)), ...(await deputyIds(tx, sid))])).filter((x) => x !== user.id);
    await notifyUsers(tx, sid, approvers, { type: 'EXAM_TIMETABLE_SUBMITTED', title: `${p.name} is waiting for approval`, body: `${papers} paper(s)`, link: `/exams/timetable/${id}`, dedupeKey: `exam-timetable-submitted:${id}:${Date.now()}` });
    return { id, status: 'PENDING' as const };
  });
}

/** The Deputy approves the timetable; it then shows on the Calendar and prints per level and per student. */
export async function approvePeriod(user: Actor, id: string) {
  need(user, 'exams.timetable.approve');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sid = user.schoolId;
    const p = await tx.examPeriod.findFirst({ where: { id, schoolId: sid }, include: { levels: true, term: { select: { name: true, status: true } } } });
    if (!p) throw new ServiceError('Exam period not found', 404);
    if (p.term.status === 'CLOSED') throw new ServiceError(`${p.term.name} is closed`, 409);
    if (p.status !== 'PENDING') throw new ServiceError(p.status === 'APPROVED' ? 'This timetable is already approved' : 'The Exams Officer has not sent this timetable for approval yet', 409);
    if (p.submittedById === user.id) throw new ServiceError('You sent this timetable for approval, so someone else must approve it', 403);
    const { clashes } = await clashesOf(tx, sid, id);
    const blocked = clashes.filter((c) => c.severity === 'block');
    if (blocked.length) throw new ServiceError(`It cannot be approved yet: ${blockedMessage(blocked)}`, 409);
    await tx.examPeriod.update({ where: { id }, data: { status: 'APPROVED', approvedById: user.id, approvedAt: new Date() } });
    const levels = await tx.level.findMany({ where: { id: { in: p.levels.map((l) => l.levelId) }, schoolId: sid }, select: { name: true } });
    const autoKey = `exam-period:${id}`;
    const data = { title: p.name, kind: 'EXAM' as const, startDate: p.startDate, endDate: p.endDate, notes: `Exam timetable approved. Forms: ${levels.map((l) => l.name).join(', ')}. Normal lessons are suspended for these forms on these days.`, audience: 'FORMS' as const, audienceLevelIds: p.levels.map((l) => l.levelId) };
    await tx.calendarEvent.upsert({ where: { schoolId_autoKey: { schoolId: sid, autoKey } }, update: data, create: { schoolId: sid, autoKey, createdById: user.id, ...data } });
    await logAudit({ schoolId: sid, actorId: user.id, action: 'APPROVE_EXAM_TIMETABLE', entityType: 'ExamPeriod', entityId: id, detail: `Approved ${p.name}` }, tx);
    const duty = await tx.invigilation.findMany({ where: { schoolId: sid, paper: { periodId: id } }, select: { userId: true } });
    await notifyUsers(tx, sid, [...duty.map((d) => d.userId), ...(p.submittedById ? [p.submittedById] : [])], { type: 'EXAM_TIMETABLE_APPROVED', title: `${p.name} is approved`, body: 'The exam timetable is on the calendar.', link: `/exams/timetable/${id}`, dedupeKey: `exam-timetable-approved:${id}` });
    return { id, status: 'APPROVED' as const };
  });
}

const ReturnSchema = z.object({ comment: z.string().trim().min(3, 'Say what needs to change').max(500) });

/** Sends a pending timetable back to the Exams Officer, or reopens an approved one (taking it off the Calendar). */
export async function returnPeriod(user: Actor, id: string, raw: unknown) {
  need(user, 'exams.timetable.approve');
  const input = ReturnSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sid = user.schoolId;
    const p = await loadPeriod(tx, sid, id);
    if (p.term.status === 'CLOSED') throw new ServiceError(`${p.term.name} is closed`, 409);
    if (p.status === 'DRAFT') throw new ServiceError('This timetable has not been sent for approval', 409);
    if (p.status === 'APPROVED') await tx.calendarEvent.deleteMany({ where: { schoolId: sid, autoKey: `exam-period:${id}` } });
    await tx.examPeriod.update({ where: { id }, data: { status: 'DRAFT', approvedById: null, approvedAt: null, submittedById: null, submittedAt: null } });
    await logAudit({ schoolId: sid, actorId: user.id, action: 'RETURN_EXAM_TIMETABLE', entityType: 'ExamPeriod', entityId: id, detail: `${p.status === 'APPROVED' ? 'Reopened' : 'Returned'} ${p.name}: ${input.comment}` }, tx);
    if (p.createdById) await notifyUsers(tx, sid, [p.createdById], { type: 'EXAM_TIMETABLE_RETURNED', title: `${p.name} was returned`, body: input.comment, link: `/exams/timetable/${id}`, dedupeKey: `exam-timetable-returned:${id}:${Date.now()}` });
    return { id, status: 'DRAFT' as const };
  });
}

// ─── What each student sits, and the Academics timetable ─────────────────────

export interface StudentPaper { paperId: string; subject: string; name: string; date: string; session: ExamSession; startTime: string; endTime: string; durationMinutes: number; room: string | null; desk: number | null }

/** Each student's own papers in an approved period, with their room and desk. */
export async function studentTimetable(user: Actor, periodId: string, studentId: string): Promise<{ period: string; student: string; className: string | null; papers: StudentPaper[] }> {
  need(user, 'exams.timetable.manage', 'exams.timetable.approve', 'exams.invigilation.manage', 'exams.results.view');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sid = user.schoolId;
    const period = await tx.examPeriod.findFirst({ where: { id: periodId, schoolId: sid, status: 'APPROVED' } });
    if (!period) throw new ServiceError('Exam period not found', 404);
    const student = await tx.student.findFirst({ where: { id: studentId, schoolId: sid }, select: { fullName: true } });
    if (!student) throw new ServiceError('Student not found', 404);
    const enrol = await tx.enrollment.findFirst({ where: { schoolId: sid, studentId, termId: period.termId, status: 'ACTIVE' }, select: { class: { select: { name: true, levelId: true } } } });
    const subjects = new Set((await tx.studentSubject.findMany({ where: { schoolId: sid, studentId, termId: period.termId }, select: { subjectId: true } })).map((s) => s.subjectId));
    const papers = enrol ? await tx.examPaper.findMany({ where: { periodId, schoolId: sid, levelId: enrol.class.levelId }, include: { subject: { select: { name: true } }, rooms: { include: { room: { select: { name: true } } }, orderBy: { createdAt: 'asc' } } }, orderBy: [{ date: 'asc' }, { session: 'asc' }] }) : [];
    const out: StudentPaper[] = [];
    for (const p of papers.filter((x) => subjects.has(x.subjectId))) {
      const cand = await candidatesOf(tx, sid, p, period.termId);
      const placed = allocateSeats(cand, p.rooms.map((r) => ({ roomId: r.roomId, examCapacity: r.examCapacity })));
      let room: string | null = null;
      let desk: number | null = null;
      for (const pl of placed) {
        const seat = pl.seats.find((s) => s.candidate.id === studentId);
        if (seat) { room = p.rooms.find((r) => r.roomId === pl.roomId)?.room.name ?? null; desk = seat.desk; }
      }
      out.push({ paperId: p.id, subject: p.subject.name, name: p.name, date: dayText(p.date), session: p.session, startTime: p.startTime, endTime: endTime(p), durationMinutes: p.durationMinutes, room, desk });
    }
    return { period: period.name, student: student.fullName, className: enrol?.class.name ?? null, papers: out };
  });
}

/** Exam days when normal lessons are suspended, for the Academics timetable: [{ date, levelIds, period }]. */
export async function lessonSuspensions(tx: Db, schoolId: string, termId: string): Promise<{ name: string; startDate: string; endDate: string; levelIds: string[]; days: string[] }[]> {
  const periods = await tx.examPeriod.findMany({ where: { schoolId, termId, status: 'APPROVED' }, include: { levels: true, papers: { select: { date: true } } } });
  return periods.map((p) => ({ name: p.name, startDate: dayText(p.startDate), endDate: dayText(p.endDate), levelIds: p.levels.map((l) => l.levelId), days: Array.from(new Set(p.papers.map((x) => dayText(x.date)))).sort() }));
}
