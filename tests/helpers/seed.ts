// Two complete schools (A and B) with one user of every role and a little data
// in every school-owned table, so tests can prove A cannot touch B.
import bcrypt from 'bcryptjs';
import type { PrismaClient, Role } from '@prisma/client';
import { catalogue } from '../../prisma/seed/access';

export const ROLES: Role[] = ['ADMIN', 'DIRECTOR', 'HEAD', 'BURSAR', 'TEACHER', 'LIBRARIAN'];

export interface SeededUser {
  id: string;
  email: string;
  schoolId: string;
  role: Role;
  fullName: string;
}

export interface SeededSchool {
  schoolId: string;
  users: Record<Role, SeededUser>;
  /**
   * Somebody who holds every permission, through a custom role (seedSchool(..., { operator: true })). Nobody holds "*" any more, so the
   * tests that need "a person who may do anything" to set up or attack a school use this one; the tests about what the Owner or the
   * Administrator may or may not do use those roles.
   */
  operator?: SeededUser;
  /** A second person with the same everything role, for the tests where two different people must each do one step. */
  operator2?: SeededUser;
  levelId: string;
  classId: string;
  yearId: string;
  termId: string;
  subjectId: string;
  assignmentId: string;
  studentId: string;
  guardianId: string;
  chargeId: string;
  paymentId: string;          // PENDING, recorded by the bursar
  expenseId: string;
  requestId: string;          // PENDING, requested by the teacher
  feeStructureId: string;
  assetId: string;
  assetCategoryId: string;
  bookId: string;
  copyId: string;
  memberId: string;
  borrowingId: string;
  markId: string;
  boundaryId: string;
  categoryName: string;
}

let counter = 0;

export async function seedSchool(prisma: PrismaClient, name: string, opts: { operator?: boolean } = {}): Promise<SeededSchool> {
  const n = ++counter;
  const school = await prisma.school.create({ data: { name } });
  const schoolId = school.id;
  const passwordHash = await bcrypt.hash('Correct-horse-1', 4);

  const users = {} as SeededSchool['users'];
  for (const role of ROLES) {
    const u = await prisma.user.create({
      data: { schoolId, fullName: `${name} ${role}`, email: `${role.toLowerCase()}@school${n}.test`, role, passwordHash },
    });
    users[role] = { id: u.id, email: u.email, schoolId, role, fullName: u.fullName };
  }

  let operator: SeededUser | undefined;
  let operator2: SeededUser | undefined;
  if (opts.operator) {
    const role = await prisma.roleDefinition.create({ data: { schoolId, key: 'TEST_OPERATOR', name: 'Test operator', description: 'Holds every permission (tests only)', isSystem: false } });
    await prisma.rolePermission.createMany({ data: catalogue().map((c) => ({ schoolId, roleId: role.id, permissionKey: c.key, scope: 'SCHOOL' as const })) });
    const u = await prisma.user.create({ data: { schoolId, fullName: `${name} OPERATOR`, email: `operator@school${n}.test`, role: 'ADMIN', passwordHash } });
    await prisma.userRole.deleteMany({ where: { userId: u.id } });
    await prisma.userRole.create({ data: { schoolId, userId: u.id, roleId: role.id } });
    operator = { id: u.id, email: u.email, schoolId, role: 'ADMIN', fullName: u.fullName };
    const u2 = await prisma.user.create({ data: { schoolId, fullName: `${name} OPERATOR TWO`, email: `operator2@school${n}.test`, role: 'ADMIN', passwordHash } });
    await prisma.userRole.deleteMany({ where: { userId: u2.id } });
    await prisma.userRole.create({ data: { schoolId, userId: u2.id, roleId: role.id } });
    operator2 = { id: u2.id, email: u2.email, schoolId, role: 'ADMIN', fullName: u2.fullName };
  }

  const level = await prisma.level.create({ data: { schoolId, name: 'Form 1', order: 1, category: 'O_LEVEL' } });
  const klass = await prisma.schoolClass.create({
    data: { schoolId, name: 'Form 1 North', levelId: level.id, stream: 'North', classTeacherId: users.TEACHER.id },
  });
  // The class teacher holds the Class Teacher role, as the system gives it when a class teacher is named.
  const classTeacherRole = await prisma.roleDefinition.findFirst({ where: { schoolId, key: 'CLASS_TEACHER' } });
  if (classTeacherRole) await prisma.userRole.create({ data: { schoolId, userId: users.TEACHER.id, roleId: classTeacherRole.id } });
  const year = await prisma.academicYear.create({
    data: { schoolId, year: 2026, startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
  });
  const term = await prisma.academicTerm.create({
    data: {
      schoolId, academicYearId: year.id, termNumber: 1, name: 'Term 1 2026',
      startDate: new Date('2026-01-10'), endDate: new Date('2026-12-20'), status: 'OPEN',
    },
  });
  // The test operator is the alternate verifier of the department the seeded subject belongs to (only a Head of Department or the
  // alternate verifier may verify a mark sheet; nobody verifies "as the administrator" any more).
  let departmentId: string | undefined;
  if (operator) {
    departmentId = (await prisma.department.create({ data: { schoolId, name: 'Operator department' } })).id;
    await prisma.examDepartmentVerifier.create({ data: { schoolId, departmentId, userId: operator.id } });
  }
  const subject = await prisma.subject.create({ data: { schoolId, name: 'Maths', code: `MTH${n}`, ...(departmentId ? { departmentId } : {}) } });
  const assignment = await prisma.subjectAssignment.create({
    data: { schoolId, teacherId: users.TEACHER.id, subjectId: subject.id, classId: klass.id, termId: term.id, marksStatus: 'IN_PROGRESS' },
  });
  const student = await prisma.student.create({
    data: {
      schoolId, admissionNumber: `STU2026000${n}`, firstName: 'Tendai', surname: `Moyo${n}`, fullName: `Tendai Moyo${n}`,
      gender: 'M', admissionDate: new Date('2026-01-10'), currentClassId: klass.id,
    },
  });
  await prisma.enrollment.create({
    data: { schoolId, studentId: student.id, classId: klass.id, termId: term.id, startDate: new Date('2026-01-10') },
  });
  const guardian = await prisma.guardian.create({ data: { schoolId, fullName: 'Mrs Moyo', phone: '+263771234567' } });
  await prisma.studentGuardian.create({
    data: { studentId: student.id, guardianId: guardian.id, relationship: 'MOTHER', isPrimary: true },
  });
  const charge = await prisma.charge.create({
    data: { schoolId, studentId: student.id, termId: term.id, label: 'Tuition', currency: 'USD', amount: 100 },
  });
  const payment = await prisma.payment.create({
    data: {
      schoolId, studentId: student.id, currency: 'USD', amount: 50, method: 'ECOCASH', feeLabel: 'Tuition',
      status: 'PENDING', recordedBy: users.BURSAR.id,
    },
  });
  const expense = await prisma.expense.create({
    data: { schoolId, category: 'Fuel', currency: 'USD', amount: 20, spentOn: new Date(), recordedBy: users.BURSAR.id },
  });
  const request = await prisma.expenseRequest.create({
    data: {
      schoolId, requestNumber: `REQ-${n}`, title: 'Chalk', type: 'OTHER', department: 'Admin', justification: 'Need it',
      currency: 'USD', estimatedTotal: 10, status: 'PENDING', requestedById: users.TEACHER.id,
      items: { create: [{ description: 'Chalk', quantity: 1, unitPrice: 10, total: 10 }] },
    },
  });
  const fee = await prisma.feeStructure.create({
    data: { schoolId, termId: term.id, label: 'Tuition', currency: 'USD', amount: 100, levelId: level.id },
  });
  const cat = await prisma.assetCategory.create({ data: { schoolId, name: 'Furniture' } });
  const asset = await prisma.asset.create({
    data: {
      schoolId, name: 'Desk', categoryId: cat.id, tagNumber: `TAG${n}`, acquisitionDate: new Date(),
      acquisitionCost: 50, currency: 'USD', location: 'Block A',
    },
  });
  const book = await prisma.book.create({ data: { schoolId, title: 'Algebra', author: 'Smith' } });
  const copy = await prisma.bookCopy.create({ data: { schoolId, bookId: book.id, accessionNumber: `ACC${n}` } });
  const member = await prisma.libraryMember.create({ data: { schoolId, userId: users.TEACHER.id } });
  const boundary = await prisma.gradeBoundary.create({ data: { schoolId, minPercent: 0, maxPercent: 100, letterGrade: 'A' } });
  const borrowing = await prisma.borrowing.create({
    data: { schoolId, copyId: copy.id, memberId: member.id, checkoutDate: new Date(), dueDate: new Date(Date.now() + 14 * 864e5) },
  });
  await prisma.bookCopy.update({ where: { id: copy.id }, data: { status: 'BORROWED' } });
  const mark = await prisma.mark.create({
    data: {
      schoolId, studentId: student.id, subjectId: subject.id, termId: term.id, rawMark: 60, percentage: 60,
      status: 'DRAFT', enteredBy: users.TEACHER.id,
    },
  });

  return {
    schoolId, users, operator, operator2, levelId: level.id, classId: klass.id, yearId: year.id, termId: term.id, subjectId: subject.id,
    assignmentId: assignment.id, studentId: student.id, guardianId: guardian.id, chargeId: charge.id,
    paymentId: payment.id, expenseId: expense.id, requestId: request.id, feeStructureId: fee.id, assetId: asset.id,
    assetCategoryId: cat.id, bookId: book.id, copyId: copy.id, memberId: member.id, markId: mark.id,
    borrowingId: borrowing.id, boundaryId: boundary.id, categoryName: cat.name,
  };
}

/** Gives one of a school's roles one more permission (a data change, like an administrator would do). */
export async function grantPermission(prisma: PrismaClient, schoolId: string, roleKey: string, permissionKey: string, scope?: 'SCHOOL' | 'DEPARTMENT' | 'CLASS' | 'ASSIGNED' | 'HOSTEL' | 'STORE' | 'RECORDED_BY_ME' | 'SELF') {
  const role = await prisma.roleDefinition.findFirstOrThrow({ where: { schoolId, key: roleKey } });
  await prisma.rolePermission.upsert({
    where: { roleId_permissionKey: { roleId: role.id, permissionKey } },
    update: scope ? { scope } : {},
    create: { schoolId, roleId: role.id, permissionKey, ...(scope ? { scope } : {}) },
  });
}

export const revokePermission = (prisma: PrismaClient, schoolId: string, roleKey: string, permissionKey: string) =>
  prisma.rolePermission.deleteMany({ where: { schoolId, permissionKey, role: { key: roleKey } } });

/**
 * A user who holds exactly these roles (none at all gives somebody who can do nothing but look after their own account). The older
 * single `role` is only the level the pages written before roles were data check, so it stays TEACHER.
 */
export async function userWithRoles(prisma: PrismaClient, school: Pick<SeededSchool, 'schoolId'>, roleKeys: string[], label = 'extra'): Promise<SeededUser> {
  const n = ++counter;
  const u = await prisma.user.create({
    data: { schoolId: school.schoolId, fullName: `${label} ${n}`, email: `${label}${n}@extra.test`, role: 'TEACHER', passwordHash: await bcrypt.hash('Correct-horse-1', 4) },
  });
  await prisma.userRole.deleteMany({ where: { userId: u.id } });
  const roles = await prisma.roleDefinition.findMany({ where: { schoolId: school.schoolId, key: { in: roleKeys } } });
  for (const r of roles) await prisma.userRole.create({ data: { schoolId: school.schoolId, userId: u.id, roleId: r.id } });
  return { id: u.id, email: u.email, schoolId: school.schoolId, role: 'TEACHER', fullName: u.fullName };
}
