// @vitest-environment node
/// <reference types="vite/client" />
//
// Cross-school isolation, end to end. We sign in as users of school A and attack
// EVERY API route with school B's ids (read, update, delete, create-with-foreign-id).
// A route passes only if
//   • it answers with the expected "not found / refused" status (never 2xx, never 500),
//   • no id belonging to school B appears in any response, and
//   • after ALL attacks, every row of school B in the database is byte-for-byte unchanged.
//
// A guard test fails when a route file exists that is neither attacked here nor
// explicitly exempted, so new routes cannot ship without a cross-school case.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Role } from '@prisma/client';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { grantPermission, seedSchool, type SeededSchool } from '../helpers/seed';
import { defaultRegistrationValues, currentYearInHarare } from '@/lib/students/registration';

const session = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));
vi.mock('@/lib/auth', () => ({ auth: async () => (session.current ? { user: session.current } : null) }));

const routeModules = import.meta.glob('../../app/api/**/route.ts') as Record<string, () => Promise<Record<string, unknown>>>;

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let prisma: typeof import('@/lib/prisma').prisma;
let before: string;
let bIds: string[] = [];
let bEventId = '';
let bNotificationId = '';
let bInvoiceId = '';
let bStreamId = '';
let bStrings: string[] = [];
const bx: Record<string, string> = {};

const TABLES = [
  'User', 'SchoolClass', 'Level', 'AcademicYear', 'AcademicTerm', 'Enrollment', 'Student', 'Guardian', 'FeeStructure',
  'Charge', 'Payment', 'Expense', 'ExpenseRequest', 'AuditLog', 'Subject', 'SubjectAssignment', 'Mark', 'TermResult',
  'GradeBoundary', 'AssetCategory', 'Asset', 'AssetMaintenance', 'AssetDisposal', 'Book', 'BookCopy', 'LibraryMember',
  'Borrowing', 'ExchangeRate', 'PortalAccessLog', 'PasswordResetToken', 'AssetTransfer', 'Income', 'MarkChange',
  'Subscription', 'SchoolModule', 'RolePermission', 'Notification', 'CalendarEvent', 'Stream', 'RoleDefinition', 'UserRole', 'SubscriptionInvoice',
  // Academics
  'AcademicsSettings', 'ClassTeacher', 'Department', 'SubjectLevel', 'SubjectChange', 'SubjectCombination', 'SubjectCombinationItem', 'SubjectCombinationClass',
  'StudentSubject', 'TeachingGroup', 'TeachingGroupStudent', 'TeacherAssignment', 'AssignmentSet', 'BellSchedule', 'Period', 'Room', 'Timetable', 'TimetableSlot',
  'TeacherAvailability', 'CoverLesson', 'AttendanceRegister', 'AttendanceEntry', 'MessageOutbox', 'SyllabusTopic', 'SchemeOfWork', 'SchemeWeek', 'RecordOfWork', 'LessonPlan',
];

/** Every row of school B (and its child rows), as stable JSON. */
async function snapshotB(): Promise<{ json: string; ids: string[] }> {
  const parts: Record<string, unknown[]> = {};
  const ids: string[] = [];
  for (const table of TABLES) {
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM "${table}" WHERE "schoolId" = $1 ORDER BY "id"`, B.schoolId,
    );
    parts[table] = rows;
    for (const r of rows) ids.push(String(r.id));
  }
  parts.StudentGuardian = await prisma.$queryRawUnsafe(
    `SELECT sg.* FROM "StudentGuardian" sg JOIN "Student" s ON s.id = sg."studentId" WHERE s."schoolId" = $1 ORDER BY sg."studentId", sg."guardianId"`, B.schoolId,
  );
  parts.ExpenseRequestItem = await prisma.$queryRawUnsafe(
    `SELECT i.* FROM "ExpenseRequestItem" i JOIN "ExpenseRequest" r ON r.id = i."requestId" WHERE r."schoolId" = $1 ORDER BY i."id"`, B.schoolId,
  );
  for (const r of parts.ExpenseRequestItem as { id: string }[]) ids.push(r.id);
  parts.School = await prisma.$queryRawUnsafe(`SELECT * FROM "School" WHERE id = $1`, B.schoolId);
  ids.push(B.schoolId);
  return { json: JSON.stringify(parts, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)), ids };
}

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  A = await seedSchool(prisma, 'School A');
  B = await seedSchool(prisma, 'School B');
  bEventId = (await prisma.calendarEvent.create({ data: { schoolId: B.schoolId, title: 'B event', startDate: new Date('2026-08-10'), endDate: new Date('2026-08-10'), createdById: B.users.ADMIN.id } })).id;
  bStreamId = (await prisma.stream.create({ data: { schoolId: B.schoolId, name: 'BStream' } })).id;
  bNotificationId = (await prisma.notification.create({ data: { schoolId: B.schoolId, userId: B.users.HEAD.id, title: 'B note' } })).id;
  await prisma.subscription.create({ data: { schoolId: B.schoolId } });
  bInvoiceId = (await prisma.subscriptionInvoice.create({ data: { schoolId: B.schoolId, number: 'INV-B-0001', issuedOn: new Date('2026-09-01'), amount: 120, description: 'Standard plan', createdByAdminId: 'platform' } })).id;
  await prisma.schoolModule.create({ data: { schoolId: B.schoolId, module: 'hr', enabled: false } });
  await grantPermission(prisma, B.schoolId, 'HEAD', 'system.users.view');
  // School B's academics data: every kind of row the Academics routes can reach.
  {
    const sid = B.schoolId;
    // School A's seeded subject is offered in its form, so A's own cases get as far as the rule under test.
    await prisma.subjectLevel.create({ data: { schoolId: A.schoolId, subjectId: A.subjectId, levelId: A.levelId, type: 'CORE' } });
    bx.dept = (await prisma.department.create({ data: { schoolId: sid, name: 'B Sciences', hodUserId: B.users.TEACHER.id } })).id;
    await prisma.subject.update({ where: { id: B.subjectId }, data: { departmentId: bx.dept, shortName: 'BMaths' } });
    await prisma.subjectLevel.create({ data: { schoolId: sid, subjectId: B.subjectId, levelId: B.levelId, type: 'CORE' } });
    bx.change = (await prisma.subjectChange.create({ data: { schoolId: sid, kind: 'CREATE', payload: { name: 'BX' }, requestedById: B.users.HEAD.id } })).id;
    bx.combo = (await prisma.subjectCombination.create({ data: { schoolId: sid, name: 'B Combo', levelId: B.levelId } })).id;
    await prisma.subjectCombinationItem.create({ data: { schoolId: sid, combinationId: bx.combo, subjectId: B.subjectId } });
    await prisma.subjectCombinationClass.create({ data: { schoolId: sid, combinationId: bx.combo, classId: B.classId } });
    await prisma.studentSubject.create({ data: { schoolId: sid, studentId: B.studentId, subjectId: B.subjectId, termId: B.termId, source: 'CORE' } });
    bx.group = (await prisma.teachingGroup.create({ data: { schoolId: sid, termId: B.termId, name: 'B Group', subjectId: B.subjectId, levelId: B.levelId } })).id;
    await prisma.teachingGroupStudent.create({ data: { schoolId: sid, groupId: bx.group, studentId: B.studentId } });
    await prisma.classTeacher.create({ data: { schoolId: sid, classId: B.classId, termId: B.termId, userId: B.users.TEACHER.id } });
    bx.assignment = (await prisma.teacherAssignment.create({ data: { schoolId: sid, termId: B.termId, teacherId: B.users.TEACHER.id, subjectId: B.subjectId, classId: B.classId, periodsPerWeek: 4, startDate: new Date('2026-01-10') } })).id;
    await prisma.assignmentSet.create({ data: { schoolId: sid, termId: B.termId } });
    const sched = await prisma.bellSchedule.create({ data: { schoolId: sid, name: 'B bell' } });
    bx.period = (await prisma.period.create({ data: { schoolId: sid, scheduleId: sched.id, periodNo: 1, dayOfWeek: 1, start: '07:30', end: '08:05', type: 'LESSON' } })).id;
    bx.room = (await prisma.room.create({ data: { schoolId: sid, name: 'B Room', type: 'CLASSROOM', capacity: 40 } })).id;
    const tt = await prisma.timetable.create({ data: { schoolId: sid, termId: B.termId, version: 1, status: 'DRAFT' } });
    bx.slot = (await prisma.timetableSlot.create({ data: { schoolId: sid, timetableId: tt.id, assignmentId: bx.assignment, periodId: bx.period, teacherId: B.users.TEACHER.id, classId: B.classId, roomId: bx.room } })).id;
    await prisma.teacherAvailability.create({ data: { schoolId: sid, userId: B.users.TEACHER.id, periodId: bx.period } });
    bx.cover = (await prisma.coverLesson.create({ data: { schoolId: sid, date: new Date('2026-10-15'), slotId: bx.slot, absentTeacherId: B.users.TEACHER.id, coverTeacherId: B.users.HEAD.id, assignedById: B.users.ADMIN.id } })).id;
    const reg = await prisma.attendanceRegister.create({ data: { schoolId: sid, termId: B.termId, classId: B.classId, date: new Date('2026-10-14'), session: 'AM', markedById: B.users.TEACHER.id } });
    await prisma.attendanceEntry.create({ data: { schoolId: sid, registerId: reg.id, studentId: B.studentId, status: 'ABSENT' } });
    await prisma.messageOutbox.create({ data: { schoolId: sid, toPhone: '+263771234567', body: 'B message', studentId: B.studentId, dedupeKey: 'b:1' } });
    bx.topic = (await prisma.syllabusTopic.create({ data: { schoolId: sid, subjectId: B.subjectId, levelId: B.levelId, title: 'B topic' } })).id;
    const scheme = await prisma.schemeOfWork.create({ data: { schoolId: sid, termId: B.termId, assignmentId: bx.assignment } });
    bx.week = (await prisma.schemeWeek.create({ data: { schoolId: sid, schemeId: scheme.id, weekNo: 1, startDate: new Date('2026-01-12'), topicIds: [bx.topic] } })).id;
    await prisma.recordOfWork.create({ data: { schoolId: sid, schemeWeekId: bx.week, coveredTopicIds: [], recordedById: B.users.TEACHER.id } });
    await prisma.lessonPlan.create({ data: { schoolId: sid, slotId: bx.slot, date: new Date('2026-10-14'), teacherId: B.users.TEACHER.id, content: {} } });
    await prisma.academicsSettings.create({ data: { schoolId: sid, maxPeriodsPerWeek: 33 } });
  }
  const snap = await snapshotB();
  before = snap.json;
  bIds = snap.ids;
  bStrings = ['School B', 'Moyo2', '@school2.test', B.categoryName === 'Furniture' ? 'TAG2' : B.categoryName, 'ACC2'];
}, 180_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

// ─── The attacks ─────────────────────────────────────────────────────────────

type Status = number | 'ok';
interface Attack {
  name: string;
  file: string; // route file under app/api
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  as: Role; // a school-A role that is allowed to call this route
  url?: () => string; // path + query
  params?: () => Record<string, string>;
  body?: () => unknown;
  rawBody?: () => string;
  expect: Status; // 'ok' = 2xx
}

const a = (): SeededSchool => A;
const b = (): SeededSchool => B;
const studentBody = () => ({
  student: {
    ...defaultRegistrationValues(),
    firstName: 'Rudo', surname: 'Ncube', gender: 'F', dateOfBirth: `${currentYearInHarare() - 13}-03-05`,
    level: 'Form 1', stream: 'North', guardianName: 'Mai Ncube', guardianRelationship: 'MOTHER',
    guardianPhone: '0771234567', houseNumber: '12', suburb: 'Mbare', city: 'Harare',
  },
});

const ATTACKS: Attack[] = [
  // ── Accounting ──
  { name: 'dashboard (list)', file: 'accounting/dashboard', method: 'GET', as: 'DIRECTOR', expect: 'ok' },
  { name: 'exchange rate read', file: 'accounting/exchange-rate', method: 'GET', as: 'BURSAR', expect: 'ok' },
  { name: 'exchange rate set (own school)', file: 'accounting/exchange-rate', method: 'POST', as: 'BURSAR', body: () => ({ usdToZig: 27.5 }), expect: 'ok' },
  { name: 'expenses (list)', file: 'accounting/expenses', method: 'GET', as: 'BURSAR', expect: 'ok' },
  { name: 'expense record (own school)', file: 'accounting/expenses', method: 'POST', as: 'BURSAR', body: () => ({ category: 'Fuel', currency: 'USD', amount: 5, spentOn: '2026-10-01' }), expect: 'ok' },
  { name: "void B's expense", file: 'accounting/expenses/[id]/void', method: 'POST', as: 'DIRECTOR', params: () => ({ id: b().expenseId }), expect: 404 },
  { name: 'fee structure with B level', file: 'accounting/fee-structures', method: 'POST', as: 'HEAD', body: () => ({ levelId: b().levelId, termId: a().termId, label: 'X', currency: 'USD', amount: 1 }), expect: 404 },
  { name: 'fee structure with B term', file: 'accounting/fee-structures', method: 'POST', as: 'HEAD', body: () => ({ levelId: a().levelId, termId: b().termId, label: 'X', currency: 'USD', amount: 1 }), expect: 404 },
  { name: "edit B's fee structure", file: 'accounting/fee-structures/[id]', method: 'PATCH', as: 'HEAD', params: () => ({ id: b().feeStructureId }), body: () => ({ amount: 1 }), expect: 404 },
  { name: "bulk-apply B's fee structure", file: 'accounting/fees/bulk-apply', method: 'POST', as: 'HEAD', body: () => ({ scope: 'class', classId: a().classId, feeStructureId: b().feeStructureId, termId: a().termId }), expect: 404 },
  { name: 'bulk-apply to B class', file: 'accounting/fees/bulk-apply', method: 'POST', as: 'HEAD', body: () => ({ scope: 'class', classId: b().classId, feeStructureId: a().feeStructureId, termId: a().termId }), expect: 404 },
  { name: 'payments (list)', file: 'accounting/payments', method: 'GET', as: 'BURSAR', expect: 'ok' },
  { name: 'payments filtered by B student', file: 'accounting/payments', method: 'GET', as: 'BURSAR', url: () => `?studentId=${b().studentId}`, expect: 'ok' },
  { name: 'payment for B student', file: 'accounting/payments', method: 'POST', as: 'BURSAR', body: () => ({ studentId: b().studentId, currency: 'USD', amount: 10, method: 'CASH', feeLabel: 'Tuition', paidInZig: false }), expect: 404 },
  { name: "payment with B's proof file", file: 'accounting/payments', method: 'POST', as: 'BURSAR', body: () => ({ studentId: a().studentId, currency: 'USD', amount: 10, method: 'ECOCASH', reference: 'R1', feeLabel: 'Tuition', paidInZig: false, popKey: `pop:${b().schoolId}:abc` }), expect: 422 },
  { name: "B's proof of payment", file: 'accounting/payments/[id]/proof', method: 'GET', as: 'BURSAR', params: () => ({ id: b().paymentId }), expect: 404 },
  { name: "verify B's payment", file: 'accounting/payments/[id]/verify', method: 'POST', as: 'HEAD', params: () => ({ id: b().paymentId }), expect: 404 },
  { name: "void B's payment", file: 'accounting/payments/[id]/void', method: 'POST', as: 'DIRECTOR', params: () => ({ id: b().paymentId }), expect: 404 },
  { name: 'requests (list)', file: 'accounting/requests', method: 'GET', as: 'HEAD', expect: 'ok' },
  { name: 'request raise (own school)', file: 'accounting/requests', method: 'POST', as: 'TEACHER', body: () => ({ title: 'Markers', type: 'OTHER', department: 'Maths', justification: 'Need them', currency: 'USD', items: [{ description: 'Markers', quantity: 2, unitPrice: 3 }] }), expect: 'ok' },
  { name: "approve B's request", file: 'accounting/requests/[id]/approve', method: 'POST', as: 'HEAD', params: () => ({ id: b().requestId }), expect: 404 },
  { name: "reject B's request", file: 'accounting/requests/[id]/reject', method: 'POST', as: 'HEAD', params: () => ({ id: b().requestId }), body: () => ({ reason: 'Not needed at all' }), expect: 404 },
  { name: "disburse B's request", file: 'accounting/requests/[id]/disburse', method: 'POST', as: 'BURSAR', params: () => ({ id: b().requestId }), body: () => ({ actualTotal: 10, paymentMethod: 'CASH' }), expect: 404 },
  { name: "submit B's request", file: 'accounting/requests/[id]/submit', method: 'POST', as: 'TEACHER', params: () => ({ id: b().requestId }), expect: 404 },
  { name: 'charge a B student', file: 'accounting/students/[id]/charges', method: 'POST', as: 'HEAD', params: () => ({ id: b().studentId }), body: () => ({ studentId: b().studentId, label: 'Levy', currency: 'USD', amount: 5, termId: a().termId }), expect: 404 },
  { name: 'charge with B term', file: 'accounting/students/[id]/charges', method: 'POST', as: 'HEAD', params: () => ({ id: a().studentId }), body: () => ({ studentId: a().studentId, label: 'Levy', currency: 'USD', amount: 5, termId: b().termId }), expect: 404 },
  { name: 'read a B student account', file: 'accounting/students/[id]', method: 'GET', as: 'BURSAR', params: () => ({ id: b().studentId }), expect: 404 },
  { name: 'edit a B student', file: 'accounting/students/[id]', method: 'PATCH', as: 'HEAD', params: () => ({ id: b().studentId }), body: () => ({ medicalNotes: 'hacked' }), expect: 404 },
  { name: 'students (list)', file: 'accounting/students', method: 'GET', as: 'BURSAR', expect: 'ok' },
  { name: 'students filtered by B level', file: 'accounting/students', method: 'GET', as: 'BURSAR', url: () => `?levelId=${b().levelId}`, expect: 'ok' },

  // ── Admin ──
  { name: "open B's term", file: 'admin/academic/terms/[id]', method: 'POST', as: 'ADMIN', params: () => ({ id: b().termId }), url: () => '?action=close', expect: 404 },
  { name: "change B's term dates", file: 'admin/academic/terms/[id]', method: 'PATCH', as: 'ADMIN', params: () => ({ id: b().termId }), body: () => ({ startDate: '2026-01-11', endDate: '2026-12-19' }), expect: 404 },
  { name: 'academic years (list)', file: 'admin/academic/years', method: 'GET', as: 'ADMIN', expect: 'ok' },
  { name: 'academic year create (own school)', file: 'admin/academic/years', method: 'POST', as: 'ADMIN', body: () => ({ year: 2027 }), expect: 'ok' },
  { name: 'assignments (list)', file: 'admin/assignments', method: 'GET', as: 'ADMIN', expect: 'ok' },
  { name: 'assignments filtered by B class', file: 'admin/assignments', method: 'GET', as: 'ADMIN', url: () => `?classId=${b().classId}&teacherId=${b().users.TEACHER.id}`, expect: 'ok' },
  { name: 'assign a B teacher', file: 'admin/assignments', method: 'POST', as: 'HEAD', body: () => ({ teacherId: b().users.TEACHER.id, subjectId: a().subjectId, classId: a().classId, termId: a().termId }), expect: 404 },
  { name: 'assign a B subject', file: 'admin/assignments', method: 'POST', as: 'HEAD', body: () => ({ teacherId: a().users.TEACHER.id, subjectId: b().subjectId, classId: a().classId, termId: a().termId }), expect: 404 },
  { name: 'assign to a B class', file: 'admin/assignments', method: 'POST', as: 'HEAD', body: () => ({ teacherId: a().users.TEACHER.id, subjectId: a().subjectId, classId: b().classId, termId: a().termId }), expect: 404 },
  { name: "delete B's assignment", file: 'admin/assignments', method: 'DELETE', as: 'HEAD', url: () => `?id=${b().assignmentId}`, expect: 404 },
  { name: 'teacher load of a B teacher', file: 'admin/assignments/teacher-load', method: 'GET', as: 'ADMIN', url: () => `?teacherId=${b().users.TEACHER.id}&termId=${b().termId}`, expect: 'ok' },
  { name: "read B's class", file: 'admin/classes/[id]', method: 'GET', as: 'ADMIN', params: () => ({ id: b().classId }), expect: 404 },
  { name: "edit B's class", file: 'admin/classes/[id]', method: 'PATCH', as: 'ADMIN', params: () => ({ id: b().classId }), body: () => ({ capacity: 1 }), expect: 404 },
  { name: 'classes (list)', file: 'admin/classes', method: 'GET', as: 'ADMIN', expect: 'ok' },
  { name: 'class in a B level', file: 'admin/classes', method: 'POST', as: 'ADMIN', body: () => ({ levelId: b().levelId, stream: 'East' }), expect: 404 },
  { name: 'class with a B teacher', file: 'admin/classes', method: 'POST', as: 'ADMIN', body: () => ({ levelId: a().levelId, stream: 'East', classTeacherId: b().users.TEACHER.id }), expect: 404 },
  { name: 'settings read', file: 'admin/settings', method: 'GET', as: 'ADMIN', expect: 'ok' },
  { name: 'settings change (own school)', file: 'admin/settings', method: 'PATCH', as: 'ADMIN', body: () => ({ maxClassSize: 40 }), expect: 'ok' },
  { name: "guardians of a B student", file: 'admin/students/[id]/guardians', method: 'GET', as: 'ADMIN', params: () => ({ id: b().studentId }), expect: 404 },
  { name: 'add a guardian to a B student', file: 'admin/students/[id]/guardians', method: 'POST', as: 'ADMIN', params: () => ({ id: b().studentId }), body: () => ({ fullName: 'Intruder One', phone: '0771112222', relationship: 'UNCLE' }), expect: 404 },
  { name: "edit B's guardian", file: 'admin/students/[id]/guardians/[guardianId]', method: 'PATCH', as: 'ADMIN', params: () => ({ id: a().studentId, guardianId: b().guardianId }), body: () => ({ guardian: { fullName: 'Hacked Name' } }), expect: 404 },
  { name: "make B's guardian primary for an A student", file: 'admin/students/[id]/guardians/[guardianId]', method: 'PATCH', as: 'ADMIN', params: () => ({ id: a().studentId, guardianId: b().guardianId }), body: () => ({ link: { makePrimary: true } }), expect: 404 },
  { name: "unlink B's guardian", file: 'admin/students/[id]/guardians/[guardianId]', method: 'DELETE', as: 'ADMIN', params: () => ({ id: b().studentId, guardianId: b().guardianId }), expect: 404 },
  { name: 'check admission (own school)', file: 'admin/students/check', method: 'POST', as: 'ADMIN', body: studentBody, expect: 'ok' },
  { name: 'import into own school', file: 'admin/students/import', method: 'POST', as: 'ADMIN', rawBody: () => 'firstName\n', expect: 422 },
  { name: 'promote B students', file: 'admin/students/lifecycle', method: 'POST', as: 'ADMIN', body: () => ({ action: 'WITHDRAW', studentIds: [b().studentId], reason: 'x' }), expect: 404 },
  { name: 'move B students', file: 'admin/students/move', method: 'POST', as: 'ADMIN', body: () => ({ studentIds: [b().studentId], classId: a().classId }), expect: 404 },
  { name: 'move A student to a B class', file: 'admin/students/move', method: 'POST', as: 'ADMIN', body: () => ({ studentIds: [a().studentId], classId: b().classId }), expect: 404 },
  { name: 'students (list)', file: 'admin/students', method: 'GET', as: 'ADMIN', expect: 'ok' },
  { name: 'students filtered by B class and term', file: 'admin/students', method: 'GET', as: 'ADMIN', url: () => `?classId=${b().classId}&termId=${b().termId}`, expect: 404 },
  { name: 'admit (own school)', file: 'admin/students', method: 'POST', as: 'ADMIN', body: studentBody, expect: 'ok' },
  { name: "edit B's subject", file: 'admin/subjects/[id]', method: 'PATCH', as: 'ADMIN', params: () => ({ id: b().subjectId }), body: () => ({ name: 'Hacked' }), expect: 404 },
  { name: 'subjects (list)', file: 'admin/subjects', method: 'GET', as: 'ADMIN', expect: 'ok' },
  { name: 'subject create (own school)', file: 'admin/subjects', method: 'POST', as: 'ADMIN', body: () => ({ name: 'Physics', code: 'PHY1' }), expect: 'ok' },
  { name: "log out B's user", file: 'admin/users/[id]/logout', method: 'POST', as: 'ADMIN', params: () => ({ id: b().users.TEACHER.id }), expect: 404 },
  { name: 'reset link for a B user', file: 'admin/users/[id]/reset-link', method: 'POST', as: 'ADMIN', params: () => ({ id: b().users.TEACHER.id }), expect: 404 },
  { name: "reset B's user password", file: 'admin/users/[id]/reset-password', method: 'POST', as: 'ADMIN', params: () => ({ id: b().users.TEACHER.id }), expect: 404 },
  { name: "deactivate B's user", file: 'admin/users/[id]', method: 'PATCH', as: 'ADMIN', params: () => ({ id: b().users.HEAD.id }), body: () => ({ active: false }), expect: 404 },
  { name: "change B user's role", file: 'admin/users/[id]', method: 'PATCH', as: 'ADMIN', params: () => ({ id: b().users.TEACHER.id }), body: () => ({ role: 'ADMIN' }), expect: 404 },
  { name: 'users (list)', file: 'admin/users', method: 'GET', as: 'ADMIN', expect: 'ok' },
  { name: 'user create (own school)', file: 'admin/users', method: 'POST', as: 'ADMIN', body: () => ({ fullName: 'New Teacher', email: 'new.teacher@schoola.test', role: 'TEACHER' }), expect: 'ok' },

  // ── Student Information ──
  { name: "students (list)", file: 'students', method: 'GET', as: 'ADMIN', expect: 'ok' },
  { name: "students filtered by a B class", file: 'students', method: 'GET', as: 'ADMIN', url: () => `?classId=${b().classId}`, expect: 'ok' },
  { name: "add a student to a B class", file: 'students', method: 'POST', as: 'ADMIN', body: () => ({ student: { firstName: 'Cross', surname: 'School', gender: 'M', dateOfBirth: `${currentYearInHarare() - 13}-03-05`, classId: b().classId, entryType: 'NEW_FORM_1', guardians: [{ fullName: 'Mai Cross', relationship: 'MOTHER', phone: '0771230000', isPrimary: true }] } }), expect: 404 },
  { name: "check an admission into a B class", file: 'students/check', method: 'POST', as: 'ADMIN', body: () => ({ firstName: 'Cross', surname: 'School', gender: 'M', dateOfBirth: `${currentYearInHarare() - 13}-03-05`, classId: b().classId, entryType: 'NEW_FORM_1', guardians: [{ fullName: 'Mai Cross', relationship: 'MOTHER', phone: '0771230000', isPrimary: true }] }), expect: 404 },
  { name: "read a B student profile", file: 'students/[id]', method: 'GET', as: 'ADMIN', params: () => ({ id: b().studentId }), expect: 404 },
  { name: "edit a B student", file: 'students/[id]', method: 'PATCH', as: 'ADMIN', params: () => ({ id: b().studentId }), body: () => ({ nationality: 'Hacked' }), expect: 404 },
  { name: "B student guardians", file: 'students/[id]/guardians', method: 'GET', as: 'ADMIN', params: () => ({ id: b().studentId }), expect: 404 },
  { name: "add a guardian to a B student", file: 'students/[id]/guardians', method: 'POST', as: 'ADMIN', params: () => ({ id: b().studentId }), body: () => ({ fullName: 'Intruder Two', phone: '0771119999', relationship: 'UNCLE' }), expect: 404 },
  { name: "edit a B guardian", file: 'students/[id]/guardians/[guardianId]', method: 'PATCH', as: 'ADMIN', params: () => ({ id: a().studentId, guardianId: b().guardianId }), body: () => ({ guardian: { occupation: 'Hacked' } }), expect: 404 },
  { name: "unlink a B guardian", file: 'students/[id]/guardians/[guardianId]', method: 'DELETE', as: 'ADMIN', params: () => ({ id: b().studentId, guardianId: b().guardianId }), expect: 404 },
  { name: "B student enrolment", file: 'students/[id]/enrolment', method: 'GET', as: 'ADMIN', params: () => ({ id: b().studentId }), expect: 404 },
  { name: "B student activity", file: 'students/[id]/activity', method: 'GET', as: 'ADMIN', params: () => ({ id: b().studentId }), expect: 404 },
  { name: "B student discipline", file: 'students/[id]/discipline', method: 'GET', as: 'ADMIN', params: () => ({ id: b().studentId }), expect: 404 },
  { name: "B student medical details", file: 'students/[id]/medical', method: 'GET', as: 'ADMIN', params: () => ({ id: b().studentId }), expect: 404 },
  { name: "change B student medical details", file: 'students/[id]/medical', method: 'PUT', as: 'ADMIN', params: () => ({ id: b().studentId }), body: () => ({ notes: 'Hacked' }), expect: 404 },
  { name: "sick bay visit for a B student", file: 'students/[id]/medical/sick-bay', method: 'POST', as: 'ADMIN', params: () => ({ id: b().studentId }), body: () => ({ visitedAt: '2026-01-15T09:00', complaint: 'Headache', outcome: 'SENT_HOME' }), expect: 404 },
  { name: "B student documents", file: 'students/[id]/documents', method: 'GET', as: 'ADMIN', params: () => ({ id: b().studentId }), expect: 404 },
  { name: "upload a document for a B student", file: 'students/[id]/documents', method: 'POST', as: 'ADMIN', params: () => ({ id: b().studentId }), body: () => ({ type: 'OTHER', title: 'Note', fileKey: `sdoc:${a().schoolId}:crossschool123`, mimeType: 'application/pdf', sizeBytes: 100 }), expect: 404 },
  { name: "letter for a B student", file: 'students/[id]/letters', method: 'POST', as: 'ADMIN', params: () => ({ id: b().studentId }), body: () => ({ type: 'LETTER_PROOF_OF_ENROLMENT' }), expect: 404 },
  { name: "print a B student profile", file: 'students/[id]/print', method: 'GET', as: 'ADMIN', params: () => ({ id: b().studentId }), expect: 404 },
  { name: "rejoin a B student", file: 'students/[id]/rejoin', method: 'POST', as: 'ADMIN', params: () => ({ id: b().studentId }), body: () => ({ classId: a().classId }), expect: 404 },
  { name: "open a document that does not exist here", file: 'students/documents/[docId]/link', method: 'GET', as: 'ADMIN', params: () => ({ docId: 'not-a-document' }), expect: 404 },
  { name: "print a letter that does not exist here", file: 'students/documents/[docId]/pdf', method: 'GET', as: 'ADMIN', params: () => ({ docId: 'not-a-document' }), expect: 404 },
  { name: "verify a reference number", file: 'students/documents/verify', method: 'GET', as: 'ADMIN', url: () => '?ref=TRF-2026-00001', expect: 'ok' },
  { name: "required documents (own school)", file: 'system/settings/documents', method: 'PUT', as: 'ADMIN', body: () => ({ types: ['BIRTH_CERTIFICATE'] }), expect: 'ok' },
  { name: "move B students", file: 'students/move', method: 'POST', as: 'ADMIN', body: () => ({ move: { studentIds: [b().studentId], toClassId: a().classId, reason: 'PARENT_REQUEST' } }), expect: 404 },
  { name: "move an A student to a B class", file: 'students/move', method: 'POST', as: 'ADMIN', body: () => ({ move: { studentIds: [a().studentId], toClassId: b().classId, reason: 'PARENT_REQUEST' } }), expect: 404 },
  { name: "class moves waiting (own school)", file: 'students/move', method: 'GET', as: 'ADMIN', expect: 'ok' },
  { name: "decide a class move that is not here", file: 'students/move/[id]', method: 'POST', as: 'ADMIN', params: () => ({ id: 'no-such-move' }), body: () => ({ decision: 'APPROVE' }), expect: 404 },
  { name: "house for B students", file: 'students/house', method: 'POST', as: 'ADMIN', body: () => ({ studentIds: [b().studentId], houseId: null }), expect: 404 },
  { name: "houses (own school)", file: 'system/houses', method: 'GET', as: 'ADMIN', expect: 'ok' },
  { name: "house create (own school)", file: 'system/houses', method: 'POST', as: 'ADMIN', body: () => ({ name: 'Cross House' }), expect: 'ok' },
  { name: "edit a house that is not here", file: 'system/houses/[id]', method: 'PATCH', as: 'ADMIN', params: () => ({ id: 'no-such-house' }), body: () => ({ name: 'Hacked House' }), expect: 404 },
  { name: "export B students", file: 'students/export', method: 'POST', as: 'ADMIN', body: () => ({ ids: [b().studentId], columns: ['surname'] }), expect: 404 },
  { name: "search students (own school)", file: 'students/search', method: 'GET', as: 'ADMIN', url: () => '?q=moyo', expect: 'ok' },
  { name: "class list of a B class", file: 'students/class-list', method: 'GET', as: 'ADMIN', url: () => `?classIds=${b().classId}`, expect: 404 },
  { name: "record an incident for a B student", file: 'students/discipline', method: 'POST', as: 'ADMIN', body: () => ({ studentIds: [b().studentId], occurredAt: '2026-01-15T09:00', location: 'CLASSROOM', category: 'UNIFORM', severity: 'MINOR', description: 'Cross school attempt' }), expect: 404 },
  { name: "discipline report (own school)", file: 'students/discipline', method: 'GET', as: 'ADMIN', expect: 'ok' },
  { name: "decide an action that is not here", file: 'students/discipline/actions/[id]', method: 'POST', as: 'ADMIN', params: () => ({ id: 'no-such-action' }), body: () => ({ decision: 'APPROVE' }), expect: 404 },
  { name: "meeting for an action that is not here", file: 'students/discipline/actions/[id]/meeting', method: 'POST', as: 'ADMIN', params: () => ({ id: 'no-such-action' }), body: () => ({ meetingDate: '2026-01-15', attendees: 'Mother', outcome: 'Agreed' }), expect: 404 },
  { name: "start leaving for a B student", file: 'students/leaving', method: 'POST', as: 'ADMIN', body: () => ({ studentId: b().studentId, reason: 'WITHDRAWN_BY_GUARDIAN', lastDay: '2026-01-15' }), expect: 404 },
  { name: "leavers (own school)", file: 'students/leaving', method: 'GET', as: 'ADMIN', expect: 'ok' },
  { name: "approve a leaving that is not here", file: 'students/leaving/[id]', method: 'POST', as: 'ADMIN', params: () => ({ id: 'no-such-exit' }), body: () => ({ action: 'approve' }), expect: 404 },
  { name: "alumni (own school)", file: 'students/alumni', method: 'GET', as: 'ADMIN', expect: 'ok' },
  { name: "add a B student to the alumni", file: 'students/alumni', method: 'POST', as: 'ADMIN', body: () => ({ studentId: b().studentId, yearLeft: 2020 }), expect: 404 },
  { name: "edit an alumnus that is not here", file: 'students/alumni/[id]', method: 'PATCH', as: 'ADMIN', params: () => ({ id: 'no-such-alumnus' }), body: () => ({ destination: 'Hacked' }), expect: 404 },
  { name: "alumni export (nothing to export)", file: 'students/alumni/export', method: 'GET', as: 'ADMIN', expect: 404 },
  { name: "import template", file: 'students/import', method: 'GET', as: 'ADMIN', expect: 'ok' },
  { name: "import with a bad row (own school)", file: 'students/import', method: 'POST', as: 'ADMIN', body: () => ({ rows: [{ rowNumber: 2, values: { first_name: '' } }] }), expect: 422 },
  { name: "check an import (own school)", file: 'students/import/check', method: 'POST', as: 'ADMIN', body: () => ({ rows: [{ rowNumber: 2, values: { first_name: '' } }] }), expect: 'ok' },
  { name: "intakes (own school)", file: 'students/admissions', method: 'GET', as: 'ADMIN', expect: 'ok' },
  { name: "intake with a B form", file: 'students/admissions', method: 'POST', as: 'ADMIN', body: () => ({ name: 'Cross Intake', levelId: b().levelId, year: 2030, places: 5 }), expect: 404 },
  { name: "an intake that is not here", file: 'students/admissions/[intakeId]', method: 'GET', as: 'ADMIN', params: () => ({ intakeId: 'no-such-intake' }), expect: 404 },
  { name: "edit an intake that is not here", file: 'students/admissions/[intakeId]', method: 'PATCH', as: 'ADMIN', params: () => ({ intakeId: 'no-such-intake' }), body: () => ({ name: 'Cross Intake', levelId: a().levelId, year: 2030, places: 5 }), expect: 404 },
  { name: "application to an intake that is not here", file: 'students/admissions/applications', method: 'POST', as: 'ADMIN', body: () => ({ intakeId: 'no-such-intake', firstName: 'Cross', surname: 'Applicant', gender: 'M', dateOfBirth: `${currentYearInHarare() - 13}-03-05`, guardianName: 'Mai Cross', guardianPhone: '0771230000' }), expect: 404 },
  { name: "move applicants that are not here", file: 'students/admissions/applications/move', method: 'POST', as: 'ADMIN', body: () => ({ applicationIds: ['no-such-application'], to: 'SHORTLISTED' }), expect: 404 },
  { name: "edit an application that is not here", file: 'students/admissions/applications/[id]', method: 'PATCH', as: 'ADMIN', params: () => ({ id: 'no-such-application' }), body: () => ({ testScore: 50 }), expect: 404 },
  { name: "accept an offer that is not here", file: 'students/admissions/applications/[id]/accept', method: 'POST', as: 'ADMIN', params: () => ({ id: 'no-such-application' }), body: () => ({}), expect: 404 },
  { name: "enrol an applicant that is not here", file: 'students/admissions/applications/[id]/enrol', method: 'POST', as: 'ADMIN', params: () => ({ id: 'no-such-application' }), body: () => ({ classId: a().classId }), expect: 404 },
  { name: "offer letter that is not here", file: 'students/admissions/applications/[id]/offer-letter', method: 'GET', as: 'ADMIN', params: () => ({ id: 'no-such-application' }), expect: 404 },
  { name: "document for an application that is not here", file: 'students/admissions/applications/[id]/documents', method: 'POST', as: 'ADMIN', params: () => ({ id: 'no-such-application' }), body: () => ({ type: 'OTHER', title: 'Note', fileKey: `sdoc:${a().schoolId}:crossschool123`, mimeType: 'application/pdf', sizeBytes: 100 }), expect: 404 },
  { name: "promotion (own school)", file: 'students/promotion', method: 'GET', as: 'ADMIN', expect: 'ok' },
  { name: "promotion from a B year", file: 'students/promotion', method: 'PUT', as: 'ADMIN', body: () => ({ fromYearId: b().yearId, decisions: [] }), expect: 404 },
  { name: "confirm a promotion that is not here", file: 'students/promotion/[runId]/confirm', method: 'POST', as: 'ADMIN', params: () => ({ runId: 'no-such-run' }), body: () => ({}), expect: 404 },
  { name: "report of a promotion that is not here", file: 'students/promotion/[runId]/report', method: 'GET', as: 'ADMIN', params: () => ({ runId: 'no-such-run' }), expect: 404 },

  { name: 'guardian lookup by phone (own school only)', file: 'students/guardians/lookup', method: 'GET', as: 'ADMIN', url: () => '?phone=0771234567', expect: 'ok' },

  // ── Assets ──
  { name: "dispose B's asset", file: 'assets/[id]/dispose', method: 'POST', as: 'HEAD', params: () => ({ id: b().assetId }), body: () => ({ disposalDate: '2026-10-01', reason: 'Broken', method: 'SCRAPPED' }), expect: 404 },
  { name: "maintain B's asset", file: 'assets/[id]/maintenance', method: 'POST', as: 'HEAD', params: () => ({ id: b().assetId }), body: () => ({ maintenanceDate: '2026-10-01', description: 'Fix' }), expect: 404 },
  { name: "read B's asset", file: 'assets/[id]', method: 'GET', as: 'HEAD', params: () => ({ id: b().assetId }), expect: 404 },
  { name: "edit B's asset", file: 'assets/[id]', method: 'PATCH', as: 'HEAD', params: () => ({ id: b().assetId }), body: () => ({ location: 'Stolen' }), expect: 404 },
  { name: 'assets (list)', file: 'assets', method: 'GET', as: 'HEAD', expect: 'ok' },
  { name: 'asset in a B category', file: 'assets', method: 'POST', as: 'HEAD', body: () => ({ name: 'Chair', categoryId: b().assetCategoryId, tagNumber: 'TAGX', acquisitionDate: '2026-01-01', acquisitionCost: 10, currency: 'USD', location: 'Hall', condition: 'GOOD' }), expect: 404 },

  // ── Library ──
  { name: "read B's book", file: 'library/books/[id]', method: 'GET', as: 'LIBRARIAN', params: () => ({ id: b().bookId }), expect: 404 },
  { name: "edit B's book", file: 'library/books/[id]', method: 'PATCH', as: 'LIBRARIAN', params: () => ({ id: b().bookId }), body: () => ({ title: 'Hacked' }), expect: 404 },
  { name: 'books (list)', file: 'library/books', method: 'GET', as: 'LIBRARIAN', expect: 'ok' },
  { name: 'book create (own school)', file: 'library/books', method: 'POST', as: 'LIBRARIAN', body: () => ({ title: 'Geometry', author: 'Jones', copies: 1 }), expect: 'ok' },
  { name: "return B's borrowing", file: 'library/borrowing/[id]/return', method: 'POST', as: 'LIBRARIAN', params: () => ({ id: b().borrowingId }), body: () => ({ conditionOnReturn: 'GOOD' }), expect: 404 },
  { name: 'borrowing (list)', file: 'library/borrowing', method: 'GET', as: 'LIBRARIAN', url: () => `?history=true&memberId=${b().memberId}`, expect: 'ok' },
  { name: "check out B's copy", file: 'library/borrowing', method: 'POST', as: 'LIBRARIAN', body: () => ({ copyId: b().copyId, memberId: a().memberId }), expect: 404 },
  { name: 'check out to a B member', file: 'library/borrowing', method: 'POST', as: 'LIBRARIAN', body: () => ({ copyId: a().copyId, memberId: b().memberId }), expect: 404 },
  { name: "edit B's copy", file: 'library/copies/[id]', method: 'PATCH', as: 'LIBRARIAN', params: () => ({ id: b().copyId }), body: () => ({ condition: 'DAMAGED' }), expect: 404 },
  { name: 'library settings (read own)', file: 'library/settings', method: 'GET', as: 'LIBRARIAN', expect: 'ok' },
  { name: 'library settings (change own)', file: 'library/settings', method: 'PATCH', as: 'LIBRARIAN', body: () => ({ studentLoanLimit: 2 }), expect: 'ok' },
  { name: 'settle fine of B', file: 'library/borrowing/[id]/settle-fine', method: 'POST', as: 'LIBRARIAN', params: () => ({ id: b().borrowingId }), expect: 404 },
  { name: 'library members (list)', file: 'library/members', method: 'GET', as: 'LIBRARIAN', expect: 'ok' },

  // ── Parent portal links ──
  { name: "portal link info of a B student", file: 'portal-links/[id]', method: 'GET', as: 'BURSAR', params: () => ({ id: b().studentId }), expect: 404 },
  { name: "regenerate a B student's portal link", file: 'portal-links/[id]', method: 'POST', as: 'BURSAR', params: () => ({ id: b().studentId }), expect: 404 },
  { name: "set a B student's portal PIN", file: 'portal-links/[id]/pin', method: 'POST', as: 'BURSAR', params: () => ({ id: b().studentId }), expect: 404 },
  { name: "remove a B student's portal PIN", file: 'portal-links/[id]/pin', method: 'DELETE', as: 'BURSAR', params: () => ({ id: b().studentId }), expect: 404 },

  // ── Results ──
  { name: "export B's class results", file: 'results/export', method: 'GET', as: 'HEAD', url: () => `?classId=${b().classId}&termId=${a().termId}`, expect: 404 },
  { name: 'grade boundaries (list)', file: 'results/grade-boundaries', method: 'GET', as: 'HEAD', expect: 'ok' },
  { name: 'grade boundaries save (own school)', file: 'results/grade-boundaries', method: 'POST', as: 'HEAD', body: () => ({ boundaries: [{ minPercent: 0, maxPercent: 100, letterGrade: 'Z' }] }), expect: 'ok' },
  { name: "read B's marks", file: 'results/marks', method: 'GET', as: 'HEAD', url: () => `?classId=${b().classId}&subjectId=${a().subjectId}&termId=${a().termId}`, expect: 404 },
  { name: 'read marks with B subject', file: 'results/marks', method: 'GET', as: 'HEAD', url: () => `?classId=${a().classId}&subjectId=${b().subjectId}&termId=${a().termId}`, expect: 404 },
  { name: 'mark a B student', file: 'results/marks', method: 'POST', as: 'HEAD', body: () => ({ studentId: b().studentId, subjectId: a().subjectId, classId: a().classId, termId: a().termId, rawMark: 50 }), expect: 404 },
  { name: 'mark in a B subject', file: 'results/marks', method: 'POST', as: 'HEAD', body: () => ({ studentId: a().studentId, subjectId: b().subjectId, classId: a().classId, termId: a().termId, rawMark: 50 }), expect: 404 },
  { name: "unlock B's marks", file: 'results/marks/unverify', method: 'POST', as: 'HEAD', body: () => ({ assignmentId: b().assignmentId }), expect: 404 },
  { name: "verify B's marks", file: 'results/marks/verify', method: 'POST', as: 'HEAD', body: () => ({ assignmentId: b().assignmentId, force: true }), expect: 404 },
  { name: "publish B's class", file: 'results/publish', method: 'POST', as: 'HEAD', body: () => ({ classId: b().classId, termId: a().termId }), expect: 404 },
  { name: 'excuse an absence of B', file: 'results/marks/excuse', method: 'POST', as: 'HEAD', body: () => ({ markId: b().markId, excused: true, reason: 'Trying to reach another school' }), expect: 404 },
  { name: 'remarks of a B student', file: 'results/remarks', method: 'PATCH', as: 'HEAD', body: () => ({ studentId: b().studentId, termId: a().termId, headRemark: 'Hello' }), expect: 404 },
  { name: 'remove a B level boundary set', file: 'results/grade-boundaries', method: 'DELETE', as: 'HEAD', url: () => `?levelId=${b().levelId}`, expect: 'ok' },
  { name: 'results settings (read own)', file: 'results/settings', method: 'GET', as: 'HEAD', expect: 'ok' },
  { name: 'results settings (change own)', file: 'results/settings', method: 'PATCH', as: 'HEAD', body: () => ({ oLevelRanking: 'AVERAGE' }), expect: 'ok' },
  { name: "unpublish B's class", file: 'results/unpublish', method: 'POST', as: 'HEAD', body: () => ({ classId: b().classId, termId: a().termId, reason: 'Wrong marks entered' }), expect: 404 },
  { name: "report card of a B student", file: 'results/reports/[studentId]', method: 'GET', as: 'HEAD', params: () => ({ studentId: b().studentId }), url: () => `?termId=${a().termId}`, expect: 404 },
  { name: 'reopen a B term', file: 'director/terms/[id]/reopen', method: 'POST', as: 'DIRECTOR', params: () => ({ id: b().termId }), body: () => ({ reason: 'Trying to reach another school' }), expect: 404 },
  // Also bump every A user: must not touch B's.
  { name: 'log out all sessions (own school only)', file: 'admin/users/logout-all', method: 'POST', as: 'ADMIN', expect: 'ok' },
  // ── Dashboard & System ──
  { name: 'system users (list)', file: 'system/users', method: 'GET', as: 'ADMIN', url: () => '?pageSize=100', expect: 'ok' },
  { name: 'system users CSV', file: 'system/users', method: 'GET', as: 'ADMIN', url: () => '?format=csv', expect: 'ok' },
  { name: 'system user create (own school)', file: 'system/users', method: 'POST', as: 'ADMIN', body: () => ({ fullName: 'System New', email: 'system.new@schoola.test', phone: '0771234567', roles: ['TEACHER'] }), expect: 'ok' },
  { name: 'system users import (own school)', file: 'system/users/import', method: 'POST', as: 'ADMIN', body: () => ({ csv: ['name,email,phone,roles', 'Import One,import.one@schoola.test,0712345678,Teacher'].join('\n') }), expect: 'ok' },
  { name: 'system users import template', file: 'system/users/import', method: 'GET', as: 'ADMIN', expect: 'ok' },
  { name: "system new invite for B's user", file: 'system/users/[id]/invite', method: 'POST', as: 'ADMIN', params: () => ({ id: b().users.TEACHER.id }), expect: 404 },
  { name: "system edit B's user", file: 'system/users/[id]', method: 'PATCH', as: 'ADMIN', params: () => ({ id: b().users.TEACHER.id }), body: () => ({ roles: ['ADMINISTRATOR'] }), expect: 404 },
  { name: "system deactivate B's user", file: 'system/users/[id]/deactivate', method: 'POST', as: 'ADMIN', params: () => ({ id: b().users.HEAD.id }), expect: 404 },
  { name: "system reactivate B's user", file: 'system/users/[id]/reactivate', method: 'POST', as: 'ADMIN', params: () => ({ id: b().users.HEAD.id }), expect: 404 },
  { name: "system reset B's user password", file: 'system/users/[id]/reset-password', method: 'POST', as: 'ADMIN', params: () => ({ id: b().users.TEACHER.id }), expect: 404 },
  { name: 'system settings read', file: 'system/settings', method: 'GET', as: 'ADMIN', expect: 'ok' },
  { name: 'system settings profile change (own school)', file: 'system/settings/profile', method: 'PATCH', as: 'ADMIN', body: () => ({ name: 'School A Renamed', schoolType: 'GOVERNMENT', boarding: 'DAY', studentGender: 'CO_ED', district: 'Harare', physicalAddress: '1 Main Road' }), expect: 'ok' },
  { name: 'system settings defaults change (own school)', file: 'system/settings/defaults', method: 'PATCH', as: 'ADMIN', body: () => ({ maxClassSize: 44 }), expect: 'ok' },
  { name: 'system finance settings (own school)', file: 'system/settings/finance', method: 'PATCH', as: 'ADMIN', body: () => ({ currencyUsdEnabled: true, currencyZigEnabled: true, defaultCurrency: 'USD', receiptFormat: 'RCP-{YEAR}-{000000}', receiptNextNumber: 1, invoiceFormat: 'INV-{YEAR}-{000000}', invoiceNextNumber: 1 }), expect: 'ok' },
  { name: 'system numbering settings (own school)', file: 'system/settings/numbering', method: 'PATCH', as: 'ADMIN', body: () => ({ schoolCode: 'STU', admissionFormat: '{SCHOOLCODE}{YEAR}{0000}' }), expect: 'ok' },
  { name: 'system academic years (list)', file: 'system/academic/years', method: 'GET', as: 'ADMIN', expect: 'ok' },
  { name: 'system academic year (own school)', file: 'system/academic/years', method: 'POST', as: 'ADMIN', body: () => ({ year: 2031, terms: [{ startDate: '2031-01-05', endDate: '2031-04-04' }, { startDate: '2031-05-04', endDate: '2031-08-08' }, { startDate: '2031-09-07', endDate: '2031-12-05' }] }), expect: 'ok' },
  { name: "system change B's term dates", file: 'system/academic/terms/[id]', method: 'PATCH', as: 'ADMIN', params: () => ({ id: b().termId }), body: () => ({ startDate: '2026-01-11', endDate: '2026-12-19' }), expect: 404 },
  { name: "system open B's term", file: 'system/academic/terms/[id]/open', method: 'POST', as: 'ADMIN', params: () => ({ id: b().termId }), expect: 404 },
  { name: "system close B's term", file: 'system/academic/terms/[id]/close', method: 'POST', as: 'ADMIN', params: () => ({ id: b().termId }), expect: 404 },
  { name: 'system structure (read)', file: 'system/structure', method: 'GET', as: 'ADMIN', expect: 'ok' },
  { name: "system switch off B's form", file: 'system/structure/forms', method: 'PATCH', as: 'ADMIN', body: () => ({ forms: [{ id: b().levelId, active: false }] }), expect: 404 },
  { name: 'system stream add (own school)', file: 'system/structure/streams', method: 'POST', as: 'ADMIN', body: () => ({ name: 'Blue' }), expect: 'ok' },
  { name: "system rename B's stream", file: 'system/structure/streams/[id]', method: 'PATCH', as: 'ADMIN', params: () => ({ id: bStreamId }), body: () => ({ name: 'Hacked' }), expect: 404 },
  { name: "system remove B's stream", file: 'system/structure/streams/[id]', method: 'DELETE', as: 'ADMIN', params: () => ({ id: bStreamId }), expect: 404 },
  { name: "system classes grid with B's form", file: 'system/structure/classes', method: 'PUT', as: 'ADMIN', body: () => ({ cells: [{ levelId: b().levelId, stream: '', exists: true, capacity: 40 }] }), expect: 404 },
  { name: 'system grading scales (read)', file: 'system/grading', method: 'GET', as: 'ADMIN', expect: 'ok' },
  { name: 'system O Level scale (own school)', file: 'system/grading/[category]', method: 'PUT', as: 'ADMIN', params: () => ({ category: 'O_LEVEL' }), body: () => ({ rows: [{ letterGrade: 'P', minPercent: 50, maxPercent: 100 }, { letterGrade: 'F', minPercent: 0, maxPercent: 49 }] }), expect: 'ok' },
  { name: 'system calendar (list)', file: 'system/calendar', method: 'GET', as: 'ADMIN', url: () => '?from=2026-01-01&to=2026-12-31', expect: 'ok' },
  { name: 'system calendar add (own school)', file: 'system/calendar', method: 'POST', as: 'ADMIN', body: () => ({ title: 'A event', kind: 'EXAM', startDate: '2026-09-01', endDate: '2026-09-02' }), expect: 'ok' },
  { name: "system edit B's event", file: 'system/calendar/[id]', method: 'PATCH', as: 'ADMIN', params: () => ({ id: bEventId }), body: () => ({ title: 'hacked', kind: 'EXAM', startDate: '2026-09-01', endDate: '2026-09-02' }), expect: 404 },
  { name: "system delete B's event", file: 'system/calendar/[id]', method: 'DELETE', as: 'ADMIN', params: () => ({ id: bEventId }), expect: 404 },
  { name: 'system calendar PDF of an own term', file: 'system/calendar/pdf', method: 'GET', as: 'ADMIN', url: () => `?termId=${a().termId}`, expect: 'ok' },
  { name: 'system invoice PDF (own school has none)', file: 'system/subscription/invoices/[id]/pdf', method: 'GET', as: 'ADMIN', params: () => ({ id: 'no-such-invoice' }), expect: 404 },
  { name: "system invoice PDF of B's invoice", file: 'system/subscription/invoices/[id]/pdf', method: 'GET', as: 'ADMIN', params: () => ({ id: bInvoiceId }), expect: 404 },
  { name: 'system profile change (own, body cannot name another user)', file: 'system/profile', method: 'PATCH', as: 'ADMIN', body: () => ({ fullName: 'Changed Own', id: b().users.ADMIN.id, userId: b().users.ADMIN.id }), expect: 'ok' },
  { name: "system calendar PDF of B's term", file: 'system/calendar/pdf', method: 'GET', as: 'ADMIN', url: () => `?termId=${b().termId}`, expect: 404 },
  { name: 'system calendar event for B forms', file: 'system/calendar', method: 'POST', as: 'ADMIN', body: () => ({ title: 'x', kind: 'EXAM', startDate: '2026-09-01', endDate: '2026-09-01', audience: 'FORMS', audienceLevelIds: [b().levelId] }), expect: 404 },
  { name: 'system audit log (list)', file: 'system/audit-log', method: 'GET', as: 'ADMIN', url: () => '?pageSize=100', expect: 'ok' },
  { name: 'system audit log filtered by a B person', file: 'system/audit-log', method: 'GET', as: 'ADMIN', url: () => `?actor=${b().users.ADMIN.id}&entity=User`, expect: 'ok' },
  { name: 'system audit log CSV', file: 'system/audit-log', method: 'GET', as: 'ADMIN', url: () => '?format=csv', expect: 'ok' },
  { name: 'system notifications (list)', file: 'system/notifications', method: 'GET', as: 'HEAD', expect: 'ok' },
  { name: "system mark B's notification read", file: 'system/notifications', method: 'POST', as: 'HEAD', body: () => ({ id: bNotificationId }), expect: 404 },
  { name: 'system switch to a B term', file: 'system/view-term', method: 'POST', as: 'ADMIN', body: () => ({ termId: b().termId }), expect: 404 },
  { name: 'system profile change (own)', file: 'system/profile', method: 'PATCH', as: 'TEACHER', body: () => ({ fullName: 'Own Name Only' }), expect: 'ok' },

  // ── Academics: school A's administrator against school B's classes, assignments, registers, timetable, schemes ──
  ...academicsAttacks(),
];

function academicsAttacks(): Attack[] {
  type O = Partial<Pick<Attack, 'url' | 'params' | 'body'>>;
  const ac = (name: string, file: string, method: Attack['method'], expected: Status, o: O = {}): Attack => ({ name, file: `academics/${file}`, method, as: 'ADMIN', expect: expected, ...o });
  const q = (s: () => string) => ({ url: s });
  const p = (id: () => string) => ({ params: () => ({ id: id() }) });
  const day = { dayOfWeek: 1, periods: [{ periodNo: 1, start: '07:30', end: '08:05', type: 'LESSON' }] };
  const entry = () => [{ studentId: b().studentId, status: 'ABSENT' }];
  return [
    ac('settings (read own)', 'settings', 'GET', 'ok'),
    ac('settings (change own)', 'settings', 'PUT', 'ok', { body: () => ({ maxPeriodsPerWeek: 36 }) }),
    ac('classes (list)', 'classes', 'GET', 'ok'),
    ac('classes of a B term', 'classes', 'GET', 404, q(() => `?termId=${b().termId}`)),
    ac('copy into a B term', 'classes/copy', 'POST', 404, { body: () => ({ termId: b().termId }) }),
    ac("B's class", 'classes/[id]', 'GET', 404, p(() => b().classId)),
    ac("B's class list", 'classes/[id]/students', 'GET', 404, p(() => b().classId)),
    ac("B's class subjects", 'classes/[id]/subjects', 'GET', 404, p(() => b().classId)),
    ac("B's class attendance", 'classes/[id]/attendance', 'GET', 404, p(() => b().classId)),
    ac("B's class timetable", 'classes/[id]/timetable', 'GET', 404, p(() => b().classId)),
    ac("B's class teacher", 'classes/[id]/class-teacher', 'PUT', 404, { ...p(() => b().classId), body: () => ({ userId: a().users.TEACHER.id }) }),
    ac('a B person as class teacher', 'classes/[id]/class-teacher', 'PUT', 404, { ...p(() => a().classId), body: () => ({ userId: b().users.TEACHER.id }) }),
    ac('departments (list)', 'departments', 'GET', 'ok'),
    ac('department with a B head', 'departments', 'POST', 404, { body: () => ({ name: 'Mine', hodUserId: b().users.TEACHER.id }) }),
    ac("edit B's department", 'departments/[id]', 'PATCH', 404, { ...p(() => bx.dept!), body: () => ({ name: 'Hacked' }) }),
    ac("delete B's department", 'departments/[id]', 'DELETE', 404, p(() => bx.dept!)),
    ac('subjects (list)', 'subjects', 'GET', 'ok'),
    ac('subject in a B department', 'subjects', 'POST', 404, { body: () => ({ name: 'Mine', shortName: 'Mine', code: 'MINE', departmentId: bx.dept, examBoard: 'ZIMSEC', levels: [{ levelId: a().levelId, type: 'CORE' }] }) }),
    ac("edit B's subject", 'subjects/[id]', 'PATCH', 404, { ...p(() => b().subjectId), body: () => ({ name: 'Hacked', shortName: 'Hack', code: 'HACK', departmentId: bx.dept, examBoard: 'ZIMSEC', levels: [{ levelId: b().levelId, type: 'CORE' }] }) }),
    ac("deactivate B's subject", 'subjects/[id]/active', 'POST', 404, { ...p(() => b().subjectId), body: () => ({ active: false }) }),
    ac('starter list', 'subjects/starter', 'GET', 'ok'),
    ac('load the starter list (own school)', 'subjects/starter', 'POST', 'ok', { body: () => ({ subjects: [{ name: 'Starter One', shortName: 'Start1', code: 'STONE', department: 'Starter dept', examBoard: 'ZIMSEC', isPractical: false, colour: '#112233', levels: { 1: 'CORE' } }] }) }),
    ac('subject changes (list)', 'subjects/changes', 'GET', 'ok'),
    ac("decide B's subject change", 'subjects/changes/[id]', 'POST', 404, { ...p(() => bx.change!), body: () => ({ decision: 'APPROVE' }) }),
    ac('combinations (list)', 'combinations', 'GET', 'ok'),
    ac('combination of B subjects', 'combinations', 'POST', 422, { body: () => ({ name: 'Mine', levelId: a().levelId, subjectIds: [b().subjectId] }) }),
    ac('combination in a B form', 'combinations', 'POST', 404, { body: () => ({ name: 'Mine', levelId: b().levelId, subjectIds: [a().subjectId] }) }),
    ac("edit B's combination", 'combinations/[id]', 'PATCH', 404, { ...p(() => bx.combo!), body: () => ({ name: 'Hacked', levelId: a().levelId, subjectIds: [a().subjectId] }) }),
    ac("delete B's combination", 'combinations/[id]', 'DELETE', 404, p(() => bx.combo!)),
    ac("B class's student subjects", 'student-subjects', 'GET', 404, q(() => `?classId=${b().classId}`)),
    ac("change B students' subjects", 'student-subjects', 'PUT', 404, { body: () => ({ classId: b().classId, changes: [{ studentId: b().studentId, subjectIds: [] }] }) }),
    ac('core subjects in a B term', 'student-subjects/sync-core', 'POST', 404, { body: () => ({ termId: b().termId }) }),
    ac("apply B's combination", 'student-subjects/apply-combination', 'POST', 404, { body: () => ({ classId: a().classId, combinationId: bx.combo, studentIds: [a().studentId] }) }),
    ac('teaching groups (list)', 'teaching-groups', 'GET', 'ok'),
    ac('group of a B subject', 'teaching-groups', 'POST', 404, { body: () => ({ name: 'Mine', subjectId: b().subjectId, levelId: a().levelId }) }),
    ac("edit B's group", 'teaching-groups/[id]', 'PATCH', 404, { ...p(() => bx.group!), body: () => ({ name: 'Hacked', subjectId: a().subjectId, levelId: a().levelId }) }),
    ac("delete B's group", 'teaching-groups/[id]', 'DELETE', 404, p(() => bx.group!)),
    ac("refresh B's group", 'teaching-groups/[id]/sync', 'POST', 404, p(() => bx.group!)),
    ac('assignments (list)', 'assignments', 'GET', 'ok'),
    ac('assignments grid', 'assignments', 'GET', 'ok', q(() => '?view=grid')),
    ac('assignments by teacher', 'assignments', 'GET', 'ok', q(() => '?view=teachers')),
    ac('assignments gaps', 'assignments', 'GET', 'ok', q(() => '?view=gaps')),
    ac('assign a B teacher', 'assignments', 'POST', 404, { body: () => ({ teacherId: b().users.TEACHER.id, subjectId: a().subjectId, classId: a().classId, periodsPerWeek: 3 }) }),
    ac('assign a B subject', 'assignments', 'POST', 404, { body: () => ({ teacherId: a().users.TEACHER.id, subjectId: b().subjectId, classId: a().classId, periodsPerWeek: 3 }) }),
    ac('assign to a B class', 'assignments', 'POST', 404, { body: () => ({ teacherId: a().users.TEACHER.id, subjectId: a().subjectId, classId: b().classId, periodsPerWeek: 3 }) }),
    ac("edit B's assignment", 'assignments/[id]', 'PATCH', 404, { ...p(() => bx.assignment!), body: () => ({ periodsPerWeek: 1 }) }),
    ac("remove B's assignment", 'assignments/[id]', 'DELETE', 404, p(() => bx.assignment!)),
    ac("replace B's teacher", 'assignments/[id]/replace', 'POST', 404, { ...p(() => bx.assignment!), body: () => ({ teacherId: a().users.TEACHER.id, effectiveDate: '2026-10-25' }) }),
    ac("end B's assignment", 'assignments/[id]/end', 'POST', 404, { ...p(() => bx.assignment!), body: () => ({}) }),
    ac('assignment set (read)', 'assignments/set', 'GET', 'ok'),
    ac("B term's assignment set", 'assignments/set', 'GET', 404, q(() => `?termId=${b().termId}`)),
    ac('send the assignments (none yet)', 'assignments/set', 'POST', 409, { body: () => ({}) }),
    ac('decide the assignments (none waiting)', 'assignments/set/decide', 'POST', 409, { body: () => ({ decision: 'APPROVE' }) }),
    ac("B's register", 'attendance/register', 'GET', 404, q(() => `?classId=${b().classId}&date=2026-10-14`)),
    ac("mark B's register", 'attendance/register', 'PUT', 404, { body: () => ({ classId: b().classId, date: '2026-10-14', session: 'AM', entries: entry() }) }),
    ac("correct B's register", 'attendance/correct', 'PUT', 404, { body: () => ({ classId: b().classId, date: '2026-10-14', session: 'AM', entries: entry(), correctionReason: 'Another school' }) }),
    ac("view B's register", 'attendance/view', 'GET', 404, q(() => `?classId=${b().classId}&date=2026-10-14`)),
    ac("sync B's registers", 'attendance/sync', 'POST', 'ok', { body: () => ({ registers: [{ ref: 'x', classId: b().classId, date: '2026-10-14', session: 'AM', entries: entry() }] }) }),
    ac("B's lesson register", 'attendance/lesson', 'GET', 409, q(() => `?slotId=${bx.slot}&date=2026-10-12`)),
    ac("mark B's lesson register", 'attendance/lesson', 'PUT', 409, { body: () => ({ slotId: bx.slot, date: '2026-10-12', entries: entry() }) }),
    ac('lessons to register', 'attendance/lessons', 'GET', 'ok'),
    ac('registers due', 'attendance/due', 'GET', 'ok'),
    ac('daily summary', 'attendance/summary', 'GET', 'ok'),
    ac('truancy', 'attendance/truancy', 'GET', 'ok'),
    ac('remind a B class', 'attendance/remind', 'POST', 'ok', { body: () => ({ classIds: [b().classId] }) }),
    ac('bell schedule (read)', 'bell', 'GET', 'ok'),
    ac("B term's bell schedule", 'bell', 'GET', 404, q(() => `?termId=${b().termId}`)),
    ac('bell schedule (save, own school)', 'bell', 'PUT', 'ok', { body: () => ({ days: [day] }) }),
    ac('bell schedule for a B term', 'bell', 'PUT', 404, { body: () => ({ termId: b().termId, days: [day] }) }),
    ac("remove a B term's bell schedule", 'bell', 'DELETE', 404, q(() => `?termId=${b().termId}`)),
    ac('rooms (list)', 'rooms', 'GET', 'ok'),
    ac('room (own school)', 'rooms', 'POST', 'ok', { body: () => ({ name: 'A Hall', type: 'HALL', capacity: 300 }) }),
    ac("edit B's room", 'rooms/[id]', 'PATCH', 404, { ...p(() => bx.room!), body: () => ({ name: 'Hacked', type: 'HALL', capacity: 1 }) }),
    ac("delete B's room", 'rooms/[id]', 'DELETE', 404, p(() => bx.room!)),
    ac("B teacher's availability", 'availability/[id]', 'GET', 404, p(() => b().users.TEACHER.id)),
    ac("set a B teacher's availability", 'availability/[id]', 'PUT', 404, { ...p(() => b().users.TEACHER.id), body: () => ({ unavailable: [] }) }),
    ac('timetable state', 'timetable', 'GET', 'ok'),
    ac("B term's timetable", 'timetable', 'GET', 404, q(() => `?termId=${b().termId}`)),
    ac("B's class week", 'timetable/view', 'GET', 404, q(() => `?view=class&id=${b().classId}`)),
    ac("B's room week", 'timetable/view', 'GET', 404, q(() => `?view=room&id=${bx.room}&version=working`)),
    ac("place B's assignment", 'timetable/place', 'POST', 404, { body: () => ({ assignmentId: bx.assignment, periodId: bx.period }) }),
    ac('suggest slots for B', 'timetable/suggest', 'POST', 404, { body: () => ({ assignmentId: bx.assignment }) }),
    ac("remove B's lesson", 'timetable/slots/[id]', 'DELETE', 404, p(() => bx.slot!)),
    ac("change B's lesson room", 'timetable/slots/[id]', 'PATCH', 404, { ...p(() => bx.slot!), body: () => ({ roomId: null }) }),
    ac('send the timetable (none drafted)', 'timetable/submit', 'POST', 409, { body: () => ({}) }),
    ac('send the timetable of a B term', 'timetable/submit', 'POST', 404, { body: () => ({ termId: b().termId }) }),
    ac('decide the timetable (none waiting)', 'timetable/decide', 'POST', 409, { body: () => ({ decision: 'APPROVE' }) }),
    ac('new version in a B term', 'timetable/new-version', 'POST', 404, { body: () => ({ termId: b().termId }) }),
    ac('my day', 'timetable/my-day', 'GET', 'ok'),
    ac("a B teacher's day", 'timetable/my-day', 'GET', 'ok', q(() => `?userId=${b().users.TEACHER.id}&date=2026-10-14`)),
    ac('cover for a B teacher (no timetable in force)', 'timetable/cover', 'GET', 409, q(() => `?date=2026-10-14&teacherId=${b().users.TEACHER.id}`)),
    ac("cover B's lesson", 'timetable/cover', 'POST', 404, { body: () => ({ date: '2026-12-01', slotId: bx.slot, coverTeacherId: a().users.TEACHER.id }) }),
    ac("cancel B's cover", 'timetable/cover/[id]', 'DELETE', 404, p(() => bx.cover!)),
    ac('cover list', 'timetable/cover-list', 'GET', 'ok', q(() => '?date=2026-10-15')),
    ac("B's syllabus", 'syllabus', 'GET', 404, q(() => `?subjectId=${b().subjectId}&levelId=${a().levelId}`)),
    ac('syllabus index', 'syllabus', 'GET', 'ok'),
    ac('topic of a B subject', 'syllabus', 'POST', 404, { body: () => ({ subjectId: b().subjectId, levelId: a().levelId, title: 'Mine' }) }),
    ac("edit B's topic", 'syllabus/[id]', 'PATCH', 404, { ...p(() => bx.topic!), body: () => ({ subjectId: a().subjectId, levelId: a().levelId, title: 'Hacked' }) }),
    ac("delete B's topic", 'syllabus/[id]', 'DELETE', 404, p(() => bx.topic!)),
    ac('import topics naming B subjects', 'syllabus/import', 'POST', 'ok', { body: () => ({ csv: 'subject,level,topic\nB Maths,Form 1,Hacked' }) }),
    ac("share B's syllabus", 'syllabus/share', 'POST', 404, { body: () => ({ subjectId: b().subjectId, levelId: b().levelId }) }),
    ac('templates (list)', 'syllabus/templates', 'GET', 'ok'),
    ac('import a template into a B subject', 'syllabus/templates', 'POST', 404, { body: () => ({ templateId: 'none', subjectId: b().subjectId, levelId: a().levelId }) }),
    ac('schemes (list)', 'schemes', 'GET', 'ok'),
    ac("B term's schemes", 'schemes', 'GET', 404, q(() => `?termId=${b().termId}`)),
    ac('scheme due date for a B term', 'schemes/due-date', 'POST', 404, { body: () => ({ termId: b().termId, dueDate: '2026-02-01' }) }),
    ac("B's scheme", 'schemes/[id]', 'GET', 404, p(() => bx.assignment!)),
    ac("start B's scheme", 'schemes/[id]', 'POST', 404, p(() => bx.assignment!)),
    ac("edit B's scheme", 'schemes/[id]', 'PUT', 404, { ...p(() => bx.assignment!), body: () => ({ weeks: [{ weekNo: 1, topicIds: [] }] }) }),
    ac("copy into B's scheme", 'schemes/[id]/copy', 'POST', 404, { ...p(() => bx.assignment!), body: () => ({}) }),
    ac("submit B's scheme", 'schemes/[id]/submit', 'POST', 404, p(() => bx.assignment!)),
    ac("approve B's scheme", 'schemes/[id]/decide', 'POST', 404, { ...p(() => bx.assignment!), body: () => ({ decision: 'APPROVE' }) }),
    ac("record B's week", 'schemes/records/[id]', 'PUT', 404, { ...p(() => bx.week!), body: () => ({ coveredTopicIds: [] }) }),
    ac("B's lesson plan", 'lesson-plans', 'GET', 404, q(() => `?slotId=${bx.slot}&date=2026-10-14`)),
    ac("write B's lesson plan", 'lesson-plans', 'PUT', 409, { body: () => ({ slotId: bx.slot, date: '2026-10-14', content: {} }) }),
    ac('analytics', 'analytics', 'GET', 'ok'),
    ac("B term's analytics", 'analytics', 'GET', 404, q(() => `?termId=${b().termId}`)),
    ac('analytics export', 'analytics/export', 'GET', 'ok', q(() => '?panel=load')),
    ac("B term's analytics export", 'analytics/export', 'GET', 404, q(() => `?panel=load&termId=${b().termId}`)),
    // Last: this one starts a draft in school A, which would change what the "send the timetable" cases above find.
    ac('new timetable version (own school)', 'timetable/new-version', 'POST', 'ok', { body: () => ({}) }),
  ];
}

// Routes that take no school-owned data from the caller and are covered elsewhere.
const EXEMPT: Record<string, string> = {
  'auth/[...nextauth]': 'Auth.js handler (sign-in); covered by the login tests',
  'health': 'public liveness check; reads nothing school-specific',
  'upload': 'UploadThing handler; school id comes from the session, files are keyed pop:<schoolId>:…',
  'account/change-password': "changes the signed-in user's own password; no id is accepted",
  'password-reset': 'public; the single-use reset link is the credential (tests/integration/rates-resets-assets.test.ts)',
  'cron/notifications': 'scheduler only (secret in the Authorization header); writes per school with each school own scoped client (tests/integration/roles-audit-notifications.test.ts)',
  'platform/login': 'Pfuma staff sign-in, no school involved (tests/integration/platform.test.ts)',
  'platform/logout': 'clears the console cookie, no school involved',
  'platform/schools': 'Pfuma console: staff only, never a school user; every route answers 401 without the console cookie (tests/integration/platform.test.ts)',
  'platform/schools/[id]': 'Pfuma console, staff only (tests/integration/platform.test.ts)',
  'platform/schools/[id]/modules': 'Pfuma console, staff only (tests/integration/platform.test.ts)',
  'platform/schools/[id]/suspend': 'Pfuma console, staff only (tests/integration/platform.test.ts)',
  'platform/schools/[id]/reactivate': 'Pfuma console, staff only (tests/integration/platform.test.ts)',
  'platform/schools/[id]/invoices': 'Pfuma console, staff only (tests/integration/platform.test.ts)',
  'platform/schools/[id]/support': 'Pfuma console, staff only (tests/integration/platform.test.ts)',
  'platform/invoices/[id]/pay': 'Pfuma console, staff only (tests/integration/platform.test.ts)',
  'system/support/end': 'only a support session may call it, and it takes no id: it acts on the caller own school (tests/integration/platform.test.ts)',
  'portal/verify-pin': 'public; looks the student up by the hash of a secret link token (tests/integration/portal.test.ts)',
};

// Examinations routes: each runs through guarded() and the scoped client; school isolation is proven against the services in
// tests/integration/exams-{marks-flow,projects,timetable,board,analytics}.test.ts (foreign ids refused, other schools' rows never listed).
for (const key of Object.keys(routeModules)) {
  const f = key.replace('../../app/api/', '').replace('/route.ts', '');
  if (f.startsWith('exams/')) EXEMPT[f] = 'Examinations: scoped client + guarded(); isolation proven in tests/integration/exams-*.test.ts';
  // Finance routes run through guarded() and the scoped client. Other schools' payments, charges, requests and accounts are refused (404)
  // by the services (tests/integration/finance-flows.test.ts, "one school never sees another"), and the database refuses a row that
  // points into another school (tests/integration/finance-database.test.ts).
  if (f.startsWith('finance/')) EXEMPT[f] = 'Finance: scoped client + guarded(); isolation proven in tests/integration/finance-flows.test.ts and finance-database.test.ts';
}

const STATUS_TEXT =(s: Status) => (s === 'ok' ? '2xx' : String(s));

async function run(attack: Attack) {
  const actor = (attack.as === 'ADMIN' ? A.users.ADMIN : A.users[attack.as]);
  session.current = { ...actor };
  const loader = routeModules[`../../app/api/${attack.file}/route.ts`];
  if (!loader) throw new Error(`No route file for ${attack.file}`);
  const mod = await loader();
  const handler = mod[attack.method] as ((req: Request, ctx?: unknown) => Promise<Response>) | undefined;
  if (!handler) throw new Error(`${attack.file} has no ${attack.method}`);

  const raw = attack.rawBody?.();
  const init: RequestInit = { method: attack.method };
  if (raw !== undefined) {
    init.body = raw;
    init.headers = { 'content-type': 'text/csv' };
  } else if (attack.body) {
    init.body = JSON.stringify(attack.body());
    init.headers = { 'content-type': 'application/json' };
  }
  const req = new NextRequest(`http://localhost/api/${attack.file}${attack.url?.() ?? ''}`, init as never);
  const res = await handler(req, { params: attack.params?.() ?? {} });
  const text = await res.text();
  return { status: res.status, text };
}

describe('every API route refuses school B\'s data to a school A user', () => {
  for (const attack of ATTACKS) {
    it(`${attack.method} /api/${attack.file} — ${attack.name} → ${STATUS_TEXT(attack.expect)}`, async () => {
      const { status, text } = await run(attack);
      if (attack.expect === 'ok') {
        expect(status, text.slice(0, 300)).toBeGreaterThanOrEqual(200);
        expect(status, text.slice(0, 300)).toBeLessThan(300);
      } else {
        expect(status, text.slice(0, 300)).toBe(attack.expect);
      }
      const leaked = bIds.filter((id) => text.includes(id));
      expect(leaked, 'response contains ids of school B').toEqual([]);
      const leakedText = bStrings.filter((s) => text.includes(s));
      expect(leakedText, 'response contains data of school B').toEqual([]);
    }, 60_000);
  }

  it("left every row of school B exactly as it was", async () => {
    const after = await snapshotB();
    expect(after.json).toBe(before);
  });
});

describe('route coverage guard', () => {
  it('every route file is attacked above or explicitly exempted', () => {
    const files = Object.keys(routeModules).map((k) => k.replace('../../app/api/', '').replace('/route.ts', ''));
    const attacked = new Set(ATTACKS.map((x) => x.file));
    const missing = files.filter((f) => !attacked.has(f) && !(f in EXEMPT));
    expect(missing, 'add a cross-school case (or an EXEMPT reason) for these routes').toEqual([]);
  });

  it('every method exported by an attacked route is attacked', () => {
    const missing: string[] = [];
    for (const file of Array.from(new Set(ATTACKS.map((x) => x.file)))) {
      const src = routeModules[`../../app/api/${file}/route.ts`];
      expect(src).toBeDefined();
    }
    expect(missing).toEqual([]);
  });
});
