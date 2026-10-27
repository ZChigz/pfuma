// Invigilation, seating lists, exam attendance and incident reports.
//
//  • Invigilators are assigned per paper and room. "Auto-assign" spreads duties evenly across the available teachers and avoids the
//    subject's own teachers where possible; nobody is on two duties in the same session.
//  • Seating lists are per room, in candidate number (or admission number) order, with desk numbers, for the doors and the desks.
//  • An exam attendance sheet per paper and room: present, absent, late (with the time). A student marked absent gets AB on that paper
//    automatically (when their mark sheet is open); marking them present again takes the AB away.
//  • An incident report per paper (suspected malpractice, illness, disruption). Malpractice is also recorded in Discipline as Exam dishonesty.
import { z } from 'zod';
import type { ExamAttendanceStatus, ExamIncidentType } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { notifyUsers } from '@/lib/system/notifications';
import { deputyIds, peopleWith } from '@/lib/academics/common';
import { allocateSeats, endTime } from '@/lib/exams/clashes';
import { writeCells, type CellInput } from '@/lib/exams/marks';
import { candidatesOf, type Candidate } from '@/lib/exams/timetable';
import { classNameOf, ensureSheet, EDITABLE, holds, idSchema, loadAssignment, todayInHarare, type Actor } from '@/lib/exams/common';

const dayText = (d: Date) => d.toISOString().slice(0, 10);

const canManage = (u: Actor) => holds(u, 'exams.invigilation.manage') || holds(u, 'exams.timetable.manage');

// ─── Who invigilates ─────────────────────────────────────────────────────────

const paperWith = { period: { select: { id: true, name: true, termId: true, status: true, term: { select: { name: true, status: true } } } }, subject: { select: { name: true } }, rooms: { include: { room: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' as const } } };

/** Active teachers who could invigilate. */
async function teachers(tx: Db, schoolId: string) {
  return tx.user.findMany({ where: { schoolId, active: true, isSupport: false, userRoles: { some: { role: { key: { in: ['TEACHER', 'HOD', 'DEPUTY_HEAD', 'CLASS_TEACHER'] } } } } }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } });
}

const AssignSchema = z.object({ paperId: idSchema, roomId: idSchema, userId: idSchema });

export async function assignInvigilator(user: Actor, raw: unknown) {
  if (!canManage(user)) throw new ServiceError('Forbidden', 403);
  const input = AssignSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sid = user.schoolId;
    const paper = await tx.examPaper.findFirst({ where: { id: input.paperId, schoolId: sid }, include: paperWith });
    if (!paper) throw new ServiceError('Paper not found', 404);
    if (paper.period.term.status === 'CLOSED') throw new ServiceError(`${paper.period.term.name} is closed`, 409);
    if (!paper.rooms.some((r) => r.roomId === input.roomId)) throw new ServiceError('That room is not used for this paper', 422);
    const person = await tx.user.findFirst({ where: { id: input.userId, schoolId: sid, active: true, isSupport: false }, select: { id: true, fullName: true } });
    if (!person) throw new ServiceError('Teacher not found', 404);
    const clash = await tx.invigilation.findFirst({ where: { schoolId: sid, userId: input.userId, paper: { date: paper.date, session: paper.session, id: { not: paper.id } } }, include: { paper: { select: { name: true } } } });
    if (clash) throw new ServiceError(`${person.fullName} is already invigilating ${clash.paper.name} in the same session`, 409);
    const same = await tx.invigilation.findFirst({ where: { paperId: paper.id, userId: input.userId }, include: { room: { select: { name: true } } } });
    if (same) throw new ServiceError(same.roomId === input.roomId ? `${person.fullName} is already on this duty` : `${person.fullName} is already invigilating this paper in ${same.room.name}`, 409);
    const teaches = await tx.teacherAssignment.findFirst({ where: { schoolId: sid, termId: paper.period.termId, subjectId: paper.subjectId, status: 'ACTIVE', OR: [{ teacherId: input.userId }, { coTeacherId: input.userId }] }, select: { id: true } });
    const row = await tx.invigilation.create({ data: { schoolId: sid, paperId: paper.id, roomId: input.roomId, userId: input.userId } });
    await logAudit({ schoolId: sid, actorId: user.id, action: 'ASSIGN_INVIGILATOR', entityType: 'Invigilation', entityId: row.id, detail: `${person.fullName} to invigilate ${paper.name}` }, tx);
    if (paper.period.status === 'APPROVED') await notifyUsers(tx, sid, [input.userId], { type: 'EXAM_DUTY', title: `You are invigilating ${paper.name}`, body: `${dayText(paper.date)}, ${paper.session.toLowerCase()} ${paper.startTime}`, link: '/exams/timetable', dedupeKey: `exam-duty:${row.id}` });
    return { id: row.id, warning: teaches ? `${person.fullName} teaches ${paper.subject.name}. Another teacher is better if one is free.` : null };
  });
}

export async function removeInvigilator(user: Actor, id: string) {
  if (!canManage(user)) throw new ServiceError('Forbidden', 403);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const row = await tx.invigilation.findFirst({ where: { id, schoolId: user.schoolId }, include: { paper: { select: { name: true, period: { select: { term: { select: { name: true, status: true } } } } } } } });
    if (!row) throw new ServiceError('Duty not found', 404);
    if (row.paper.period.term.status === 'CLOSED') throw new ServiceError(`${row.paper.period.term.name} is closed`, 409);
    await tx.invigilation.delete({ where: { id } });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'ASSIGN_INVIGILATOR', entityType: 'Invigilation', entityId: id, detail: `Removed an invigilator from ${row.paper.name}` }, tx);
    return { id };
  });
}

const AutoSchema = z.object({ periodId: idSchema, perRoom: z.number().int().min(1).max(4).default(1), extraAbove: z.number().int().min(10).max(200).default(30), replace: z.boolean().default(false) });

/**
 * Spreads the duties of a period evenly: for each room of each paper, in date order, the available teacher with the fewest duties so
 * far, avoiding teachers of that subject where possible. Nobody has two duties in one session. A room with more than `extraAbove`
 * candidates gets an extra invigilator.
 */
export async function autoAssignInvigilators(user: Actor, raw: unknown) {
  if (!canManage(user)) throw new ServiceError('Forbidden', 403);
  const input = AutoSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sid = user.schoolId;
    const period = await tx.examPeriod.findFirst({ where: { id: input.periodId, schoolId: sid }, include: { term: { select: { name: true, status: true } } } });
    if (!period) throw new ServiceError('Exam period not found', 404);
    if (period.term.status === 'CLOSED') throw new ServiceError(`${period.term.name} is closed`, 409);
    const papers = await tx.examPaper.findMany({ where: { periodId: input.periodId, schoolId: sid }, include: paperWith, orderBy: [{ date: 'asc' }, { session: 'asc' }, { startTime: 'asc' }] });
    if (input.replace) await tx.invigilation.deleteMany({ where: { schoolId: sid, paper: { periodId: input.periodId } } });
    const pool = await teachers(tx, sid);
    if (pool.length === 0) throw new ServiceError('There are no teachers to assign', 409);
    const existing = await tx.invigilation.findMany({ where: { schoolId: sid, paper: { periodId: input.periodId } }, select: { userId: true, paperId: true, roomId: true } });
    const load = new Map<string, number>(pool.map((p) => [p.id, 0]));
    const busy = new Set<string>(); // userId|date|session
    const sessionOf = new Map(papers.map((p) => [p.id, `${dayText(p.date)}|${p.session}`]));
    for (const e of existing) { load.set(e.userId, (load.get(e.userId) ?? 0) + 1); busy.add(`${e.userId}|${sessionOf.get(e.paperId)}`); }
    const teachersOfSubject = new Map<string, Set<string>>();
    const assignments = await tx.teacherAssignment.findMany({ where: { schoolId: sid, termId: period.termId, status: 'ACTIVE' }, select: { subjectId: true, teacherId: true, coTeacherId: true } });
    for (const a of assignments) { const s = teachersOfSubject.get(a.subjectId) ?? teachersOfSubject.set(a.subjectId, new Set()).get(a.subjectId)!; s.add(a.teacherId); if (a.coTeacherId) s.add(a.coTeacherId); }

    let created = 0;
    const notes: string[] = [];
    for (const paper of papers) {
      const cand = await candidatesOf(tx, sid, paper, period.termId);
      const placed = allocateSeats(cand, paper.rooms.map((r) => ({ roomId: r.roomId, examCapacity: r.examCapacity })));
      for (const room of paper.rooms) {
        const seated = placed.find((p) => p.roomId === room.roomId)?.seats.length ?? 0;
        const need = input.perRoom + (seated > input.extraAbove ? 1 : 0);
        const have = existing.filter((e) => e.paperId === paper.id && e.roomId === room.roomId).length;
        for (let i = have; i < need; i++) {
          const free = pool.filter((p) => !busy.has(`${p.id}|${sessionOf.get(paper.id)}`) && !existing.some((e) => e.paperId === paper.id && e.roomId === room.roomId && e.userId === p.id));
          const own = teachersOfSubject.get(paper.subjectId) ?? new Set<string>();
          const preferred = free.filter((p) => !own.has(p.id));
          const choice = (preferred.length ? preferred : free).sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || a.fullName.localeCompare(b.fullName))[0];
          if (!choice) { notes.push(`${paper.name}, ${room.room.name}: no teacher is free`); continue; }
          await tx.invigilation.create({ data: { schoolId: sid, paperId: paper.id, roomId: room.roomId, userId: choice.id } });
          existing.push({ userId: choice.id, paperId: paper.id, roomId: room.roomId });
          load.set(choice.id, (load.get(choice.id) ?? 0) + 1);
          busy.add(`${choice.id}|${sessionOf.get(paper.id)}`);
          if (own.has(choice.id)) notes.push(`${choice.fullName} teaches ${paper.subject.name} but invigilates ${paper.name}: nobody else was free`);
          created++;
        }
      }
    }
    await logAudit({ schoolId: sid, actorId: user.id, action: 'ASSIGN_INVIGILATOR', entityType: 'ExamPeriod', entityId: input.periodId, detail: `Auto-assigned ${created} invigilation duties for ${period.name}${notes.length ? `; ${notes.length} note(s)` : ''}` }, tx);
    if (created > 0 && period.status === 'APPROVED') {
      const duty = await tx.invigilation.findMany({ where: { schoolId: sid, paper: { periodId: input.periodId } }, select: { userId: true } });
      await notifyUsers(tx, sid, duty.map((d) => d.userId), { type: 'EXAM_DUTY', title: `You have invigilation duties in ${period.name}`, link: '/exams/timetable', dedupeKey: `exam-duty-period:${input.periodId}` });
    }
    return { created, notes };
  });
}

export interface Duty { id: string; paperId: string; paper: string; subject: string; date: string; session: 'MORNING' | 'AFTERNOON'; startTime: string; endTime: string; roomId: string; room: string; userId: string; teacher: string; candidates: number }

/** Every duty of a period, by day and session, for the staff-room roster. */
export async function dutyRoster(user: Actor, periodId: string): Promise<{ period: string; duties: Duty[]; missing: { paper: string; room: string }[]; teachers: { id: string; name: string }[] }> {
  if (!canManage(user) && !holds(user, 'exams.timetable.approve')) throw new ServiceError('Forbidden', 403);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sid = user.schoolId;
    const period = await tx.examPeriod.findFirst({ where: { id: periodId, schoolId: sid } });
    if (!period) throw new ServiceError('Exam period not found', 404);
    const papers = await tx.examPaper.findMany({ where: { periodId, schoolId: sid }, include: { ...paperWith, invigilations: true }, orderBy: [{ date: 'asc' }, { session: 'asc' }, { startTime: 'asc' }] });
    const people = await tx.user.findMany({ where: { schoolId: sid, id: { in: Array.from(new Set(papers.flatMap((p) => p.invigilations.map((i) => i.userId)))) } }, select: { id: true, fullName: true } });
    const nameOf = new Map(people.map((p) => [p.id, p.fullName]));
    const duties: Duty[] = [];
    const missing: { paper: string; room: string }[] = [];
    for (const p of papers) {
      const cand = await candidatesOf(tx, sid, p, period.termId);
      const placed = allocateSeats(cand, p.rooms.map((r) => ({ roomId: r.roomId, examCapacity: r.examCapacity })));
      for (const r of p.rooms) {
        const on = p.invigilations.filter((i) => i.roomId === r.roomId);
        if (on.length === 0) missing.push({ paper: p.name, room: r.room.name });
        for (const i of on) duties.push({ id: i.id, paperId: p.id, paper: p.name, subject: p.subject.name, date: dayText(p.date), session: p.session, startTime: p.startTime, endTime: endTime(p), roomId: r.roomId, room: r.room.name, userId: i.userId, teacher: nameOf.get(i.userId) ?? '', candidates: placed.find((x) => x.roomId === r.roomId)?.seats.length ?? 0 });
      }
    }
    return { period: period.name, duties, missing, teachers: (await teachers(tx, sid)).map((t) => ({ id: t.id, name: t.fullName })) };
  });
}

/** A teacher's own duties: for their dashboard and timetable. */
export async function myDuties(user: Actor, opts: { upcomingOnly?: boolean } = {}): Promise<Duty[]> {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const today = new Date(`${todayInHarare()}T00:00:00Z`);
    const rows = await tx.invigilation.findMany({
      where: { schoolId: user.schoolId, userId: user.id, paper: { period: { status: 'APPROVED' }, ...(opts.upcomingOnly ? { date: { gte: today } } : {}) } },
      include: { paper: { include: { subject: { select: { name: true } } } }, room: { select: { name: true } } },
      orderBy: [{ paper: { date: 'asc' } }, { paper: { session: 'asc' } }],
    });
    return rows.map((r) => ({ id: r.id, paperId: r.paperId, paper: r.paper.name, subject: r.paper.subject.name, date: dayText(r.paper.date), session: r.paper.session, startTime: r.paper.startTime, endTime: endTime(r.paper), roomId: r.roomId, room: r.room.name, userId: r.userId, teacher: user.fullName ?? '', candidates: 0 }));
  });
}

// ─── Seating ─────────────────────────────────────────────────────────────────

export interface SeatingRoom { roomId: string; room: string; invigilators: string[]; seats: { desk: number; candidateNumber: string | null; admissionNumber: string; name: string; className: string | null }[] }
export interface Seating { paperId: string; paper: string; subject: string; date: string; session: 'MORNING' | 'AFTERNOON'; startTime: string; endTime: string; period: string; candidates: number; unseated: Candidate[]; rooms: SeatingRoom[] }

/** The seating list of one paper: candidates in candidate number (else admission number) order, filling the rooms in turn, with desk numbers. */
export async function seatingFor(user: Actor, paperId: string): Promise<Seating> {
  if (!canManage(user) && !holds(user, 'exams.timetable.approve') && !holds(user, 'exams.marks.enter')) throw new ServiceError('Forbidden', 403);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sid = user.schoolId;
    const p = await tx.examPaper.findFirst({ where: { id: paperId, schoolId: sid }, include: { ...paperWith, invigilations: true } });
    if (!p) throw new ServiceError('Paper not found', 404);
    const duty = p.invigilations.some((i) => i.userId === user.id);
    if (!canManage(user) && !holds(user, 'exams.timetable.approve') && !duty) throw new ServiceError('Paper not found', 404);
    const cand = await candidatesOf(tx, sid, p, p.period.termId);
    const placed = allocateSeats(cand, p.rooms.map((r) => ({ roomId: r.roomId, examCapacity: r.examCapacity })));
    const names = new Map((await tx.user.findMany({ where: { schoolId: sid, id: { in: p.invigilations.map((i) => i.userId) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
    const seatedIds = new Set(placed.flatMap((r) => r.seats.map((s) => s.candidate.id)));
    return {
      paperId: p.id, paper: p.name, subject: p.subject.name, date: dayText(p.date), session: p.session, startTime: p.startTime, endTime: endTime(p), period: p.period.name, candidates: cand.length,
      unseated: cand.filter((c) => !seatedIds.has(c.id)),
      rooms: p.rooms.map((r) => ({
        roomId: r.roomId, room: r.room.name, invigilators: p.invigilations.filter((i) => i.roomId === r.roomId).map((i) => names.get(i.userId) ?? ''),
        seats: (placed.find((x) => x.roomId === r.roomId)?.seats ?? []).map((s) => ({ desk: s.desk, candidateNumber: s.candidate.candidateNumber, admissionNumber: s.candidate.admissionNumber, name: s.candidate.name, className: s.candidate.className })),
      })),
    };
  });
}

// ─── Attendance ──────────────────────────────────────────────────────────────

export interface AttendanceRow { studentId: string; name: string; admissionNumber: string; candidateNumber: string | null; desk: number; status: ExamAttendanceStatus | null; arrivalTime: string | null }
export interface AttendanceSheet { paperId: string; paper: string; roomId: string; room: string; date: string; session: string; canMark: boolean; rows: AttendanceRow[] }

async function mayMark(tx: Db, user: Actor, paperId: string, roomId: string) {
  if (canManage(user)) return true;
  return !!(await tx.invigilation.findFirst({ where: { schoolId: user.schoolId, paperId, roomId, userId: user.id }, select: { id: true } }));
}

/** The exam attendance sheet for one paper and room. The people on duty in that room (and the Exams Officer) may mark it. */
export async function attendanceSheet(user: Actor, paperId: string, roomId: string): Promise<AttendanceSheet> {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sid = user.schoolId;
    const p = await tx.examPaper.findFirst({ where: { id: paperId, schoolId: sid }, include: paperWith });
    if (!p || !p.rooms.some((r) => r.roomId === roomId)) throw new ServiceError('Paper not found', 404);
    const canMark = await mayMark(tx, user, paperId, roomId);
    if (!canMark && !holds(user, 'exams.timetable.approve')) throw new ServiceError('Paper not found', 404);
    const cand = await candidatesOf(tx, sid, p, p.period.termId);
    const placed = allocateSeats(cand, p.rooms.map((r) => ({ roomId: r.roomId, examCapacity: r.examCapacity })));
    const seats = placed.find((x) => x.roomId === roomId)?.seats ?? [];
    const marks = await tx.examAttendance.findMany({ where: { schoolId: sid, paperId, studentId: { in: seats.map((s) => s.candidate.id) } } });
    return {
      paperId, paper: p.name, roomId, room: p.rooms.find((r) => r.roomId === roomId)!.room.name, date: dayText(p.date), session: p.session, canMark,
      rows: seats.map((s) => { const m = marks.find((x) => x.studentId === s.candidate.id); return { studentId: s.candidate.id, name: s.candidate.name, admissionNumber: s.candidate.admissionNumber, candidateNumber: s.candidate.candidateNumber, desk: s.desk, status: m?.status ?? null, arrivalTime: m?.arrivalTime ?? null }; }),
    };
  });
}

const MarkSchema = z.object({
  paperId: idSchema, roomId: idSchema,
  entries: z.array(z.object({ studentId: idSchema, status: z.enum(['PRESENT', 'ABSENT', 'LATE']), arrivalTime: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Enter a time as HH:MM').nullish() })).min(1).max(300),
});

export interface MarkAttendanceResult { saved: number; absent: number; markedAB: number; notApplied: string[] }

/**
 * Records who sat the paper. An absent student gets AB on the paper's assessment under their own teacher assignment, unless that mark
 * sheet is locked (then the Exams Officer is told to ask the Head) or they already have a mark.
 */
export async function markAttendance(user: Actor, raw: unknown): Promise<MarkAttendanceResult> {
  const input = MarkSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sid = user.schoolId;
    const p = await tx.examPaper.findFirst({ where: { id: input.paperId, schoolId: sid }, include: { ...paperWith, assessment: { select: { id: true } } } });
    if (!p || !p.rooms.some((r) => r.roomId === input.roomId)) throw new ServiceError('Paper not found', 404);
    if (p.period.term.status === 'CLOSED') throw new ServiceError(`${p.period.term.name} is closed`, 409);
    if (!(await mayMark(tx, user, input.paperId, input.roomId))) throw new ServiceError('Paper not found', 404);
    const cand = await candidatesOf(tx, sid, p, p.period.termId);
    const placed = allocateSeats(cand, p.rooms.map((r) => ({ roomId: r.roomId, examCapacity: r.examCapacity })));
    const here = new Set((placed.find((x) => x.roomId === input.roomId)?.seats ?? []).map((s) => s.candidate.id));
    const prior = new Map((await tx.examAttendance.findMany({ where: { schoolId: sid, paperId: input.paperId, studentId: { in: input.entries.map((e) => e.studentId) } } })).map((a) => [a.studentId, a.status]));
    let absent = 0;
    let markedAB = 0;
    const notApplied: string[] = [];
    for (const e of input.entries) {
      if (!here.has(e.studentId)) throw new ServiceError('A student is not seated in this room for this paper', 422);
      if (e.status === 'LATE' && !e.arrivalTime) throw new ServiceError('Enter the time a late student arrived', 422);
      await tx.examAttendance.upsert({
        where: { paperId_studentId: { paperId: input.paperId, studentId: e.studentId } },
        update: { status: e.status, arrivalTime: e.status === 'LATE' ? e.arrivalTime! : null, roomId: input.roomId, markedById: user.id },
        create: { schoolId: sid, paperId: input.paperId, studentId: e.studentId, roomId: input.roomId, status: e.status, arrivalTime: e.status === 'LATE' ? e.arrivalTime! : null, markedById: user.id },
      });
      const was = prior.get(e.studentId);
      if (e.status === 'ABSENT') absent++;
      if (!p.assessment || (e.status === 'ABSENT') === (was === 'ABSENT')) continue;
      const r = await applyAbsenceMark(tx, user, p.assessment.id, p.subjectId, p.period.termId, e.studentId, e.status === 'ABSENT');
      if (r === 'applied') { if (e.status === 'ABSENT') markedAB++; } else if (r !== 'none') notApplied.push(`${cand.find((c) => c.id === e.studentId)?.name ?? ''}: ${r}`);
    }
    await logAudit({ schoolId: sid, actorId: user.id, action: 'MARK_EXAM_ATTENDANCE', entityType: 'ExamPaper', entityId: input.paperId, detail: `Attendance for ${p.name}, ${p.rooms.find((r) => r.roomId === input.roomId)!.room.name}: ${input.entries.length} recorded, ${absent} absent, ${markedAB} marked AB` }, tx);
    return { saved: input.entries.length, absent, markedAB, notApplied };
  });
}

/** AB on the paper's assessment for an absent student (or taking it away again). Returns what happened, in words when it did not. */
async function applyAbsenceMark(tx: Db, user: Actor, assessmentId: string, subjectId: string, termId: string, studentId: string, absent: boolean): Promise<'applied' | 'none' | string> {
  const sid = user.schoolId;
  const enrol = await tx.enrollment.findFirst({ where: { schoolId: sid, studentId, termId, status: 'ACTIVE' }, select: { classId: true } });
  const asg = await tx.teacherAssignment.findFirst({
    where: { schoolId: sid, termId, subjectId, status: 'ACTIVE', OR: [{ classId: enrol?.classId ?? '__none__' }, { group: { students: { some: { studentId } } } }] },
    select: { id: true },
  });
  if (!asg) return 'no teacher is assigned for this subject, so AB was not entered';
  const a = await loadAssignment(tx, sid, asg.id);
  const sheet = await ensureSheet(tx, sid, a);
  const existing = await tx.assessmentMark.findFirst({ where: { schoolId: sid, assignmentId: a.id, assessmentId, studentId, stageId: null } });
  if (absent) {
    if (existing && (existing.value !== null || (existing.code !== null && existing.code !== 'AB'))) return 'already has a mark, so AB was not entered';
    if (existing?.code === 'AB') return 'none';
  } else if (!existing || existing.code !== 'AB') return 'none';
  if (!EDITABLE.includes(sheet.status)) return `the ${classNameOf(a)} ${a.subject.name} mark sheet is ${sheet.status.toLowerCase()}; ask the Head to unlock it, then enter AB`;
  const cell: CellInput = { studentId, assessmentId, stageId: null, value: null, code: absent ? 'AB' : null };
  await writeCells(tx, { user, a, sheet, reason: absent ? 'Absent at the exam (exam attendance sheet)' : 'Present at the exam (exam attendance sheet corrected)' }, [cell]);
  if (sheet.status === 'NOT_STARTED') await tx.markSheet.update({ where: { id: sheet.id }, data: { status: 'IN_PROGRESS' } });
  return 'applied';
}

// ─── Incidents ───────────────────────────────────────────────────────────────

const IncidentSchema = z.object({
  paperId: idSchema, roomId: idSchema.nullish(), studentId: idSchema.nullish(),
  type: z.enum(['MALPRACTICE', 'ILLNESS', 'DISRUPTION', 'OTHER']),
  description: z.string().trim().min(5, 'Say what happened in a few words').max(2000),
});

/** Reports something that happened during a paper. Suspected malpractice by a student is also recorded in Discipline (Exam dishonesty). */
export async function reportIncident(user: Actor, raw: unknown) {
  const input = IncidentSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sid = user.schoolId;
    const p = await tx.examPaper.findFirst({ where: { id: input.paperId, schoolId: sid }, include: { ...paperWith, invigilations: true } });
    if (!p) throw new ServiceError('Paper not found', 404);
    if (!canManage(user) && !p.invigilations.some((i) => i.userId === user.id)) throw new ServiceError('Paper not found', 404);
    if (input.roomId && !p.rooms.some((r) => r.roomId === input.roomId)) throw new ServiceError('That room is not used for this paper', 422);
    let student: { id: string; fullName: string } | null = null;
    if (input.studentId) {
      const cand = await candidatesOf(tx, sid, p, p.period.termId);
      if (!cand.some((c) => c.id === input.studentId)) throw new ServiceError('That student does not sit this paper', 422);
      student = await tx.student.findFirst({ where: { id: input.studentId, schoolId: sid }, select: { id: true, fullName: true } });
    }
    if (input.type === 'MALPRACTICE' && !student) throw new ServiceError('Choose the student suspected of malpractice', 422);
    let disciplineIncidentId: string | null = null;
    if (input.type === 'MALPRACTICE' && student) {
      const when = new Date();
      const d = await tx.disciplineIncident.create({
        data: {
          schoolId: sid, occurredAt: when, location: 'CLASSROOM', category: 'EXAM_DISHONESTY', severity: 'SERIOUS', recordedById: user.id,
          description: `Suspected exam malpractice during ${p.name} (${p.period.name}). ${input.description}`,
          students: { create: [{ schoolId: sid, studentId: student.id }] },
        },
      });
      disciplineIncidentId = d.id;
    }
    const row = await tx.examIncident.create({ data: { schoolId: sid, paperId: p.id, roomId: input.roomId ?? null, studentId: student?.id ?? null, type: input.type as ExamIncidentType, description: input.description, reportedById: user.id, disciplineIncidentId } });
    await logAudit({ schoolId: sid, actorId: user.id, action: 'REPORT_EXAM_INCIDENT', entityType: 'ExamIncident', entityId: row.id, detail: `${input.type.toLowerCase()} during ${p.name}${student ? ` (${student.fullName})` : ''}${disciplineIncidentId ? '; recorded in Discipline as exam dishonesty' : ''}` }, tx);
    const tell = Array.from(new Set([...(await peopleWith(tx, sid, 'exams.timetable.manage', user.id)), ...(await deputyIds(tx, sid))])).filter((x) => x !== user.id);
    await notifyUsers(tx, sid, tell, { type: 'EXAM_INCIDENT', title: `Exam incident: ${p.name}`, body: input.description.slice(0, 200), link: `/exams/timetable/${p.periodId}`, dedupeKey: `exam-incident:${row.id}` });
    return { id: row.id, disciplineIncidentId };
  });
}

export async function listIncidents(user: Actor, periodId: string) {
  if (!canManage(user) && !holds(user, 'exams.timetable.approve')) throw new ServiceError('Forbidden', 403);
  const rows = await getScopedDb(user.schoolId, user.id).examIncident.findMany({
    where: { schoolId: user.schoolId, paper: { periodId } }, include: { paper: { select: { name: true } }, student: { select: { fullName: true } } }, orderBy: { occurredAt: 'desc' },
  });
  return rows.map((r) => ({ id: r.id, paper: r.paper.name, type: r.type, student: r.student?.fullName ?? null, description: r.description, at: r.occurredAt.toISOString(), inDiscipline: !!r.disciplineIncidentId }));
}

