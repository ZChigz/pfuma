// Teaching groups: an elective taught across classes ("Form 3 Accounts" takes the Accounts students of Form 3 North,
// South and East together). A group's students come from StudentSubject, so a student only appears in a group for a
// subject they actually take.
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { dedupe, idSchema, resolveTerm, writableTerm, type Actor } from '@/lib/academics/common';

export const GroupSchema = z.object({
  termId: idSchema.optional(),
  name: z.string().trim().min(2, 'Give the group a name').max(60),
  subjectId: idSchema,
  levelId: idSchema,
  /** Fill the group with everyone in the form who takes the subject (the default), or name the students. */
  studentIds: z.array(idSchema).max(500).optional(),
});
export type GroupInput = z.input<typeof GroupSchema>;

/** Students of the form who take the subject this term, from the Enrollment and the StudentSubject rows. */
async function takers(tx: Db, termId: string, levelId: string, subjectId: string): Promise<Map<string, { fullName: string; classId: string; className: string }>> {
  const rows = await tx.studentSubject.findMany({
    where: { termId, subjectId, student: { enrollments: { some: { termId, status: 'ACTIVE', class: { levelId } } } } },
    select: { studentId: true, student: { select: { fullName: true, enrollments: { where: { termId, status: 'ACTIVE' }, select: { classId: true, class: { select: { name: true } } } } } } },
  });
  return new Map(rows.map((r) => [r.studentId, { fullName: r.student.fullName, classId: r.student.enrollments[0]!.classId, className: r.student.enrollments[0]!.class.name }]));
}

async function checkOneGroupPerSubject(tx: Db, termId: string, subjectId: string, studentIds: string[], exceptGroupId: string | null) {
  const clash = await tx.teachingGroupStudent.findFirst({
    where: { studentId: { in: studentIds }, group: { termId, subjectId, ...(exceptGroupId ? { id: { not: exceptGroupId } } : {}) } },
    select: { student: { select: { fullName: true } }, group: { select: { name: true } } },
  });
  if (clash) throw new ServiceError(`${clash.student.fullName} is already in ${clash.group.name}, another group for this subject`, 409);
}

export async function saveGroup(user: Actor, id: string | null, raw: GroupInput) {
  const input = GroupSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    if (id && !(await tx.teachingGroup.findFirst({ where: { id }, select: { id: true } }))) throw new ServiceError('Teaching group not found', 404);
    const term = await writableTerm(tx, user.schoolId, input.termId);
    const [subject, level, offered] = await Promise.all([
      tx.subject.findFirst({ where: { id: input.subjectId } }),
      tx.level.findFirst({ where: { id: input.levelId } }),
      tx.subjectLevel.findFirst({ where: { subjectId: input.subjectId, levelId: input.levelId } }),
    ]);
    if (!subject) throw new ServiceError('Subject not found', 404);
    if (!level) throw new ServiceError('Form not found', 404);
    if (!offered) throw new ServiceError(`${subject.name} is not offered in ${level.name}`, 422);
    if (offered.type !== 'ELECTIVE') throw new ServiceError(`${subject.name} is a core subject in ${level.name}: it is taught to each class, not to a group`, 422);
    const clash = await tx.teachingGroup.findFirst({ where: { termId: term.id, name: { equals: input.name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) } });
    if (clash) throw new ServiceError(`There is already a group called ${clash.name} in ${term.name}`, 409);

    const all = await takers(tx, term.id, level.id, subject.id);
    const studentIds = input.studentIds ? dedupe(input.studentIds) : Array.from(all.keys());
    const notTaking = studentIds.find((s) => !all.has(s));
    if (notTaking) {
      const s = await tx.student.findFirst({ where: { id: notTaking }, select: { fullName: true } });
      throw new ServiceError(s ? `${s.fullName} does not take ${subject.name} in ${level.name} this term` : 'Student not found', s ? 422 : 404);
    }
    await checkOneGroupPerSubject(tx, term.id, subject.id, studentIds, id);

    let group: { id: string };
    if (id) {
      const cur = await tx.teachingGroup.findFirst({ where: { id } });
      if (!cur) throw new ServiceError('Teaching group not found', 404);
      if (cur.subjectId !== subject.id || cur.levelId !== level.id || cur.termId !== term.id) {
        const used = await tx.teacherAssignment.count({ where: { groupId: id } });
        if (used) throw new ServiceError('This group already has a teacher assigned, so its subject and form cannot change', 409);
      }
      await tx.teachingGroup.update({ where: { id }, data: { name: input.name, subjectId: subject.id, levelId: level.id } });
      await tx.teachingGroupStudent.deleteMany({ where: { groupId: id } });
      group = { id };
    } else {
      group = await tx.teachingGroup.create({ data: { schoolId: user.schoolId, termId: term.id, name: input.name, subjectId: subject.id, levelId: level.id } });
    }
    if (studentIds.length) await tx.teachingGroupStudent.createMany({ data: studentIds.map((studentId) => ({ schoolId: user.schoolId, groupId: group.id, studentId })) });
    await logAudit(
      { schoolId: user.schoolId, actorId: user.id, action: 'SAVE_TEACHING_GROUP', entityType: 'TeachingGroup', entityId: group.id, detail: `${input.name}: ${studentIds.length} students taking ${subject.name} (${term.name})`, after: { name: input.name, subject: subject.name, level: level.name, students: studentIds.length } },
      tx,
    );
    return { id: group.id, students: studentIds.length };
  });
}

/** Brings a group up to date with who takes the subject now (new takers join, students who dropped it leave). */
export async function syncGroup(user: Actor, id: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const g = await tx.teachingGroup.findFirst({ where: { id }, include: { subject: { select: { name: true } } } });
    if (!g) throw new ServiceError('Teaching group not found', 404);
    const term = await writableTerm(tx, user.schoolId, g.termId);
    const all = await takers(tx, term.id, g.levelId, g.subjectId);
    const members = await tx.teachingGroupStudent.findMany({ where: { groupId: id }, select: { studentId: true } });
    const have = new Set(members.map((m) => m.studentId));
    const add = Array.from(all.keys()).filter((s) => !have.has(s));
    await checkOneGroupPerSubject(tx, term.id, g.subjectId, add, id);
    const drop = members.filter((m) => !all.has(m.studentId)).map((m) => m.studentId);
    if (drop.length) await tx.teachingGroupStudent.deleteMany({ where: { groupId: id, studentId: { in: drop } } });
    if (add.length) await tx.teachingGroupStudent.createMany({ data: add.map((studentId) => ({ schoolId: user.schoolId, groupId: id, studentId })) });
    if (add.length || drop.length) {
      await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'SAVE_TEACHING_GROUP', entityType: 'TeachingGroup', entityId: id, detail: `${g.name}: refreshed from subject choices (+${add.length}, -${drop.length})`, after: { added: add.length, removed: drop.length } }, tx);
    }
    return { added: add.length, removed: drop.length };
  });
}

export async function deleteGroup(user: Actor, id: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const g = await tx.teachingGroup.findFirst({ where: { id } });
    if (!g) throw new ServiceError('Teaching group not found', 404);
    await writableTerm(tx, user.schoolId, g.termId);
    if (await tx.teacherAssignment.count({ where: { groupId: id } })) throw new ServiceError('This group has a teacher assigned (now or before), so it cannot be deleted', 409);
    await tx.teachingGroup.delete({ where: { id } });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'SAVE_TEACHING_GROUP', entityType: 'TeachingGroup', entityId: id, detail: `${g.name} deleted`, before: { name: g.name } }, tx);
  });
}

export async function listGroups(user: Actor, termId?: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await resolveTerm(tx, user.schoolId, termId);
    const groups = await tx.teachingGroup.findMany({
      where: { termId: term.id }, orderBy: { name: 'asc' },
      include: {
        subject: { select: { id: true, name: true } }, level: { select: { id: true, name: true } },
        students: { select: { studentId: true } },
        assignments: { where: { status: 'ACTIVE' }, select: { id: true, teacher: { select: { fullName: true } } } },
      },
    });
    const enrol = await tx.enrollment.findMany({ where: { termId: term.id, status: 'ACTIVE', studentId: { in: groups.flatMap((g) => g.students.map((s) => s.studentId)) } }, select: { studentId: true, class: { select: { name: true } } } });
    const classOf = new Map(enrol.map((e) => [e.studentId, e.class.name]));
    return {
      term: { id: term.id, name: term.name, status: term.status },
      groups: groups.map((g) => {
        const byClass = new Map<string, number>();
        for (const s of g.students) { const c = classOf.get(s.studentId) ?? '?'; byClass.set(c, (byClass.get(c) ?? 0) + 1); }
        return {
          id: g.id, name: g.name, subjectId: g.subject.id, subject: g.subject.name, levelId: g.level.id, level: g.level.name, students: g.students.length,
          classes: Array.from(byClass, ([name, count]) => ({ name, count })), teacher: g.assignments[0]?.teacher.fullName ?? null, assignmentId: g.assignments[0]?.id ?? null,
        };
      }),
    };
  });
}
