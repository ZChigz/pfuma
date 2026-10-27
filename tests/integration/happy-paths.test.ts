// @vitest-environment node
// The ordinary (successful) flows of the remaining API routes, now that every route goes
// through the school-scoped client. Proves the switch did not break what already worked.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, type SeededSchool } from '../helpers/seed';
import { call } from '../helpers/route';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

let t: TestDb;
let A: SeededSchool;
let prisma: typeof import('@/lib/prisma').prisma;

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  A = await seedSchool(prisma, 'School A', { operator: true });
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

describe('assets', () => {
  let id: string;
  it('create, list, read, edit, maintain, dispose', async () => {
    const created = await call('assets', 'POST', {
      as: A.users.BURSAR,
      body: { name: 'Projector', categoryId: A.assetCategoryId, tagNumber: 'PRJ-1', acquisitionDate: '2026-02-01', acquisitionCost: 400, currency: 'USD', location: 'Lab', condition: 'GOOD' },
    });
    expect(created.status).toBe(201);
    id = created.json.data.asset.id;
    expect((await call('assets', 'GET', { as: A.users.HEAD })).json.data.assets.map((a: { id: string }) => a.id)).toContain(id);
    expect((await call('assets/[id]', 'GET', { as: A.users.HEAD, params: { id } })).status).toBe(200);
    expect((await call('assets/[id]', 'PATCH', { as: A.users.BURSAR, params: { id }, body: { location: 'Staff room' } })).status).toBe(200);
    expect((await call('assets/[id]/maintenance', 'POST', { as: A.users.BURSAR, params: { id }, body: { maintenanceDate: '2026-05-01', description: 'Lamp replaced', cost: 20, currency: 'USD' } })).status).toBe(201);
    const disposed = await call('assets/[id]/dispose', 'POST', { as: A.users.DIRECTOR, params: { id }, body: { disposalDate: '2026-09-01', reason: 'Beyond repair', method: 'SCRAPPED' } });
    expect(disposed.status).toBeLessThan(300);
    expect((await prisma.asset.findUniqueOrThrow({ where: { id } })).status).toBe('DISPOSED');
  });
});

describe('library', () => {
  it('add a book, check a copy out, list, return it, change a copy', async () => {
    const book = await call('library/books', 'POST', { as: A.users.LIBRARIAN, body: { title: 'Physics 1', author: 'Newton', copies: 2 } });
    expect(book.status).toBe(201);
    const bookId = book.json.data.book.id;
    const copies = await prisma.bookCopy.findMany({ where: { bookId }, orderBy: { accessionNumber: 'asc' } });
    expect(copies).toHaveLength(2);

    expect((await call('library/books', 'GET', { as: A.users.LIBRARIAN, query: '?q=Physics' })).json.data.books).toHaveLength(1);
    expect((await call('library/books/[id]', 'GET', { as: A.users.LIBRARIAN, params: { id: bookId } })).status).toBe(200);
    expect((await call('library/books/[id]', 'PATCH', { as: A.users.LIBRARIAN, params: { id: bookId }, body: { title: 'Physics Form 1' } })).status).toBe(200);
    expect((await call('library/members', 'GET', { as: A.users.LIBRARIAN })).status).toBe(200);

    const out = await call('library/borrowing', 'POST', { as: A.users.LIBRARIAN, body: { copyId: copies[0].id, memberId: A.memberId } });
    expect(out.status).toBe(201);
    const borrowingId = out.json.data.borrowing.id;
    expect((await call('library/borrowing', 'GET', { as: A.users.LIBRARIAN })).json.data.borrowings.length).toBeGreaterThan(0);
    const back = await call('library/borrowing/[id]/return', 'POST', { as: A.users.LIBRARIAN, params: { id: borrowingId }, body: { conditionOnReturn: 'GOOD' } });
    expect(back.status).toBe(200);
    expect((await prisma.bookCopy.findUniqueOrThrow({ where: { id: copies[0].id } })).status).toBe('AVAILABLE');
    expect((await call('library/copies/[id]', 'PATCH', { as: A.users.LIBRARIAN, params: { id: copies[1].id }, body: { condition: 'FAIR' } })).status).toBe(200);
  });
});

describe('fees', () => {
  it('create and edit a fee structure, then apply it to a class and to a level', async () => {
    const fs = await call('accounting/fee-structures', 'POST', { as: A.users.BURSAR, body: { levelId: A.levelId, termId: A.termId, label: 'Boarding', currency: 'USD', amount: 80 } });
    expect(fs.status).toBe(201);
    const id = fs.json.data.feeStructure.id;
    expect((await call('accounting/fee-structures/[id]', 'PATCH', { as: A.users.BURSAR, params: { id }, body: { amount: 90 } })).status).toBe(200);

    const byClass = await call('accounting/fees/bulk-apply', 'POST', { as: A.users.BURSAR, body: { scope: 'class', classId: A.classId, feeStructureId: id, termId: A.termId } });
    expect(byClass.status).toBe(200);
    expect(byClass.json.data.applied).toBe(1);
    const again = await call('accounting/fees/bulk-apply', 'POST', { as: A.users.BURSAR, body: { scope: 'level', levelId: A.levelId, feeStructureId: id, termId: A.termId } });
    expect(again.json.data).toMatchObject({ applied: 0, skipped: 1 });
    expect(await prisma.charge.count({ where: { studentId: A.studentId, label: 'Boarding' } })).toBe(1);
  });

  it('charge a student, list students and read an account', async () => {
    expect((await call('accounting/students/[id]/charges', 'POST', { as: A.users.BURSAR, params: { id: A.studentId }, body: { studentId: A.studentId, label: 'Trip', currency: 'USD', amount: 10, termId: A.termId } })).status).toBe(201);
    const list = await call('accounting/students', 'GET', { as: A.users.BURSAR });
    expect(list.status).toBe(200);
    const one = await call('accounting/students/[id]', 'GET', { as: A.users.BURSAR, params: { id: A.studentId } });
    expect(one.json.data.balanceUSD).toBeGreaterThan(0);
    expect((await call('accounting/dashboard', 'GET', { as: A.users.DIRECTOR })).status).toBe(200);
    expect((await call('accounting/exchange-rate', 'POST', { as: A.users.BURSAR, body: { usdToZig: 26.5 } })).status).toBeLessThan(300);
    expect((await call('accounting/exchange-rate', 'GET', { as: A.users.BURSAR })).json.data.rate.usdToZig).toBeDefined();
  });
});

describe('expense request, end to end', () => {
  it('raise, submit, approve, disburse', async () => {
    const created = await call('accounting/requests', 'POST', {
      as: A.users.TEACHER,
      body: { title: 'Lab chemicals', type: 'PURCHASE_ORDER', department: 'Science', justification: 'Practicals', currency: 'USD', items: [{ description: 'Acid', quantity: 2, unitPrice: 15 }, { description: 'Beakers', quantity: 10, unitPrice: 3 }] },
    });
    expect(created.status).toBe(201);
    const id = created.json.data.request.id;
    expect(await prisma.expenseRequestItem.count({ where: { requestId: id } })).toBe(2);
    expect((await call('accounting/requests/[id]/submit', 'POST', { as: A.users.TEACHER, params: { id } })).status).toBe(200);
    expect((await call('accounting/requests/[id]/approve', 'POST', { as: A.users.HEAD, params: { id } })).status).toBe(200);
    const paid = await call('accounting/requests/[id]/disburse', 'POST', { as: A.users.BURSAR, params: { id }, body: { actualTotal: 58, paymentMethod: 'CASH' } });
    expect(paid.status).toBe(200);
    expect(await prisma.expense.count({ where: { expenseRequestId: id } })).toBe(1);
    const list = await call('accounting/requests', 'GET', { as: A.users.HEAD });
    expect(list.json.data.requests.length).toBeGreaterThan(0);
  });
});

describe('classes, subjects, assignments, settings', () => {
  it('create and edit a class, read it with its roster, change the default capacity', async () => {
    const c = await call('admin/classes', 'POST', { as: A.operator!, body: { levelId: A.levelId, stream: 'East', capacity: 30, classTeacherId: A.users.TEACHER.id } });
    expect(c.status).toBe(201);
    const id = c.json.data.class.id;
    expect((await call('admin/classes/[id]', 'PATCH', { as: A.operator!, params: { id }, body: { capacity: 35 } })).status).toBe(200);
    expect((await call('admin/classes/[id]', 'GET', { as: A.operator!, params: { id: A.classId } })).json.data.students).toHaveLength(1);
    expect((await call('admin/classes', 'GET', { as: A.operator! })).json.data.classes.length).toBeGreaterThanOrEqual(2);
    expect((await call('admin/settings', 'PATCH', { as: A.operator!, body: { maxClassSize: 50 } })).status).toBe(200);
    expect((await call('admin/settings', 'GET', { as: A.operator! })).json.data.maxClassSize).toBe(50);
  });

  it('create and edit a subject, assign a teacher, list and remove the assignment', async () => {
    const s = await call('admin/subjects', 'POST', { as: A.operator!, body: { name: 'Geography', code: 'GEO' } });
    expect(s.status).toBe(201);
    const subjectId = s.json.data.subject.id;
    expect((await call('admin/subjects/[id]', 'PATCH', { as: A.operator!, params: { id: subjectId }, body: { maxMark: 80 } })).status).toBe(200);
    const a = await call('admin/assignments', 'POST', { as: A.operator!, body: { teacherId: A.users.TEACHER.id, subjectId, classId: A.classId, termId: A.termId } });
    expect(a.status).toBe(201);
    const assignmentId = a.json.data.assignment.id;
    expect((await call('admin/assignments', 'GET', { as: A.users.HEAD, query: `?classId=${A.classId}` })).json.data.assignments.length).toBeGreaterThan(1);
    expect((await call('admin/assignments/teacher-load', 'GET', { as: A.operator!, query: `?teacherId=${A.users.TEACHER.id}&termId=${A.termId}` })).status).toBe(200);
    expect((await call('admin/assignments', 'DELETE', { as: A.operator!, query: `?id=${assignmentId}` })).status).toBe(200);
    expect((await call('admin/subjects', 'GET', { as: A.operator! })).json.data.subjects.length).toBeGreaterThan(1);
  });
});

describe('students', () => {
  it('imports a CSV, then lists and edits the new students', async () => {
    const year = new Date().getFullYear() - 13;
    const csv = [
      'first_name,surname,gender,date_of_birth,level,stream,guardian_name,guardian_relationship,guardian_phone,address',
      `Farai,Chikwanha,Male,${year}-04-21,Form 1,North,Rudo Chikwanha,Mother,0771234500,"12 Kuwadzana, Harare"`,
      `Nyasha,Dube,Female,${year}-06-02,Form 1,North,Tapiwa Dube,Father,0712345678,"7 Mbare, Harare"`,
    ].join('\n');
    const r = await call('admin/students/import', 'POST', { as: A.operator!, rawBody: csv, headers: { 'content-type': 'text/csv' } });
    expect(r.status).toBe(200);
    expect(r.json.data.imported ?? r.json.data.admitted ?? r.json.data.created).toBe(2);
    const list = await call('admin/students', 'GET', { as: A.operator! });
    expect(list.json.data.students.length).toBeGreaterThanOrEqual(3);
    const farai = await prisma.student.findFirstOrThrow({ where: { schoolId: A.schoolId, firstName: 'Farai' } });
    expect(farai.portalTokenHash).toBeNull(); // no plaintext token is created any more
    expect(farai.portalToken).toBeNull();
    expect((await call('accounting/students/[id]', 'PATCH', { as: A.operator!, params: { id: farai.id }, body: { previousSchool: 'Mbare Primary' } })).status).toBe(200);
  });
});

describe('results', () => {
  it('boundaries, marks, verify, unlock, export and report card', async () => {
    expect((await call('results/grade-boundaries', 'POST', { as: A.operator!, body: { boundaries: [{ minPercent: 50, maxPercent: 100, letterGrade: 'P' }, { minPercent: 0, maxPercent: 49.99, letterGrade: 'F' }] } })).status).toBe(200);
    expect((await call('results/grade-boundaries', 'GET', { as: A.users.HEAD })).json.data.boundaries).toHaveLength(2);

    const q = `?classId=${A.classId}&subjectId=${A.subjectId}&termId=${A.termId}`;
    expect((await call('results/marks', 'GET', { as: A.users.TEACHER, query: q })).status).toBe(200);
    const mark = await call('results/marks', 'POST', { as: A.users.TEACHER, body: { studentId: A.studentId, subjectId: A.subjectId, classId: A.classId, termId: A.termId, rawMark: 72 } });
    expect(mark.status).toBe(200);
    expect(mark.json.data.mark.letterGrade).toBe('P');

    // Verifying needs a row for every enrolled student: the others (imported earlier) are marked absent.
    const refused = await call('results/marks/verify', 'POST', { as: A.operator!, body: { assignmentId: A.assignmentId } });
    expect(refused.status).toBe(422);
    const others = await prisma.enrollment.findMany({ where: { classId: A.classId, termId: A.termId, studentId: { not: A.studentId } } });
    for (const e of others) {
      const abs = await call('results/marks', 'POST', { as: A.users.TEACHER, body: { studentId: e.studentId, subjectId: A.subjectId, classId: A.classId, termId: A.termId, status: 'ABSENT' } });
      expect(abs.status).toBe(200);
    }
    const verify = await call('results/marks/verify', 'POST', { as: A.operator!, body: { assignmentId: A.assignmentId } });
    expect(verify.status).toBe(200);
    expect((await prisma.subjectAssignment.findUniqueOrThrow({ where: { id: A.assignmentId } })).marksStatus).toBe('VERIFIED');
    expect((await call('results/marks/unverify', 'POST', { as: A.users.HEAD, body: { assignmentId: A.assignmentId } })).status).toBe(200);
    expect((await prisma.subjectAssignment.findUniqueOrThrow({ where: { id: A.assignmentId } })).marksStatus).toBe('IN_PROGRESS');
    await call('results/marks/verify', 'POST', { as: A.operator!, body: { assignmentId: A.assignmentId } });
    expect((await call('results/publish', 'POST', { as: A.users.HEAD, body: { classId: A.classId, termId: A.termId } })).status).toBe(200);

    const xlsx = await call('results/export', 'GET', { as: A.users.HEAD, query: `?classId=${A.classId}&termId=${A.termId}` });
    expect(xlsx.status).toBe(200);
    expect(xlsx.response.headers.get('content-type')).toMatch(/spreadsheetml/);
    const pdf = await call('results/reports/[studentId]', 'GET', { as: A.users.HEAD, params: { studentId: A.studentId }, query: `?termId=${A.termId}` });
    expect(pdf.status).toBe(200);
    expect(pdf.response.headers.get('content-type')).toBe('application/pdf');
  }, 60_000);
});
