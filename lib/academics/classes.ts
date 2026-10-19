// The Classes page: forms, streams and classes are created in School Settings; here the school runs them each term.
// The class list of a term, the class detail (students, subjects and their teachers, gaps), the class teacher
// (one per class per term, with the CLASS_TEACHER role scoped to the class) and "copy from last term".
import { z } from 'zod';
import type { AcademicTerm } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { notifyUsers } from '@/lib/system/notifications';
import {
  assertClassReachable, dedupe, idSchema, initialsOf, isoOf, previousTerm, reachableClassIds, resolveTerm, todayInHarare, toDay, writableTerm, type Actor,
} from '@/lib/academics/common';
import { classSubjects, findGaps } from '@/lib/academics/coverage';
import { grantScopedRole, revokeScopedRole } from '@/lib/academics/roles';
import { schoolDayInfo } from '@/lib/academics/school-days';
import { ensureCoreSubjects } from '@/lib/academics/student-subjects';
import { syncGroup } from '@/lib/academics/groups';

export type TimetableState = 'PUBLISHED' | 'DRAFT' | 'NONE';
export type TodayState = 'MARKED' | 'NOT_MARKED' | 'NO_SCHOOL';

export interface ClassRow {
  id: string; name: string; levelId: string; level: string; levelOrder: number; stream: string;
  classTeacherId: string | null; classTeacher: string | null; students: number; boys: number; girls: number; capacity: number;
  subjects: number; timetable: TimetableState; today: TodayState;
}

/** The classes of a term with their class teacher, size, subjects, timetable status and today's register. */
export async function listClasses(user: Actor, termId?: string) {
  const db = getScopedDb(user.schoolId, user.id);
  const base = await db.$tx(async (tx) => {
    const term = await resolveTerm(tx, user.schoolId, termId);
    const reach = await reachableClassIds(tx, user, term.id);
    const classes = await tx.schoolClass.findMany({
      where: { active: true, level: { active: true }, ...(reach === 'all' ? {} : { id: { in: reach } }) },
      orderBy: [{ level: { order: 'asc' } }, { stream: 'asc' }], include: { level: { select: { name: true, order: true } } },
    });
    const ids = classes.map((c) => c.id);
    const [teachers, enrol, assigned, working, published, registers] = await Promise.all([
      tx.classTeacher.findMany({ where: { termId: term.id, classId: { in: ids } }, select: { classId: true, userId: true, user: { select: { fullName: true } } } }),
      tx.enrollment.findMany({ where: { termId: term.id, status: 'ACTIVE', classId: { in: ids } }, select: { classId: true, student: { select: { gender: true } } } }),
      tx.teacherAssignment.groupBy({ by: ['classId'], where: { termId: term.id, status: 'ACTIVE', classId: { in: ids } }, _count: { _all: true } }),
      tx.timetable.findFirst({ where: { termId: term.id, status: { in: ['DRAFT', 'PENDING'] } }, select: { id: true } }),
      tx.timetable.findFirst({ where: { termId: term.id, status: 'PUBLISHED' }, select: { id: true } }),
      tx.attendanceRegister.findMany({ where: { termId: term.id, classId: { in: ids }, date: toDay(todayInHarare()), session: 'AM' }, select: { classId: true } }),
    ]);
    const slotClasses = async (timetableId: string | undefined) => new Set(timetableId ? (await tx.timetableSlot.findMany({ where: { timetableId, classId: { in: ids } }, select: { classId: true }, distinct: ['classId'] })).map((s) => s.classId!) : []);
    const [inWorking, inPublished] = await Promise.all([slotClasses(working?.id), slotClasses(published?.id)]);
    return { term, classes, teachers, enrol, assigned, inWorking, inPublished, marked: new Set(registers.map((r) => r.classId!)) };
  });
  const day = await schoolDayInfo(db, user, todayInHarare());
  const rows: ClassRow[] = base.classes.map((c) => {
    const ct = base.teachers.find((t) => t.classId === c.id);
    const here = base.enrol.filter((e) => e.classId === c.id);
    return {
      id: c.id, name: c.name, levelId: c.levelId, level: c.level.name, levelOrder: c.level.order, stream: c.stream,
      classTeacherId: ct?.userId ?? null, classTeacher: ct?.user.fullName ?? null, students: here.length,
      boys: here.filter((e) => e.student.gender === 'M').length, girls: here.filter((e) => e.student.gender === 'F').length, capacity: c.capacity,
      subjects: base.assigned.find((a) => a.classId === c.id)?._count._all ?? 0,
      timetable: base.inPublished.has(c.id) ? 'PUBLISHED' : base.inWorking.has(c.id) ? 'DRAFT' : 'NONE',
      today: !day.isSchoolDay || base.term.status === 'CLOSED' ? 'NO_SCHOOL' : base.marked.has(c.id) ? 'MARKED' : 'NOT_MARKED',
    };
  });
  return { term: { id: base.term.id, name: base.term.name, status: base.term.status }, classes: rows, schoolDay: day.isSchoolDay };
}

// ─── One class ───────────────────────────────────────────────────────────────

export async function classHeader(user: Actor, classId: string, termId?: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await resolveTerm(tx, user.schoolId, termId);
    await assertClassReachable(tx, user, classId, term.id);
    const c = await tx.schoolClass.findFirst({ where: { id: classId }, include: { level: { select: { id: true, name: true, order: true } } } });
    if (!c) throw new ServiceError('Class not found', 404);
    const [ct, enrol, subjects] = await Promise.all([
      tx.classTeacher.findUnique({ where: { classId_termId: { classId, termId: term.id } }, select: { userId: true, user: { select: { fullName: true } } } }),
      tx.enrollment.findMany({ where: { classId, termId: term.id, status: 'ACTIVE' }, select: { student: { select: { gender: true } } } }),
      tx.teacherAssignment.count({ where: { classId, termId: term.id, status: 'ACTIVE' } }),
    ]);
    return {
      term: { id: term.id, name: term.name, status: term.status }, id: c.id, name: c.name, level: c.level, stream: c.stream, capacity: c.capacity,
      classTeacherId: ct?.userId ?? null, classTeacher: ct?.user.fullName ?? null, students: enrol.length,
      boys: enrol.filter((e) => e.student.gender === 'M').length, girls: enrol.filter((e) => e.student.gender === 'F').length, subjects,
    };
  });
}

export interface ClassStudentRow { n: number; id: string; admissionNumber: string; fullName: string; surname: string; firstName: string; gender: string | null; boarding: string; status: string }

/** The class list from the Enrollment of the term, by surname, numbered. */
export async function classStudents(user: Actor, classId: string, termId?: string): Promise<{ className: string; termName: string; students: ClassStudentRow[] }> {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await resolveTerm(tx, user.schoolId, termId);
    await assertClassReachable(tx, user, classId, term.id);
    const c = await tx.schoolClass.findFirst({ where: { id: classId }, select: { name: true } });
    if (!c) throw new ServiceError('Class not found', 404);
    const rows = await tx.enrollment.findMany({
      where: { classId, termId: term.id, status: 'ACTIVE' },
      select: { student: { select: { id: true, admissionNumber: true, fullName: true, surname: true, firstName: true, gender: true, boarding: true, status: true } } },
    });
    const students = rows.map((r) => r.student).sort((a, b) => a.surname.localeCompare(b.surname) || a.firstName.localeCompare(b.firstName));
    return { className: c.name, termName: term.name, students: students.map((s, i) => ({ n: i + 1, ...s })) };
  });
}

export interface SubjectTeacherRow {
  subjectId: string; subject: string; shortName: string; colour: string; type: 'CORE' | 'ELECTIVE';
  teacher: string | null; initials: string | null; coTeacher: string | null; periodsPerWeek: number | null; via: 'CLASS' | 'GROUP' | null; groupName: string | null;
  students: number; uncovered: number; gap: boolean; assignmentId: string | null;
}

/** Every subject taught in the class and its teacher; a subject nobody teaches is a gap ("Geography has no teacher"). */
export async function classSubjectTeachers(user: Actor, classId: string, termId?: string): Promise<{ rows: SubjectTeacherRow[]; gaps: string[] }> {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await resolveTerm(tx, user.schoolId, termId);
    await assertClassReachable(tx, user, classId, term.id);
    const c = await tx.schoolClass.findFirst({ where: { id: classId }, select: { levelId: true } });
    if (!c) throw new ServiceError('Class not found', 404);
    const taken = (await classSubjects(tx, term.id, [classId])).get(classId);
    const [assignments, subjects, offered] = await Promise.all([
      tx.teacherAssignment.findMany({
        where: {
          termId: term.id, status: 'ACTIVE',
          OR: [{ classId }, { group: { students: { some: { student: { enrollments: { some: { termId: term.id, classId, status: 'ACTIVE' } } } } } } }],
        },
        include: { teacher: { select: { fullName: true } }, coTeacher: { select: { fullName: true } }, group: { select: { name: true } } },
      }),
      tx.subject.findMany({ select: { id: true, name: true, shortName: true, colour: true } }),
      tx.subjectLevel.findMany({ where: { levelId: c.levelId }, select: { subjectId: true, type: true } }),
    ]);
    const gapSet = new Map((await findGaps(tx, term.id, [classId])).map((g) => [g.subjectId, g]));
    const info = new Map(subjects.map((s) => [s.id, s]));
    const typeOf = new Map(offered.map((o) => [o.subjectId, o.type]));
    const ids = dedupe([...Array.from(taken?.subjects.keys() ?? []), ...assignments.map((a) => a.subjectId)]);
    const rows: SubjectTeacherRow[] = ids.map((sid) => {
      const s = info.get(sid)!;
      const a = assignments.find((x) => x.subjectId === sid && x.classId === classId) ?? assignments.find((x) => x.subjectId === sid);
      const gap = gapSet.get(sid);
      return {
        subjectId: sid, subject: s.name, shortName: s.shortName ?? s.name, colour: s.colour, type: typeOf.get(sid) ?? 'ELECTIVE',
        teacher: a?.teacher.fullName ?? null, initials: a ? initialsOf(a.teacher.fullName) : null, coTeacher: a?.coTeacher?.fullName ?? null, periodsPerWeek: a?.periodsPerWeek ?? null,
        via: a ? (a.classId ? ('CLASS' as const) : ('GROUP' as const)) : null, groupName: a?.group?.name ?? null, students: taken?.subjects.get(sid)?.students.length ?? 0, uncovered: gap?.uncovered ?? 0,
        gap: !!gap, assignmentId: a?.id ?? null,
      };
    }).sort((x, y) => (x.type === y.type ? x.subject.localeCompare(y.subject) : x.type === 'CORE' ? -1 : 1));
    return { rows, gaps: rows.filter((r) => r.gap).map((r) => `${r.subject} has no teacher`) };
  });
}

// ─── Class teacher ───────────────────────────────────────────────────────────

export const ClassTeacherSchema = z.object({ termId: idSchema.optional(), userId: idSchema.nullable() });

interface PlaceResult { warnings: string[]; changed: boolean }

/** Sets (or clears) the class teacher of a class in a term, keeping the scoped CLASS_TEACHER role and the old class column in step. */
async function placeClassTeacher(tx: Db, user: Actor, term: AcademicTerm, klass: { id: string; name: string }, userId: string | null): Promise<PlaceResult> {
  const cur = await tx.classTeacher.findUnique({ where: { classId_termId: { classId: klass.id, termId: term.id } }, include: { user: { select: { fullName: true } } } });
  if (cur?.userId === userId || (!cur && userId === null)) return { warnings: [], changed: false };
  const warnings: string[] = [];
  let person: { id: string; fullName: string } | null = null;
  if (userId) {
    const u = await tx.user.findFirst({ where: { id: userId, schoolId: user.schoolId, isSupport: false }, select: { id: true, fullName: true, active: true } });
    if (!u) throw new ServiceError('That person was not found', 404);
    if (!u.active) throw new ServiceError(`${u.fullName} is not an active user`, 409);
    person = u;
    const other = await tx.classTeacher.findFirst({ where: { termId: term.id, userId, classId: { not: klass.id } }, include: { class: { select: { name: true } } } });
    if (other) warnings.push(`${u.fullName} is already the class teacher of ${other.class.name}. A teacher normally looks after one class.`);
  }
  if (cur) {
    await tx.classTeacher.delete({ where: { id: cur.id } });
    const stillOther = await tx.classTeacher.count({ where: { userId: cur.userId, classId: klass.id, termId: { not: term.id } } });
    if (!stillOther) await revokeScopedRole(tx, user.schoolId, cur.userId, 'CLASS_TEACHER', 'CLASS', klass.id);
  }
  if (person) {
    await tx.classTeacher.create({ data: { schoolId: user.schoolId, classId: klass.id, termId: term.id, userId: person.id } });
    await grantScopedRole(tx, user.schoolId, person.id, 'CLASS_TEACHER', 'CLASS', klass.id);
  }
  // The older "class teacher" column on the class follows the open term (other pages still read it).
  if (term.status === 'OPEN') await tx.schoolClass.update({ where: { id: klass.id }, data: { classTeacherId: person?.id ?? null } });
  await logAudit(
    {
      schoolId: user.schoolId, actorId: user.id, action: 'SET_CLASS_TEACHER', entityType: 'SchoolClass', entityId: klass.id,
      detail: `${klass.name} (${term.name}): class teacher ${cur ? cur.user.fullName : 'none'} → ${person?.fullName ?? 'none'}`,
      before: { userId: cur?.userId ?? null, name: cur?.user.fullName ?? null }, after: { userId: person?.id ?? null, name: person?.fullName ?? null, term: term.name },
    },
    tx,
  );
  if (person && person.id !== user.id) {
    await notifyUsers(tx, user.schoolId, [person.id], { type: 'CLASS_TEACHER', title: `You are the class teacher of ${klass.name}`, body: `${term.name}. You mark the daily register for this class.`, link: '/academics/attendance' });
  }
  return { warnings, changed: true };
}

export async function setClassTeacher(user: Actor, classId: string, raw: z.input<typeof ClassTeacherSchema>) {
  const input = ClassTeacherSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await writableTerm(tx, user.schoolId, input.termId);
    const klass = await tx.schoolClass.findFirst({ where: { id: classId }, select: { id: true, name: true, active: true } });
    if (!klass) throw new ServiceError('Class not found', 404);
    if (!klass.active) throw new ServiceError(`${klass.name} is not in use`, 409);
    return placeClassTeacher(tx, user, term, klass, input.userId);
  });
}

// ─── Copy from last term ─────────────────────────────────────────────────────

export const CopySchema = z.object({
  termId: idSchema.optional(),
  classTeachers: z.boolean().default(true),
  assignments: z.boolean().default(true),
  studentSubjects: z.boolean().default(true),
});

/**
 * Copies the class teachers, teacher assignments (with teaching groups) and students' chosen subjects from the term before,
 * for the school to edit. Anything that no longer fits (a teacher who has left, a subject the form stopped offering) is
 * skipped and listed. Nothing that already exists in the term is changed.
 */
export async function copyFromLastTerm(user: Actor, raw: z.input<typeof CopySchema>) {
  const input = CopySchema.parse(raw);
  const result = await getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await writableTerm(tx, user.schoolId, input.termId);
    const prev = await previousTerm(tx, user.schoolId, term);
    if (!prev) throw new ServiceError('There is no earlier term to copy from', 409);
    const counts = { classTeachers: 0, assignments: 0, groups: 0, studentSubjects: 0 };
    const skipped: string[] = [];

    if (input.classTeachers) {
      const rows = await tx.classTeacher.findMany({ where: { termId: prev.id, class: { active: true, level: { active: true } } }, include: { class: { select: { id: true, name: true } }, user: { select: { fullName: true, active: true } } } });
      for (const r of rows) {
        if (!r.user.active) { skipped.push(`${r.class.name}: ${r.user.fullName} is no longer an active user`); continue; }
        if (await tx.classTeacher.findUnique({ where: { classId_termId: { classId: r.classId, termId: term.id } } })) continue;
        const res = await placeClassTeacher(tx, user, term, r.class, r.userId);
        if (res.changed) counts.classTeachers++;
      }
    }

    if (input.assignments) {
      const groupMap = new Map<string, string>(); // old group id → group in this term
      const old = await tx.teacherAssignment.findMany({
        where: { termId: prev.id, status: 'ACTIVE' },
        include: { subject: { select: { name: true, active: true } }, class: { select: { name: true, active: true, levelId: true } }, group: true, teacher: { select: { id: true, fullName: true, active: true, userRoles: { select: { role: { select: { key: true } } } } } } },
      });
      const offered = await tx.subjectLevel.findMany({ select: { subjectId: true, levelId: true } });
      const offeredSet = new Set(offered.map((o) => `${o.subjectId}:${o.levelId}`));
      for (const a of old) {
        const target = a.class?.name ?? a.group?.name ?? '';
        const why = !a.subject.active ? `${a.subject.name} is inactive`
          : !a.teacher.active ? `${a.teacher.fullName} is no longer an active user`
          : !a.teacher.userRoles.some((r) => r.role.key === 'TEACHER') ? `${a.teacher.fullName} no longer has the Teacher role`
          : a.class && !a.class.active ? `${a.class.name} is not in use`
          : !offeredSet.has(`${a.subjectId}:${a.class?.levelId ?? a.group!.levelId}`) ? `${a.subject.name} is no longer offered in that form` : null;
        if (why) { skipped.push(`${a.subject.name} for ${target}: ${why}`); continue; }
        let groupId: string | null = null;
        if (a.group) {
          groupId = groupMap.get(a.group.id) ?? null;
          if (!groupId) {
            const existing = await tx.teachingGroup.findFirst({ where: { termId: term.id, name: a.group.name } });
            const g = existing ?? await tx.teachingGroup.create({ data: { schoolId: user.schoolId, termId: term.id, name: a.group.name, subjectId: a.group.subjectId, levelId: a.group.levelId } });
            if (!existing) counts.groups++;
            groupId = g.id; groupMap.set(a.group.id, g.id);
          }
        }
        const live = await tx.teacherAssignment.findFirst({ where: { termId: term.id, subjectId: a.subjectId, status: 'ACTIVE', ...(a.classId ? { classId: a.classId } : { groupId }) } });
        if (live) continue;
        let coTeacherId = a.coTeacherId;
        if (coTeacherId) {
          const co = await tx.user.findFirst({ where: { id: coTeacherId, active: true }, select: { id: true } });
          if (!co) coTeacherId = null;
        }
        const row = await tx.teacherAssignment.create({
          data: { schoolId: user.schoolId, termId: term.id, teacherId: a.teacherId, coTeacherId, subjectId: a.subjectId, classId: a.classId, groupId, periodsPerWeek: a.periodsPerWeek, doublesPerWeek: a.doublesPerWeek, startDate: toDay(isoOf(term.startDate)) },
        });
        if (row.classId) {
          await tx.subjectAssignment.upsert({
            where: { subjectId_classId_termId: { subjectId: row.subjectId, classId: row.classId, termId: term.id } }, update: { teacherId: row.teacherId },
            create: { schoolId: user.schoolId, teacherId: row.teacherId, subjectId: row.subjectId, classId: row.classId, termId: term.id },
          });
        }
        counts.assignments++;
      }
    }

    if (input.studentSubjects) {
      await ensureCoreSubjects(tx, user, term.id);
      const [rows, enrol, offered] = await Promise.all([
        tx.studentSubject.findMany({ where: { termId: prev.id, source: { not: 'CORE' }, subject: { active: true } }, select: { studentId: true, subjectId: true, source: true } }),
        tx.enrollment.findMany({ where: { termId: term.id, status: 'ACTIVE' }, select: { studentId: true, class: { select: { levelId: true } } } }),
        tx.subjectLevel.findMany({ where: { type: 'ELECTIVE' }, select: { subjectId: true, levelId: true } }),
      ]);
      const levelOf = new Map(enrol.map((e) => [e.studentId, e.class.levelId]));
      const ok = new Set(offered.map((o) => `${o.subjectId}:${o.levelId}`));
      const data = rows.filter((r) => levelOf.has(r.studentId) && ok.has(`${r.subjectId}:${levelOf.get(r.studentId)}`))
        .map((r) => ({ schoolId: user.schoolId, studentId: r.studentId, subjectId: r.subjectId, termId: term.id, source: r.source }));
      if (data.length) counts.studentSubjects = (await tx.studentSubject.createMany({ data, skipDuplicates: true })).count;
    }

    await logAudit(
      {
        schoolId: user.schoolId, actorId: user.id, action: 'COPY_FROM_LAST_TERM', entityType: 'AcademicTerm', entityId: term.id,
        detail: `${term.name}: copied from ${prev.name} — ${counts.classTeachers} class teachers, ${counts.assignments} assignments, ${counts.groups} groups, ${counts.studentSubjects} subject choices; ${skipped.length} skipped`,
        after: { from: prev.name, ...counts, skipped: skipped.slice(0, 50) },
      },
      tx,
    );
    return { term: term.name, from: prev.name, ...counts, skipped, termId: term.id };
  });
  // Groups copied empty are filled from the subject choices that were just copied.
  if (input.assignments || input.studentSubjects) {
    const db = getScopedDb(user.schoolId, user.id);
    const groups = await db.teachingGroup.findMany({ where: { termId: result.termId }, select: { id: true } });
    for (const g of groups) await syncGroup(user, g.id).catch(() => null);
  }
  return result;
}

