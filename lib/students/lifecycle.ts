// Student lifecycle actions. Each action:
//  • checks the rule for every student first, then writes everything in one
//    transaction (a batch either fully succeeds or changes nothing);
//  • updates Enrollment and Student.status together, plus the cached
//    Student.currentClassId;
//  • writes one AuditLog row per student;
//  • never edits enrollments of past (CLOSED) terms.
// Admission lives in lib/students/server.ts (admitStudent).
import type { Prisma, StudentStatus } from '@prisma/client';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { suspendStudentMembers } from '@/lib/library';
import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { canGraduate, nextLevelOrder } from '@/lib/academic/rules';
import { requireOpenTerm, requireTerm } from '@/lib/academic/terms';
import { findOrCreateClass } from '@/lib/students/server';

type Tx = Db;

const ENROLLABLE: StudentStatus[] = ['ACTIVE', 'SUSPENDED'];

async function loadStudents(tx: Tx, schoolId: string, studentIds: string[]) {
  const ids = Array.from(new Set(studentIds));
  const students = await tx.student.findMany({
    where: { id: { in: ids }, schoolId },
    select: { id: true, fullName: true, status: true },
  });
  if (students.length !== ids.length) throw new ServiceError('One or more students were not found in this school', 404);
  return students;
}

async function requireClass(tx: Tx, schoolId: string, classId: string) {
  const c = await tx.schoolClass.findFirst({ where: { id: classId, schoolId }, include: { level: true } });
  if (!c) throw new ServiceError('Class not found', 404);
  if (!c.active) throw new ServiceError(`${c.name} is inactive`, 409);
  return c;
}

// ─── Transfer class (within the open term) ───────────────────────────────────

export async function transferClass(schoolId: string, actorId: string, studentIds: string[], classId: string) {
  return getScopedDb(schoolId, actorId).$tx(async (tx) => {
    const term = await requireOpenTerm(schoolId, tx);
    const target = await requireClass(tx, schoolId, classId);
    const students = await loadStudents(tx, schoolId, studentIds);

    const notEnrollable = students.filter((s) => !ENROLLABLE.includes(s.status));
    if (notEnrollable.length) {
      throw new ServiceError(`Only active students can change class: ${notEnrollable.map((s) => s.fullName).join(', ')}`, 409);
    }

    const current = await tx.enrollment.findMany({
      where: { termId: term.id, studentId: { in: students.map((s) => s.id) } },
      include: { class: { select: { name: true } } },
    });
    const byStudent = new Map(current.map((e) => [e.studentId, e]));
    const ended = current.filter((e) => e.status !== 'ACTIVE');
    if (ended.length) {
      throw new ServiceError(`These students have left ${term.name} and cannot be moved: ${ended.map((e) => students.find((s) => s.id === e.studentId)?.fullName).join(', ')}`, 409);
    }

    let moved = 0;
    for (const s of students) {
      const enrollment = byStudent.get(s.id);
      if (enrollment?.classId === target.id) continue;
      if (enrollment) {
        await tx.enrollment.update({ where: { id: enrollment.id }, data: { classId: target.id } });
      } else {
        await tx.enrollment.create({
          data: { schoolId, studentId: s.id, classId: target.id, termId: term.id, status: 'ACTIVE', startDate: new Date() },
        });
      }
      await tx.student.update({ where: { id: s.id }, data: { currentClassId: target.id } });
      await logAudit(
        {
          schoolId, actorId, action: 'TRANSFER_CLASS', entityType: 'Student', entityId: s.id,
          detail: `${s.fullName}: ${enrollment ? enrollment.class.name : 'no class'} → ${target.name} (${term.name})`,
        },
        tx,
      );
      moved++;
    }
    return { moved, termName: term.name, className: target.name };
  });
}

// ─── End of year: promote / repeat ───────────────────────────────────────────

interface YearEndInput {
  studentIds: string[];
  sourceTermId?: string;  // default: the open term
  targetClassId?: string; // default: same stream at the next (promote) / same (repeat) level
}

async function yearEnd(schoolId: string, actorId: string, input: YearEndInput, mode: 'PROMOTE' | 'REPEAT') {
  return getScopedDb(schoolId, actorId).$tx(async (tx) => {
    const source = input.sourceTermId
      ? await requireTerm(schoolId, input.sourceTermId, tx)
      : await requireOpenTerm(schoolId, tx);
    if (source.termNumber !== 3) {
      throw new ServiceError(`Promotion and repeating happen at the end of the year — ${source.name} is not the last term`, 409);
    }
    const sourceYear = await tx.academicYear.findUniqueOrThrow({ where: { id: source.academicYearId } });
    const targetTerm = await tx.academicTerm.findFirst({
      where: { schoolId, termNumber: 1, academicYear: { year: sourceYear.year + 1 } },
    });
    if (!targetTerm) {
      throw new ServiceError(`Create the ${sourceYear.year + 1} academic year under Admin → Academic calendar first`, 409);
    }

    const students = await loadStudents(tx, schoolId, input.studentIds);
    const inactive = students.filter((s) => s.status !== 'ACTIVE');
    if (inactive.length) throw new ServiceError(`Only active students can be ${mode === 'PROMOTE' ? 'promoted' : 'kept back'}: ${inactive.map((s) => s.fullName).join(', ')}`, 409);

    const enrollments = await tx.enrollment.findMany({
      where: { termId: source.id, studentId: { in: students.map((s) => s.id) } },
      include: { class: { include: { level: true } } },
    });
    const byStudent = new Map(enrollments.map((e) => [e.studentId, e]));
    const already = await tx.enrollment.findMany({
      where: { termId: targetTerm.id, studentId: { in: students.map((s) => s.id) } },
      select: { studentId: true },
    });
    const alreadyIds = new Set(already.map((a) => a.studentId));

    const explicitTarget = input.targetClassId ? await requireClass(tx, schoolId, input.targetClassId) : null;

    // Validate everyone before writing anything.
    const plan: { student: (typeof students)[number]; from: (typeof enrollments)[number]; levelName: string; stream: string }[] = [];
    for (const s of students) {
      const from = byStudent.get(s.id);
      if (!from || from.status !== 'ACTIVE') throw new ServiceError(`${s.fullName} has no active class in ${source.name}`, 409);
      if (alreadyIds.has(s.id)) throw new ServiceError(`${s.fullName} already has a class for ${targetTerm.name}`, 409);

      const order = from.class.level.order;
      let targetOrder = order;
      if (mode === 'PROMOTE') {
        const next = nextLevelOrder(order);
        if (!next) throw new ServiceError(`${s.fullName} is in ${from.class.level.name} — Form 6 students graduate instead of being promoted`, 409);
        targetOrder = next;
      }
      if (explicitTarget && explicitTarget.level.order !== targetOrder) {
        throw new ServiceError(`${explicitTarget.name} is not a Form ${targetOrder} class, so ${s.fullName} cannot go there`, 409);
      }
      plan.push({
        student: s,
        from,
        levelName: explicitTarget ? explicitTarget.level.name : `Form ${targetOrder}`,
        stream: explicitTarget ? explicitTarget.stream : from.class.stream,
      });
    }

    const results: { studentId: string; className: string }[] = [];
    for (const p of plan) {
      const target = explicitTarget ?? (mode === 'REPEAT' ? p.from.class : await findOrCreateClass(tx, schoolId, actorId, p.levelName, p.stream));
      await tx.enrollment.update({
        where: { id: p.from.id },
        data: { status: mode === 'PROMOTE' ? 'PROMOTED' : 'REPEATED', endDate: p.from.endDate ?? source.endDate },
      });
      await tx.enrollment.create({
        data: { schoolId, studentId: p.student.id, classId: target.id, termId: targetTerm.id, status: 'ACTIVE', startDate: targetTerm.startDate },
      });
      if (targetTerm.status === 'OPEN') {
        await tx.student.update({ where: { id: p.student.id }, data: { currentClassId: target.id } });
      }
      await logAudit(
        {
          schoolId, actorId,
          action: mode === 'PROMOTE' ? 'PROMOTE_STUDENT' : 'REPEAT_STUDENT',
          entityType: 'Student', entityId: p.student.id,
          detail: `${p.student.fullName}: ${p.from.class.name} (${source.name}) → ${target.name} (${targetTerm.name})`,
        },
        tx,
      );
      results.push({ studentId: p.student.id, className: target.name });
    }
    return { count: results.length, targetTerm: targetTerm.name, results };
  });
}

export const promoteStudents = (schoolId: string, actorId: string, input: YearEndInput) => yearEnd(schoolId, actorId, input, 'PROMOTE');
export const repeatStudents = (schoolId: string, actorId: string, input: YearEndInput) => yearEnd(schoolId, actorId, input, 'REPEAT');

// ─── Leaving: graduate / transfer out / withdraw ─────────────────────────────

type LeaveMode = 'GRADUATE' | 'TRANSFER_OUT' | 'WITHDRAW';

const LEAVE: Record<LeaveMode, {
  enrollment: 'GRADUATED' | 'TRANSFERRED_OUT' | 'WITHDRAWN';
  student: StudentStatus;
  audit: 'GRADUATE_STUDENT' | 'TRANSFER_OUT_STUDENT' | 'WITHDRAW_STUDENT';
  verb: string;
  allowedFrom: StudentStatus[];
}> = {
  GRADUATE:     { enrollment: 'GRADUATED',       student: 'GRADUATED',   audit: 'GRADUATE_STUDENT',     verb: 'graduated',      allowedFrom: ['ACTIVE'] },
  TRANSFER_OUT: { enrollment: 'TRANSFERRED_OUT', student: 'TRANSFERRED', audit: 'TRANSFER_OUT_STUDENT', verb: 'transferred out', allowedFrom: ['ACTIVE', 'SUSPENDED'] },
  WITHDRAW:     { enrollment: 'WITHDRAWN',       student: 'WITHDRAWN',   audit: 'WITHDRAW_STUDENT',     verb: 'withdrawn',      allowedFrom: ['ACTIVE', 'SUSPENDED'] },
};

async function leave(schoolId: string, actorId: string, studentIds: string[], mode: LeaveMode, reason?: string) {
  const rule = LEAVE[mode];
  return getScopedDb(schoolId, actorId).$tx(async (tx) => {
    const students = await loadStudents(tx, schoolId, studentIds);
    const wrong = students.filter((s) => !rule.allowedFrom.includes(s.status));
    if (wrong.length) throw new ServiceError(`These students cannot be ${rule.verb}: ${wrong.map((s) => `${s.fullName} (${s.status.toLowerCase()})`).join(', ')}`, 409);

    // Where the student is now: the open term's enrollment, otherwise their most
    // recent one (e.g. Term 3 just closed). Its status records how they left;
    // older terms are never touched.
    const current = await tx.enrollment.findMany({
      where: { studentId: { in: students.map((s) => s.id) }, status: 'ACTIVE' },
      include: { term: true, class: { include: { level: true } } },
      orderBy: { term: { startDate: 'desc' } },
    });
    const now = new Date();

    for (const s of students) {
      const mine = current.filter((e) => e.studentId === s.id);
      const nowEnrollment = mine.find((e) => e.term.status === 'OPEN') ?? mine.find((e) => e.term.status === 'CLOSED');
      if (mode === 'GRADUATE') {
        if (!nowEnrollment) throw new ServiceError(`${s.fullName} has no current class`, 409);
        if (!canGraduate(nowEnrollment.class.level.order)) {
          throw new ServiceError(`${s.fullName} is in ${nowEnrollment.class.level.name} — only Form 4 and Form 6 students can graduate`, 409);
        }
      }
      if (nowEnrollment) {
        await tx.enrollment.update({
          where: { id: nowEnrollment.id },
          data: { status: rule.enrollment, endDate: nowEnrollment.term.status === 'OPEN' ? now : nowEnrollment.endDate ?? nowEnrollment.term.endDate },
        });
      }
      // Places already booked in future (PLANNED) terms are cancelled.
      const future = mine.filter((e) => e.id !== nowEnrollment?.id && e.term.status === 'PLANNED');
      if (future.length) await tx.enrollment.deleteMany({ where: { id: { in: future.map((e) => e.id) } } });

      await tx.student.update({ where: { id: s.id }, data: { status: rule.student, currentClassId: null } });
      await logAudit(
        {
          schoolId, actorId, action: rule.audit, entityType: 'Student', entityId: s.id,
          detail: `${s.fullName}${nowEnrollment ? ` from ${nowEnrollment.class.name} (${nowEnrollment.term.name})` : ''}${reason ? ` — ${reason}` : ''}`,
        },
        tx,
      );
    }
    // They can no longer borrow; books they still hold stay on loan until returned.
    await suspendStudentMembers(tx, schoolId, actorId, students.map((s) => s.id), `Student ${rule.verb}`);
    return { count: students.length };
  });
}

export const graduateStudents   = (schoolId: string, actorId: string, studentIds: string[], reason?: string) => leave(schoolId, actorId, studentIds, 'GRADUATE', reason);
export const transferOutStudents = (schoolId: string, actorId: string, studentIds: string[], reason?: string) => leave(schoolId, actorId, studentIds, 'TRANSFER_OUT', reason);
export const withdrawStudents   = (schoolId: string, actorId: string, studentIds: string[], reason?: string) => leave(schoolId, actorId, studentIds, 'WITHDRAW', reason);
