// Which subjects each class's students take, and whether a teacher is assigned to teach them.
// A student's class always comes from the Enrollment of the term. The subjects a student takes are the StudentSubject
// rows plus the core subjects of their form (so a school that has not given anyone subjects yet still sees its gaps).
import type { Db } from '@/lib/scoped-db';
import { dedupe } from '@/lib/academics/common';

export interface TakenSubject {
  subjectId: string;
  students: string[];
}

export interface ClassSubjects {
  classId: string;
  className: string;
  levelId: string;
  levelOrder: number;
  studentIds: string[];
  subjects: Map<string, TakenSubject>;
}

/** For each class of the term (or the given ones): its students and the subjects they take. */
export async function classSubjects(tx: Db, termId: string, classIds?: string[]): Promise<Map<string, ClassSubjects>> {
  const [classes, enrollments, chosen, core] = await Promise.all([
    tx.schoolClass.findMany({
      where: { active: true, level: { active: true }, ...(classIds ? { id: { in: classIds } } : {}) },
      select: { id: true, name: true, levelId: true, level: { select: { order: true } } },
    }),
    tx.enrollment.findMany({
      where: { termId, status: 'ACTIVE', ...(classIds ? { classId: { in: classIds } } : {}) },
      select: { classId: true, studentId: true },
    }),
    tx.studentSubject.findMany({
      where: { termId, subject: { active: true }, student: { enrollments: { some: { termId, status: 'ACTIVE', ...(classIds ? { classId: { in: classIds } } : {}) } } } },
      select: { studentId: true, subjectId: true },
    }),
    tx.subjectLevel.findMany({ where: { type: 'CORE', subject: { active: true } }, select: { levelId: true, subjectId: true } }),
  ]);
  const coreByLevel = new Map<string, string[]>();
  for (const c of core) coreByLevel.set(c.levelId, [...(coreByLevel.get(c.levelId) ?? []), c.subjectId]);
  const choicesByStudent = new Map<string, string[]>();
  for (const c of chosen) choicesByStudent.set(c.studentId, [...(choicesByStudent.get(c.studentId) ?? []), c.subjectId]);

  const out = new Map<string, ClassSubjects>();
  for (const c of classes) out.set(c.id, { classId: c.id, className: c.name, levelId: c.levelId, levelOrder: c.level.order, studentIds: [], subjects: new Map() });
  for (const e of enrollments) {
    const cls = out.get(e.classId);
    if (!cls) continue;
    cls.studentIds.push(e.studentId);
    for (const sid of dedupe([...(coreByLevel.get(cls.levelId) ?? []), ...(choicesByStudent.get(e.studentId) ?? [])])) {
      const t = cls.subjects.get(sid) ?? { subjectId: sid, students: [] };
      t.students.push(e.studentId);
      cls.subjects.set(sid, t);
    }
  }
  return out;
}

export interface Gap {
  classId: string;
  className: string;
  subjectId: string;
  subjectName: string;
  /** Students of the class who take the subject, and how many of them have nobody teaching it. */
  students: number;
  uncovered: number;
}

/**
 * Every subject a class takes that has no teacher. A subject is covered for a student when the class has a live
 * assignment for it, or the student is in a teaching group of that subject that has one.
 */
export async function findGaps(tx: Db, termId: string, classIds?: string[]): Promise<Gap[]> {
  const byClass = await classSubjects(tx, termId, classIds);
  const [assignments, subjects] = await Promise.all([
    tx.teacherAssignment.findMany({ where: { termId, status: 'ACTIVE' }, select: { classId: true, groupId: true, subjectId: true } }),
    tx.subject.findMany({ select: { id: true, name: true } }),
  ]);
  const name = new Map(subjects.map((s) => [s.id, s.name]));
  const classTaught = new Set(assignments.filter((a) => a.classId).map((a) => `${a.classId}:${a.subjectId}`));
  const groupIds = assignments.filter((a) => a.groupId).map((a) => a.groupId!);
  const members = groupIds.length
    ? await tx.teachingGroupStudent.findMany({ where: { groupId: { in: groupIds } }, select: { studentId: true, group: { select: { subjectId: true } } } })
    : [];
  const inGroup = new Set(members.map((m) => `${m.studentId}:${m.group.subjectId}`));

  const gaps: Gap[] = [];
  for (const cls of Array.from(byClass.values())) {
    for (const t of Array.from(cls.subjects.values())) {
      if (classTaught.has(`${cls.classId}:${t.subjectId}`)) continue;
      const uncovered = t.students.filter((s) => !inGroup.has(`${s}:${t.subjectId}`)).length;
      if (uncovered > 0) gaps.push({ classId: cls.classId, className: cls.className, subjectId: t.subjectId, subjectName: name.get(t.subjectId) ?? '', students: t.students.length, uncovered });
    }
  }
  return gaps.sort((a, b) => a.className.localeCompare(b.className, undefined, { numeric: true }) || a.subjectName.localeCompare(b.subjectName));
}
