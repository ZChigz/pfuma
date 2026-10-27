// Builds a small school for the Examinations tests on top of the Academics world: a department with a Head of Department, an
// Exams Officer, a plan, and helpers to give students their subjects and enter marks straight into the database.
import type { PrismaClient } from '@prisma/client';
import type { SeededSchool } from './seed';
import { addTeacher, assign, buildWorld, students, type World } from './academics';

export interface ExamWorld extends World {
  hod: string;           // Head of the Sciences department (does not teach Form 2 East Maths)
  examsOfficer: string;
  types: Record<string, string>; // assessment type name -> id
}

export async function examWorld(prisma: PrismaClient, S: SeededSchool): Promise<ExamWorld> {
  const W = await buildWorld(prisma, S);
  // The seeded school-wide boundary (A for 0-100) would grade everyone A; the default O Level scale applies without it.
  await prisma.gradeBoundary.deleteMany({ where: { schoolId: S.schoolId } });
  const hod = await addTeacher(prisma, S, 'Mrs Hodge', ['HOD']);
  await prisma.department.update({ where: { id: W.dept.sciences }, data: { hodUserId: hod } });
  // The departments without a head have the test operator as their alternate verifier (only a Head of Department or the alternate may verify a sheet).
  if (S.operator) {
    for (const departmentId of [W.dept.languages, W.dept.humanities]) {
      await prisma.examDepartmentVerifier.create({ data: { schoolId: S.schoolId, departmentId, userId: S.operator.id } });
    }
  }
  const examsOfficer = await addTeacher(prisma, S, 'Mr Exams Officer', ['EXAMS_OFFICER']);
  return { ...W, hod, examsOfficer, types: {} };
}

/** Makes the students take the subject this term. */
export async function takeSubject(prisma: PrismaClient, S: SeededSchool, studentIds: string[], subjectId: string) {
  await prisma.studentSubject.createMany({ data: studentIds.map((studentId) => ({ schoolId: S.schoolId, studentId, subjectId, termId: S.termId, source: 'CORE' as const })), skipDuplicates: true });
}

/** A class with students taking a subject taught by a teacher. */
export async function classWith(prisma: PrismaClient, S: SeededSchool, o: { classId: string; subjectId: string; teacherId: string; count: number; prefix: string }) {
  const kids = await students(prisma, S, o.classId, o.count, o.prefix);
  await takeSubject(prisma, S, kids, o.subjectId);
  const assignment = await assign(prisma, S, { teacherId: o.teacherId, subjectId: o.subjectId, classId: o.classId });
  return { kids, assignmentId: assignment.id };
}

export async function typeIds(prisma: PrismaClient, S: SeededSchool): Promise<Record<string, string>> {
  const rows = await prisma.assessmentType.findMany({ where: { schoolId: S.schoolId } });
  return Object.fromEntries(rows.map((r) => [r.name, r.id]));
}
