// Comments, the pre-publish check, publishing and unpublishing results, and the data behind report cards.
//
// The Head publishes a class only when every mark sheet and every comment is done. Publishing recalculates the whole class,
// locks the results (SubjectResult and TermResult become a snapshot that nothing changes except unpublish), copies the
// comments, attendance and next-term date onto the TermResult, gives each card a verification code, and tells the teachers.
// Report card PDFs are drawn from that snapshot when they are asked for, so every copy of a card is the same card.
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { MarkSheetStatus } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { notifyUsers } from '@/lib/system/notifications';
import { gradeOf, positionText, round2 } from '@/lib/results';
import { recalculateLevel } from '@/lib/results/service';
import { loadLetterhead, type SchoolLetterhead } from '@/lib/students/documents';
import { scaleFor } from '@/lib/exams/scales';
import {
  MAX_COMMENT, classNameOf, commentSchema, holds, idSchema, loadExamSettings, num, reasonSchema, resolveTerm, rosterOf, loadAssignment, type Actor,
} from '@/lib/exams/common';

// ─── Subject comments ────────────────────────────────────────────────────────

const SubjectCommentsSchema = z.object({
  assignmentId: idSchema,
  comments: z.array(z.object({ studentId: idSchema, text: z.string().trim().max(MAX_COMMENT, `Comments are limited to ${MAX_COMMENT} characters`).nullable() })).min(1).max(200),
});

/** The subject teacher's short comment per student, written on the mark sheet (a setting) and copied onto the result. */
export async function saveSubjectComments(user: Actor, raw: unknown) {
  const input = SubjectCommentsSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const settings = await loadExamSettings(tx, user.schoolId);
    if (!settings.subjectCommentsEnabled) throw new ServiceError('Subject comments are switched off for this school', 409);
    const a = await loadAssignment(tx, user.schoolId, input.assignmentId);
    const mine = a.teacherId === user.id || a.coTeacherId === user.id;
    if (!(holds(user, 'exams.comments.subject') && mine)) throw new ServiceError('Class not found', 404);
    if (a.term.status === 'CLOSED') throw new ServiceError(`${a.term.name} is closed`, 409);
    const sheet = await tx.markSheet.upsert({ where: { assignmentId_termId: { assignmentId: a.id, termId: a.termId } }, update: {}, create: { schoolId: user.schoolId, assignmentId: a.id, termId: a.termId } });
    if (sheet.status === 'PUBLISHED') throw new ServiceError('These results are published. Unpublish the class before changing comments.', 409);
    const onRoster = new Set((await rosterOf(tx, user.schoolId, a)).map((s) => s.id));
    let saved = 0;
    for (const c of input.comments) {
      if (!onRoster.has(c.studentId)) throw new ServiceError('A student does not take this subject in this class', 422);
      if (c.text) {
        await tx.sheetStudentComment.upsert({ where: { sheetId_studentId: { sheetId: sheet.id, studentId: c.studentId } }, update: { text: c.text }, create: { schoolId: user.schoolId, sheetId: sheet.id, studentId: c.studentId, text: c.text } });
      } else {
        await tx.sheetStudentComment.deleteMany({ where: { sheetId: sheet.id, studentId: c.studentId } });
      }
      await tx.subjectResult.updateMany({ where: { schoolId: user.schoolId, studentId: c.studentId, subjectId: a.subjectId, termId: a.termId, published: false }, data: { teacherComment: c.text || null } });
      saved++;
    }
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'SAVE_REPORT_COMMENT', entityType: 'MarkSheet', entityId: sheet.id, detail: `${saved} subject comment(s) saved for ${a.subject.name} ${classNameOf(a)}` }, tx);
    return { saved };
  });
}

// ─── Class teacher and Head comments ─────────────────────────────────────────

export interface ClassCommentRow {
  studentId: string;
  name: string;
  admissionNumber: string;
  average: number | null;
  classPosition: number | null;
  classSize: number | null;
  subjects: { subject: string; mark: number; grade: string | null }[];
  classTeacherComment: string;
  headRemark: string;
  published: boolean;
}

export interface ClassComments {
  classId: string;
  className: string;
  termId: string;
  termName: string;
  classTeacher: string | null;
  canWriteClass: boolean;
  canWriteHead: boolean;
  rows: ClassCommentRow[];
  bank: { SUBJECT: string[]; CLASS_TEACHER: string[]; HEAD: string[] };
}

async function isClassTeacher(tx: Db, schoolId: string, userId: string, classId: string, termId: string) {
  return !!(await tx.classTeacher.findFirst({ where: { schoolId, userId, classId, termId }, select: { id: true } }));
}

/** The class comments page: each student's results beside the comment boxes. */
export async function classComments(user: Actor, classId: string, termId?: string): Promise<ClassComments> {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await resolveTerm(tx, user.schoolId, termId);
    const klass = await tx.schoolClass.findFirst({ where: { id: classId, schoolId: user.schoolId }, select: { id: true, name: true } });
    if (!klass) throw new ServiceError('Class not found', 404);
    const own = await isClassTeacher(tx, user.schoolId, user.id, classId, term.id);
    const wide = holds(user, 'exams.comments.head') || holds(user, 'exams.results.view') && !own;
    if (!own && !wide) throw new ServiceError('Class not found', 404);
    const ct = await tx.classTeacher.findFirst({ where: { classId, termId: term.id }, select: { user: { select: { fullName: true } } } });
    const enrol = await tx.enrollment.findMany({ where: { schoolId: user.schoolId, classId, termId: term.id, status: 'ACTIVE' }, select: { student: { select: { id: true, firstName: true, surname: true, admissionNumber: true } } } });
    const ids = enrol.map((e) => e.student.id);
    const [subjects, termRows, comments, bank] = await Promise.all([
      tx.subjectResult.findMany({ where: { schoolId: user.schoolId, termId: term.id, studentId: { in: ids } }, include: { subject: { select: { name: true } } }, orderBy: { subject: { name: 'asc' } } }),
      tx.termResult.findMany({ where: { schoolId: user.schoolId, termId: term.id, studentId: { in: ids } } }),
      tx.reportComment.findMany({ where: { schoolId: user.schoolId, termId: term.id, studentId: { in: ids } } }),
      tx.commentBankItem.findMany({ where: { schoolId: user.schoolId }, orderBy: { text: 'asc' } }),
    ]);
    const rows: ClassCommentRow[] = enrol
      .map((e) => e.student)
      .sort((a, b) => a.surname.localeCompare(b.surname) || a.firstName.localeCompare(b.firstName))
      .map((s) => {
        const tr = termRows.find((t) => t.studentId === s.id);
        const c = comments.find((x) => x.studentId === s.id);
        return {
          studentId: s.id, name: `${s.surname.toUpperCase()}, ${s.firstName}`, admissionNumber: s.admissionNumber,
          average: num(tr?.averagePercentage ?? null), classPosition: tr?.classPosition ?? null, classSize: tr?.classSize ?? null,
          subjects: subjects.filter((r) => r.studentId === s.id).map((r) => ({ subject: r.subject.name, mark: r.roundedMark, grade: r.grade })),
          classTeacherComment: c?.classTeacherComment ?? '', headRemark: c?.headRemark ?? '', published: tr?.published ?? false,
        };
      });
    const group = (cat: string) => bank.filter((b) => b.category === cat).map((b) => b.text);
    return {
      classId, className: klass.name, termId: term.id, termName: term.name, classTeacher: ct?.user.fullName ?? null,
      canWriteClass: (own && holds(user, 'exams.comments.class')), canWriteHead: holds(user, 'exams.comments.head'),
      rows, bank: { SUBJECT: group('SUBJECT'), CLASS_TEACHER: group('CLASS_TEACHER'), HEAD: group('HEAD') },
    };
  });
}

const ClassCommentsSchema = z.object({
  classId: idSchema, termId: idSchema,
  kind: z.enum(['CLASS_TEACHER', 'HEAD']),
  comments: z.array(z.object({ studentId: idSchema, text: z.string().trim().max(MAX_COMMENT, `Comments are limited to ${MAX_COMMENT} characters`).nullable() })).min(1).max(200),
});

async function writeComments(tx: Db, user: Actor, classId: string, termId: string, kind: 'CLASS_TEACHER' | 'HEAD', comments: { studentId: string; text: string | null }[]) {
  const sid = user.schoolId;
  const published = await tx.termResult.findMany({ where: { schoolId: sid, termId, published: true, studentId: { in: comments.map((c) => c.studentId) } }, select: { studentId: true } });
  if (published.length) throw new ServiceError('These results are published. Unpublish the class before changing comments.', 409);
  const enrolled = new Set((await tx.enrollment.findMany({ where: { schoolId: sid, classId, termId, status: 'ACTIVE' }, select: { studentId: true } })).map((e) => e.studentId));
  for (const c of comments) {
    if (!enrolled.has(c.studentId)) throw new ServiceError('A student is not in this class', 422);
    const data = kind === 'CLASS_TEACHER' ? { classTeacherComment: c.text || null, classTeacherById: user.id } : { headRemark: c.text || null, headRemarkById: user.id };
    await tx.reportComment.upsert({ where: { studentId_termId: { studentId: c.studentId, termId } }, update: { ...data, classId }, create: { schoolId: sid, studentId: c.studentId, termId, classId, ...data } });
  }
  await logAudit({ schoolId: sid, actorId: user.id, action: 'SAVE_REPORT_COMMENT', entityType: 'SchoolClass', entityId: classId, detail: `${comments.length} ${kind === 'HEAD' ? "Head's remark(s)" : 'class teacher comment(s)'} saved` }, tx);
}

/** The class teacher writes the overall comment (their own class); the Head writes a remark per student. */
export async function saveClassComments(user: Actor, raw: unknown) {
  const input = ClassCommentsSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await resolveTerm(tx, user.schoolId, input.termId);
    if (term.status === 'CLOSED') throw new ServiceError(`${term.name} is closed`, 409);
    if (!(await tx.schoolClass.findFirst({ where: { id: input.classId, schoolId: user.schoolId }, select: { id: true } }))) throw new ServiceError('Class not found', 404);
    if (input.kind === 'CLASS_TEACHER') {
      const own = await isClassTeacher(tx, user.schoolId, user.id, input.classId, term.id);
      if (!(own && holds(user, 'exams.comments.class'))) throw new ServiceError('Class not found', 404);
    } else if (!holds(user, 'exams.comments.head')) throw new ServiceError('Forbidden', 403);
    await writeComments(tx, user, input.classId, term.id, input.kind, input.comments);
    return { saved: input.comments.length };
  });
}

const BandSchema = z.object({
  classId: idSchema, termId: idSchema,
  minAverage: z.number().min(0).max(100), maxAverage: z.number().min(0).max(100).default(100),
  text: commentSchema,
  /** Replace remarks already written (otherwise only empty ones are filled). */
  overwrite: z.boolean().default(false),
});

/** One remark for a whole band of the class (averages 75% and above); the Head can then edit it per student. */
export async function applyBandRemark(user: Actor, raw: unknown) {
  const input = BandSchema.parse(raw);
  if (!holds(user, 'exams.comments.head')) throw new ServiceError('Forbidden', 403);
  if (input.minAverage > input.maxAverage) throw new ServiceError('The lowest average cannot be above the highest', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await resolveTerm(tx, user.schoolId, input.termId);
    if (term.status === 'CLOSED') throw new ServiceError(`${term.name} is closed`, 409);
    const rows = await tx.termResult.findMany({ where: { schoolId: user.schoolId, termId: term.id, classId: input.classId, published: false }, select: { studentId: true, averagePercentage: true } });
    const inBand = rows.filter((r) => { const a = num(r.averagePercentage); return a !== null && a >= input.minAverage && a <= input.maxAverage; });
    const existing = await tx.reportComment.findMany({ where: { schoolId: user.schoolId, termId: term.id, studentId: { in: inBand.map((r) => r.studentId) } } });
    const has = new Set(existing.filter((c) => c.headRemark).map((c) => c.studentId));
    const targets = inBand.filter((r) => input.overwrite || !has.has(r.studentId));
    if (targets.length === 0) return { saved: 0, skipped: inBand.length };
    await writeComments(tx, user, input.classId, term.id, 'HEAD', targets.map((r) => ({ studentId: r.studentId, text: input.text })));
    return { saved: targets.length, skipped: inBand.length - targets.length };
  });
}

// ─── The pre-publish check ───────────────────────────────────────────────────

export interface PublishProblem { kind: 'SHEET' | 'NO_TEACHER' | 'NO_PLAN' | 'CLASS_COMMENT' | 'HEAD_REMARK' | 'NO_RESULTS' | 'FORM_POSITIONS'; severity: 'block' | 'warn'; message: string; items?: string[] }
export interface PublishCheck { classId: string; className: string; students: number; ready: boolean; problems: PublishProblem[]; published: boolean }

/** Everything that is missing before a class can be published: unverified sheets, comments, remarks. */
export async function checkClass(tx: Db, schoolId: string, classId: string, termId: string): Promise<PublishCheck> {
  const klass = await tx.schoolClass.findFirstOrThrow({ where: { id: classId, schoolId }, select: { id: true, name: true, levelId: true } });
  const enrol = await tx.enrollment.findMany({ where: { schoolId, classId, termId, status: 'ACTIVE' }, select: { student: { select: { id: true, firstName: true, surname: true } } } });
  const ids = enrol.map((e) => e.student.id);
  const nameOf = new Map(enrol.map((e) => [e.student.id, `${e.student.surname.toUpperCase()}, ${e.student.firstName}`]));
  const problems: PublishProblem[] = [];
  if (ids.length === 0) return { classId, className: klass.name, students: 0, ready: false, published: false, problems: [{ kind: 'NO_RESULTS', severity: 'block', message: 'No students are in this class this term' }] };

  // Subjects the students take, and the teacher assignments that cover them.
  const takes = await tx.studentSubject.findMany({ where: { schoolId, termId, studentId: { in: ids } }, select: { studentId: true, subjectId: true, subject: { select: { name: true } } } });
  const assignments = await tx.teacherAssignment.findMany({
    where: { schoolId, termId, status: 'ACTIVE', OR: [{ classId }, { group: { students: { some: { studentId: { in: ids } } } } }] },
    include: { subject: { select: { name: true } }, teacher: { select: { fullName: true } }, group: { select: { students: { where: { studentId: { in: ids } }, select: { studentId: true } } } } },
  });
  const covered = new Set<string>();
  for (const a of assignments) {
    const students = a.classId ? ids : a.group!.students.map((s) => s.studentId);
    for (const s of students) covered.add(`${s}|${a.subjectId}`);
  }
  const uncovered = new Map<string, number>();
  for (const t of takes) if (!covered.has(`${t.studentId}|${t.subjectId}`)) uncovered.set(t.subject.name, (uncovered.get(t.subject.name) ?? 0) + 1);
  if (uncovered.size) problems.push({ kind: 'NO_TEACHER', severity: 'block', message: 'Some subjects have no teacher assigned for this class', items: Array.from(uncovered).map(([n, c]) => `${n} (${c} student${c === 1 ? '' : 's'})`) });

  const sheets = await tx.markSheet.findMany({ where: { schoolId, termId, assignmentId: { in: assignments.map((a) => a.id) } }, select: { assignmentId: true, status: true } });
  const statusOf = new Map(sheets.map((s) => [s.assignmentId, s.status]));
  const notReady: string[] = [];
  const noPlan: string[] = [];
  for (const a of assignments) {
    const status: MarkSheetStatus = statusOf.get(a.id) ?? 'NOT_STARTED';
    if (status !== 'VERIFIED' && status !== 'PUBLISHED') notReady.push(`${a.subject.name} (${a.teacher.fullName}): ${status.toLowerCase().replace('_', ' ')}`);
  }
  if (notReady.length) problems.push({ kind: 'SHEET', severity: 'block', message: `${notReady.length} mark sheet(s) are not verified`, items: notReady });
  const planned = await tx.weightingPlan.findMany({ where: { schoolId, termId, levelId: klass.levelId }, select: { subjectId: true } });
  if (!planned.some((p) => p.subjectId === null)) for (const a of assignments) if (!planned.some((p) => p.subjectId === a.subjectId)) noPlan.push(a.subject.name);
  if (noPlan.length) problems.push({ kind: 'NO_PLAN', severity: 'block', message: 'No weighting plan is set for this level', items: Array.from(new Set(noPlan)) });

  const comments = await tx.reportComment.findMany({ where: { schoolId, termId, studentId: { in: ids } } });
  const noClass = ids.filter((id) => !comments.find((c) => c.studentId === id)?.classTeacherComment);
  if (noClass.length) problems.push({ kind: 'CLASS_COMMENT', severity: 'block', message: `${noClass.length} student(s) have no class teacher comment`, items: noClass.map((id) => nameOf.get(id)!) });
  const noHead = ids.filter((id) => !comments.find((c) => c.studentId === id)?.headRemark);
  if (noHead.length) problems.push({ kind: 'HEAD_REMARK', severity: 'block', message: `${noHead.length} student(s) have no Head's remark`, items: noHead.map((id) => nameOf.get(id)!) });

  const published = (await tx.termResult.count({ where: { schoolId, termId, studentId: { in: ids }, published: true } })) === ids.length;
  const others = await tx.markSheet.count({ where: { schoolId, termId, status: { in: ['NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'RETURNED', 'UNLOCKED'] }, assignment: { class: { levelId: klass.levelId, id: { not: classId } } } } });
  if (others > 0) problems.push({ kind: 'FORM_POSITIONS', severity: 'warn', message: `${others} mark sheet(s) in other classes of this form are not verified yet, so form positions are provisional until the whole form is published` });
  return { classId, className: klass.name, students: ids.length, ready: !problems.some((p) => p.severity === 'block'), published, problems };
}

export async function prePublishCheck(user: Actor, classId: string, termId?: string): Promise<PublishCheck> {
  if (!holds(user, 'exams.results.publish') && !holds(user, 'exams.results.view')) throw new ServiceError('Forbidden', 403);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await resolveTerm(tx, user.schoolId, termId);
    if (!(await tx.schoolClass.findFirst({ where: { id: classId, schoolId: user.schoolId }, select: { id: true } }))) throw new ServiceError('Class not found', 404);
    return checkClass(tx, user.schoolId, classId, term.id);
  });
}

// ─── Publishing ──────────────────────────────────────────────────────────────

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
function newCode(): string {
  const bytes = randomBytes(8);
  const pick = (i: number) => ALPHABET[bytes[i]! % ALPHABET.length]!;
  return `${[0, 1, 2, 3].map(pick).join('')}-${[4, 5, 6, 7].map(pick).join('')}`;
}

async function uniqueCode(tx: Db): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = newCode();
    if (!(await tx.termResult.findFirst({ where: { verificationCode: code }, select: { id: true } }))) return code;
  }
  throw new ServiceError('Could not make a verification code. Try again.', 500);
}

const PublishSchema = z.object({ termId: idSchema.optional(), classIds: z.array(idSchema).min(1).max(40) });

export interface PublishResult { classes: number; students: number; subjectResults: number }

/**
 * Publishes the results of one or more classes (a whole form is all its classes). Refuses while anything is missing. Recalculates
 * the whole level first, then freezes the rows, so one corrected mark that changed positions is always reflected.
 */
export async function publishClasses(user: Actor, raw: unknown): Promise<PublishResult> {
  const input = PublishSchema.parse(raw);
  if (!holds(user, 'exams.results.publish')) throw new ServiceError('Forbidden', 403);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sid = user.schoolId;
    const term = await resolveTerm(tx, sid, input.termId);
    if (term.status === 'CLOSED') throw new ServiceError(`${term.name} is closed`, 409);
    const classes = await tx.schoolClass.findMany({ where: { id: { in: input.classIds }, schoolId: sid }, select: { id: true, name: true, levelId: true } });
    if (classes.length !== new Set(input.classIds).size) throw new ServiceError('Class not found', 404);
    const blocked: string[] = [];
    for (const c of classes) {
      const check = await checkClass(tx, sid, c.id, term.id);
      if (!check.ready && !check.published) blocked.push(`${c.name}: ${check.problems.filter((p) => p.severity === 'block').map((p) => p.message).join('; ')}`);
    }
    if (blocked.length) throw new ServiceError(`Not ready to publish. ${blocked.join(' | ')}`, 409);

    // Whole levels are recalculated so positions are right; classes already published are left as they are.
    for (const levelId of Array.from(new Set(classes.map((c) => c.levelId)))) await recalculateLevel(tx, user, term.id, levelId);

    const nextTerm = await tx.academicTerm.findFirst({ where: { schoolId: sid, startDate: { gt: term.startDate } }, orderBy: { startDate: 'asc' }, select: { startDate: true } });
    const now = new Date();
    let students = 0;
    let subjectResults = 0;
    const teacherIds = new Set<string>();
    for (const c of classes) {
      const results = await tx.termResult.findMany({ where: { schoolId: sid, termId: term.id, classId: c.id, published: false } });
      if (results.length === 0) continue;
      const ids = results.map((r) => r.studentId);
      const scale = await scaleFor(tx, sid, c.levelId, term.id);
      const comments = await tx.reportComment.findMany({ where: { schoolId: sid, termId: term.id, studentId: { in: ids } } });

      // Attendance for the term from the daily registers (Academics), and conduct from Discipline.
      const registers = await tx.attendanceRegister.findMany({ where: { schoolId: sid, termId: term.id, classId: c.id, session: 'AM', slotId: null }, select: { id: true } });
      const entries = registers.length ? await tx.attendanceEntry.findMany({ where: { schoolId: sid, registerId: { in: registers.map((r) => r.id) }, studentId: { in: ids } }, select: { studentId: true, status: true } }) : [];
      const incidents = await tx.incidentStudent.groupBy({ by: ['studentId'], where: { schoolId: sid, studentId: { in: ids }, incident: { occurredAt: { gte: term.startDate, lte: new Date(term.endDate.getTime() + 86_400_000) } } }, _count: { _all: true } });

      for (const r of results) {
        const mine = entries.filter((e) => e.studentId === r.studentId);
        const present = mine.filter((e) => e.status === 'PRESENT' || e.status === 'LATE').length;
        const avg = num(r.averagePercentage);
        const overall = avg === null ? null : gradeOf(Math.floor(round2(avg) + 0.5), scale.scale).grade;
        const cm = comments.find((x) => x.studentId === r.studentId);
        await tx.termResult.update({
          where: { id: r.id },
          data: {
            published: true, publishedAt: now, letterGrade: overall, classTeacherRemark: cm?.classTeacherComment ?? null, headRemark: cm?.headRemark ?? null,
            daysPresent: registers.length ? present : null, daysAbsent: registers.length ? registers.length - present : null, timesLate: registers.length ? mine.filter((e) => e.status === 'LATE').length : null,
            schoolDays: registers.length || null, incidentCount: incidents.find((i) => i.studentId === r.studentId)?._count._all ?? 0,
            nextTermStartDate: nextTerm?.startDate ?? null, verificationCode: await uniqueCode(tx),
          },
        });
        students++;
      }
      const res = await tx.subjectResult.updateMany({ where: { schoolId: sid, termId: term.id, classId: c.id, studentId: { in: ids }, published: false }, data: { published: true, publishedAt: now } });
      subjectResults += res.count;

      // A sheet is published when every student on it is.
      const sheets = await tx.markSheet.findMany({ where: { schoolId: sid, termId: term.id, status: 'VERIFIED', assignment: { OR: [{ classId: c.id }, { group: { students: { some: { studentId: { in: ids } } } } }] } }, select: { id: true, assignmentId: true, status: true } });
      for (const s of sheets) {
        const unpublished = await tx.subjectResult.count({ where: { schoolId: sid, termId: term.id, assignmentId: s.assignmentId, published: false } });
        if (unpublished === 0) {
          await tx.markSheet.update({ where: { id: s.id }, data: { status: 'PUBLISHED' } });
          await tx.markSheetEvent.create({ data: { schoolId: sid, sheetId: s.id, action: 'PUBLISH', fromStatus: 'VERIFIED', toStatus: 'PUBLISHED', actorId: user.id } });
        }
      }
      const ta = await tx.teacherAssignment.findMany({ where: { schoolId: sid, termId: term.id, OR: [{ classId: c.id }] }, select: { teacherId: true, coTeacherId: true } });
      for (const t of ta) { teacherIds.add(t.teacherId); if (t.coTeacherId) teacherIds.add(t.coTeacherId); }
      const ct = await tx.classTeacher.findFirst({ where: { classId: c.id, termId: term.id }, select: { userId: true } });
      if (ct) teacherIds.add(ct.userId);
      await logAudit({ schoolId: sid, actorId: user.id, action: 'PUBLISH_CLASS_RESULTS', entityType: 'SchoolClass', entityId: c.id, detail: `Published ${c.name}, ${term.name}: ${results.length} student(s)` }, tx);
    }
    await notifyUsers(tx, sid, Array.from(teacherIds).filter((id) => id !== user.id), {
      type: 'RESULTS_PUBLISHED', title: `${term.name} results were published`, body: `Results for ${classes.map((c) => c.name).join(', ')} are published. Report cards are ready.`, link: '/exams/results', dedupeKey: `results-published:${term.id}:${classes.map((c) => c.id).sort().join(',')}:${now.getTime()}`,
    });
    return { classes: classes.length, students, subjectResults };
  }, { timeout: 120_000, maxWait: 20_000 });
}

const UnpublishSchema = z.object({ termId: idSchema.optional(), classIds: z.array(idSchema).min(1).max(40), reason: reasonSchema(5, 500) });

/**
 * Takes a class's results back: they disappear from report cards and the portal. The Head must then unlock the mark sheet to
 * correct it; republishing recalculates the whole class.
 */
export async function unpublishClasses(user: Actor, raw: unknown) {
  const input = UnpublishSchema.parse(raw);
  if (!holds(user, 'exams.results.unpublish')) throw new ServiceError('Forbidden', 403);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sid = user.schoolId;
    const term = await resolveTerm(tx, sid, input.termId);
    if (term.status === 'CLOSED') throw new ServiceError(`${term.name} is closed`, 409);
    const classes = await tx.schoolClass.findMany({ where: { id: { in: input.classIds }, schoolId: sid }, select: { id: true, name: true } });
    if (classes.length !== new Set(input.classIds).size) throw new ServiceError('Class not found', 404);
    let students = 0;
    const teacherIds = new Set<string>();
    for (const c of classes) {
      const rows = await tx.termResult.findMany({ where: { schoolId: sid, termId: term.id, classId: c.id, published: true }, select: { id: true, studentId: true } });
      if (rows.length === 0) throw new ServiceError(`${c.name} has no published results`, 409);
      const ids = rows.map((r) => r.studentId);
      await tx.subjectResult.updateMany({ where: { schoolId: sid, termId: term.id, studentId: { in: ids }, published: true }, data: { published: false, publishedAt: null } });
      await tx.termResult.updateMany({ where: { schoolId: sid, termId: term.id, id: { in: rows.map((r) => r.id) } }, data: { published: false, publishedAt: null, verificationCode: null } });
      const sheets = await tx.markSheet.findMany({ where: { schoolId: sid, termId: term.id, status: 'PUBLISHED', assignment: { OR: [{ classId: c.id }, { group: { students: { some: { studentId: { in: ids } } } } }] } }, select: { id: true } });
      for (const s of sheets) {
        await tx.markSheet.update({ where: { id: s.id }, data: { status: 'VERIFIED' } });
        await tx.markSheetEvent.create({ data: { schoolId: sid, sheetId: s.id, action: 'UNPUBLISH', fromStatus: 'PUBLISHED', toStatus: 'VERIFIED', actorId: user.id, comment: input.reason } });
      }
      const ta = await tx.teacherAssignment.findMany({ where: { schoolId: sid, termId: term.id, classId: c.id }, select: { teacherId: true, coTeacherId: true } });
      for (const t of ta) { teacherIds.add(t.teacherId); if (t.coTeacherId) teacherIds.add(t.coTeacherId); }
      const ct = await tx.classTeacher.findFirst({ where: { classId: c.id, termId: term.id }, select: { userId: true } });
      if (ct) teacherIds.add(ct.userId);
      students += rows.length;
      await logAudit({ schoolId: sid, actorId: user.id, action: 'UNPUBLISH_CLASS_RESULTS', entityType: 'SchoolClass', entityId: c.id, detail: `Unpublished ${c.name}, ${term.name}. Reason: ${input.reason}` }, tx);
    }
    await notifyUsers(tx, sid, Array.from(teacherIds).filter((id) => id !== user.id), {
      type: 'RESULTS_UNPUBLISHED', title: `${term.name} results were unpublished`, body: input.reason, link: '/exams/results', dedupeKey: `results-unpublished:${term.id}:${Date.now()}`,
    });
    return { classes: classes.length, students };
  }, { timeout: 60_000 });
}

// ─── Report cards ────────────────────────────────────────────────────────────

export interface ReportCardData {
  draft: boolean;
  school: SchoolLetterhead;
  term: { id: string; name: string };
  student: { id: string; name: string; admissionNumber: string; photoUrl: string | null; className: string };
  parts: { subjectPositions: boolean; classPosition: boolean; formPosition: boolean; typeScores: boolean; attendance: boolean; conduct: boolean; previousAverage: boolean; passes: boolean };
  planColumns: string[];
  subjects: { subject: string; typeScores: (number | null)[]; termMark: number; rounded: number; grade: string | null; position: string; comment: string | null; initials: string | null }[];
  summary: { average: number | null; overallGrade: string | null; classPosition: string; formPosition: string; passes: number | null; fivePasses: boolean | null; aLevelPoints: number | null; previousAverage: number | null; isOLevel: boolean };
  attendance: { present: number | null; schoolDays: number | null; late: number | null } | null;
  conduct: { incidents: number | null } | null;
  comments: { classTeacher: string | null; classTeacherName: string | null; head: string | null };
  nextTermStart: string | null;
  verificationCode: string | null;
}

/**
 * The data behind one report card. A published card is drawn from the frozen snapshot. The Head can also open a draft of a
 * class that is not published yet, clearly marked DRAFT.
 */
export async function reportCardData(user: Actor, studentId: string, termId?: string, opts: { draft?: boolean } = {}): Promise<ReportCardData> {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sid = user.schoolId;
    const term = await resolveTerm(tx, sid, termId);
    const tr = await tx.termResult.findFirst({ where: { schoolId: sid, termId: term.id, studentId } });
    if (!tr || !tr.classId) throw new ServiceError('There is no result for this student this term', 404);
    const own = await isClassTeacher(tx, sid, user.id, tr.classId, term.id);
    const mayRead = holds(user, 'exams.results.view') || holds(user, 'exams.reports.view') || holds(user, 'exams.results.publish') || own;
    if (!mayRead) throw new ServiceError('Student not found', 404);
    const draft = !tr.published;
    if (draft && !(opts.draft && (holds(user, 'exams.results.publish')))) throw new ServiceError('These results have not been published yet', 409);
    const [student, klass, subjects, settings, school, comment] = await Promise.all([
      tx.student.findFirstOrThrow({ where: { id: studentId, schoolId: sid }, select: { id: true, fullName: true, admissionNumber: true, photoUrl: true } }),
      tx.schoolClass.findFirstOrThrow({ where: { id: tr.classId, schoolId: sid }, select: { name: true, levelId: true, level: { select: { category: true } } } }),
      tx.subjectResult.findMany({ where: { schoolId: sid, termId: term.id, studentId, ...(draft ? {} : { published: true }) }, include: { subject: { select: { name: true } } }, orderBy: { subject: { name: 'asc' } } }),
      loadExamSettings(tx, sid),
      loadLetterhead(tx, sid),
      tx.reportComment.findFirst({ where: { schoolId: sid, termId: term.id, studentId } }),
    ]);
    const ctRow = await tx.classTeacher.findFirst({ where: { classId: tr.classId, termId: term.id }, select: { user: { select: { fullName: true } } } });
    const labels = Array.from(new Set(subjects.flatMap((s) => ((s.typeScores as { label: string }[] | null) ?? []).map((t) => t.label))));
    const scale = await scaleFor(tx, sid, klass.levelId, term.id);
    const avg = num(tr.averagePercentage ?? tr.percentage);
    const isOLevel = klass.level.category === 'O_LEVEL';
    return {
      draft, school, term: { id: term.id, name: term.name },
      student: { id: student.id, name: student.fullName, admissionNumber: student.admissionNumber, photoUrl: student.photoUrl, className: klass.name },
      parts: {
        subjectPositions: settings.showSubjectPositions, classPosition: settings.showClassPosition, formPosition: settings.showFormPosition, typeScores: settings.showTypeScores,
        attendance: settings.showAttendance, conduct: settings.showConduct, previousAverage: settings.showPreviousAverage, passes: true,
      },
      planColumns: labels,
      subjects: subjects.map((s) => {
        const ts = (s.typeScores as { label: string; score: number | null }[] | null) ?? [];
        return {
          subject: s.subject.name, typeScores: labels.map((l) => ts.find((t) => t.label === l)?.score ?? null), termMark: num(s.termMark)!, rounded: s.roundedMark, grade: s.grade,
          position: s.classPosition ? positionText({ position: s.classPosition, size: s.classSize ?? 0 }) : '', comment: s.teacherComment, initials: s.teacherInitials,
        };
      }),
      summary: {
        average: avg, overallGrade: tr.letterGrade ?? (avg === null ? null : gradeOf(Math.floor(round2(avg) + 0.5), scale.scale).grade),
        classPosition: tr.classPosition ? positionText({ position: tr.classPosition, size: tr.classSize ?? 0 }) : '',
        formPosition: tr.formPosition ? positionText({ position: tr.formPosition, size: tr.formSize ?? 0 }) : '',
        passes: tr.subjectsPassed, fivePasses: tr.fivePassesEngMaths, aLevelPoints: tr.aLevelPoints, previousAverage: num(tr.previousAverage), isOLevel,
      },
      attendance: tr.schoolDays ? { present: tr.daysPresent, schoolDays: tr.schoolDays, late: tr.timesLate } : null,
      conduct: tr.incidentCount !== null ? { incidents: tr.incidentCount } : null,
      comments: { classTeacher: tr.published ? tr.classTeacherRemark : comment?.classTeacherComment ?? null, classTeacherName: ctRow?.user.fullName ?? null, head: tr.published ? tr.headRemark : comment?.headRemark ?? null },
      nextTermStart: tr.nextTermStartDate ? tr.nextTermStartDate.toISOString().slice(0, 10) : null, verificationCode: tr.published ? tr.verificationCode : null,
    };
  });
}

/** The cards of a published class, for the combined class PDF. */
export async function classReportCards(user: Actor, classId: string, termId?: string, opts: { draft?: boolean } = {}): Promise<ReportCardData[]> {
  const ids = await getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await resolveTerm(tx, user.schoolId, termId);
    const rows = await tx.termResult.findMany({ where: { schoolId: user.schoolId, termId: term.id, classId }, select: { studentId: true, student: { select: { surname: true, firstName: true } } } });
    return { term: term.id, students: rows.sort((a, b) => a.student.surname.localeCompare(b.student.surname) || a.student.firstName.localeCompare(b.student.firstName)).map((r) => r.studentId) };
  });
  if (ids.students.length === 0) throw new ServiceError('There are no results for this class', 404);
  const cards: ReportCardData[] = [];
  for (const id of ids.students) cards.push(await reportCardData(user, id, ids.term, opts));
  return cards;
}

/** The public check of a report card's code: who, class, term and average, proving the card was not altered. */
export async function verifyReportCard(code: string) {
  const clean = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(clean)) return { valid: false as const };
  const { prisma } = await import('@/lib/prisma');
  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.school_id', '', true)`;
    return tx.termResult.findFirst({
      where: { verificationCode: clean, published: true },
      select: { averagePercentage: true, percentage: true, classPosition: true, classSize: true, publishedAt: true, student: { select: { fullName: true, admissionNumber: true } }, term: { select: { name: true } }, class: { select: { name: true } }, school: { select: { name: true } } },
    });
  });
  if (!rows) return { valid: false as const };
  return {
    valid: true as const, school: rows.school.name, student: rows.student.fullName, admissionNumber: rows.student.admissionNumber, className: rows.class?.name ?? '', term: rows.term.name,
    average: num(rows.averagePercentage ?? rows.percentage), position: rows.classPosition ? positionText({ position: rows.classPosition, size: rows.classSize ?? 0 }) : '', publishedOn: rows.publishedAt?.toISOString().slice(0, 10) ?? null,
  };
}


// ─── The results page ────────────────────────────────────────────────────────

export interface ResultsClass {
  classId: string; className: string; levelId: string; levelName: string; students: number; published: boolean; ready: boolean;
  blockers: string[]; warnings: string[]; publishedAt: string | null;
}

/** Every class with whether it can be published, and what stops it. A class teacher sees only their own classes. */
export async function resultsOverview(user: Actor, termId?: string): Promise<{ termId: string; termName: string; classes: ResultsClass[] }> {
  const wide = holds(user, 'exams.results.publish') || holds(user, 'exams.results.view') || holds(user, 'exams.results.unpublish');
  if (!wide && !holds(user, 'exams.comments.class')) throw new ServiceError('Forbidden', 403);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await resolveTerm(tx, user.schoolId, termId);
    const own = wide ? null : (await tx.classTeacher.findMany({ where: { schoolId: user.schoolId, termId: term.id, userId: user.id }, select: { classId: true } })).map((c) => c.classId);
    const classes = await tx.schoolClass.findMany({
      where: { schoolId: user.schoolId, active: true, ...(own ? { id: { in: own } } : {}), enrollments: { some: { termId: term.id, status: 'ACTIVE' } } },
      select: { id: true, name: true, level: { select: { id: true, name: true, order: true } } }, orderBy: [{ level: { order: 'asc' } }, { name: 'asc' }],
    });
    const out: ResultsClass[] = [];
    for (const c of classes) {
      const check = await checkClass(tx, user.schoolId, c.id, term.id);
      const pub = await tx.termResult.findFirst({ where: { schoolId: user.schoolId, termId: term.id, classId: c.id, published: true }, select: { publishedAt: true } });
      out.push({
        classId: c.id, className: c.name, levelId: c.level.id, levelName: c.level.name, students: check.students, published: check.published, ready: check.ready,
        blockers: check.problems.filter((p) => p.severity === 'block').map((p) => p.message), warnings: check.problems.filter((p) => p.severity === 'warn').map((p) => p.message),
        publishedAt: pub?.publishedAt?.toISOString() ?? null,
      });
    }
    return { termId: term.id, termName: term.name, classes: out };
  });
}
