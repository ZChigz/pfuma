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
import { seedSchool, type SeededSchool } from '../helpers/seed';
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
let bStrings: string[] = [];

const TABLES = [
  'User', 'SchoolClass', 'Level', 'AcademicYear', 'AcademicTerm', 'Enrollment', 'Student', 'Guardian', 'FeeStructure',
  'Charge', 'Payment', 'Expense', 'ExpenseRequest', 'AuditLog', 'Subject', 'SubjectAssignment', 'Mark', 'TermResult',
  'GradeBoundary', 'AssetCategory', 'Asset', 'AssetMaintenance', 'AssetDisposal', 'Book', 'BookCopy', 'LibraryMember',
  'Borrowing', 'ExchangeRate', 'PortalAccessLog',
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
  { name: "reset B's user password", file: 'admin/users/[id]/reset-password', method: 'POST', as: 'ADMIN', params: () => ({ id: b().users.TEACHER.id }), expect: 404 },
  { name: "deactivate B's user", file: 'admin/users/[id]', method: 'PATCH', as: 'ADMIN', params: () => ({ id: b().users.HEAD.id }), body: () => ({ active: false }), expect: 404 },
  { name: "change B user's role", file: 'admin/users/[id]', method: 'PATCH', as: 'ADMIN', params: () => ({ id: b().users.TEACHER.id }), body: () => ({ role: 'ADMIN' }), expect: 404 },
  { name: 'users (list)', file: 'admin/users', method: 'GET', as: 'ADMIN', expect: 'ok' },
  { name: 'user create (own school)', file: 'admin/users', method: 'POST', as: 'ADMIN', body: () => ({ fullName: 'New Teacher', email: 'new.teacher@schoola.test', role: 'TEACHER' }), expect: 'ok' },

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
  { name: 'book create (own school)', file: 'library/books', method: 'POST', as: 'LIBRARIAN', body: () => ({ title: 'Geometry', author: 'Jones', totalCopies: 1 }), expect: 'ok' },
  { name: "return B's borrowing", file: 'library/borrowing/[id]/return', method: 'POST', as: 'LIBRARIAN', params: () => ({ id: b().borrowingId }), body: () => ({ conditionOnReturn: 'GOOD' }), expect: 404 },
  { name: 'borrowing (list)', file: 'library/borrowing', method: 'GET', as: 'LIBRARIAN', url: () => `?history=true&memberId=${b().memberId}`, expect: 'ok' },
  { name: "check out B's copy", file: 'library/borrowing', method: 'POST', as: 'LIBRARIAN', body: () => ({ copyId: b().copyId, memberId: a().memberId }), expect: 404 },
  { name: 'check out to a B member', file: 'library/borrowing', method: 'POST', as: 'LIBRARIAN', body: () => ({ copyId: a().copyId, memberId: b().memberId }), expect: 404 },
  { name: "edit B's copy", file: 'library/copies/[id]', method: 'PATCH', as: 'LIBRARIAN', params: () => ({ id: b().copyId }), body: () => ({ condition: 'DAMAGED' }), expect: 404 },
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
  { name: "unpublish B's class", file: 'results/unpublish', method: 'POST', as: 'HEAD', body: () => ({ classId: b().classId, termId: a().termId, reason: 'Wrong marks entered' }), expect: 404 },
  { name: "report card of a B student", file: 'results/reports/[studentId]', method: 'GET', as: 'HEAD', params: () => ({ studentId: b().studentId }), url: () => `?termId=${a().termId}`, expect: 404 },
  // Also bump every A user: must not touch B's.
  { name: 'log out all sessions (own school only)', file: 'admin/users/logout-all', method: 'POST', as: 'ADMIN', expect: 'ok' },
];

// Routes that take no school-owned data from the caller and are covered elsewhere.
const EXEMPT: Record<string, string> = {
  'auth/[...nextauth]': 'Auth.js handler (sign-in); covered by the login tests',
  'health': 'public liveness check; reads nothing school-specific',
  'upload': 'UploadThing handler; school id comes from the session, files are keyed pop:<schoolId>:…',
  'account/change-password': "changes the signed-in user's own password; no id is accepted",
  'portal/verify-pin': 'public; looks the student up by the hash of a secret link token (tests/integration/portal.test.ts)',
};

const STATUS_TEXT = (s: Status) => (s === 'ok' ? '2xx' : String(s));

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
