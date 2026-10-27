// @vitest-environment node
// Part 5.1 (students borrow books, rules at checkout) and 5.2 (copy counts, copy statuses, lost-book charge).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, type SeededSchool } from '../helpers/seed';
import { call } from '../helpers/route';
import { defaultRegistrationValues, currentYearInHarare } from '@/lib/students/registration';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let prisma: typeof import('@/lib/prisma').prisma;
let n = 0;

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  A = await seedSchool(prisma, 'School A', { operator: true });
  B = await seedSchool(prisma, 'School B', { operator: true });
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

const L = () => A.users.LIBRARIAN;
const newBook = async (copies = 1, over: Record<string, unknown> = {}) => {
  n++;
  const book = await prisma.book.create({ data: { schoolId: A.schoolId, title: `Book ${n}`, author: 'Author', ...over } });
  const cs = [];
  for (let i = 0; i < copies; i++) {
    cs.push(await prisma.bookCopy.create({ data: { schoolId: A.schoolId, bookId: book.id, accessionNumber: `T-${n}-${i}` } }));
  }
  return { book, copies: cs };
};
const newStudent = async (status: 'ACTIVE' | 'WITHDRAWN' = 'ACTIVE') => {
  n++;
  const s = await prisma.student.create({
    data: { schoolId: A.schoolId, admissionNumber: `STU2020${String(5000 + n).padStart(4, "0")}`, firstName: 'Lib', surname: `Reader${n}`, fullName: `Lib Reader${n}`, gender: 'M', admissionDate: new Date('2026-01-10'), currentClassId: A.classId, status },
  });
  await prisma.enrollment.create({ data: { schoolId: A.schoolId, studentId: s.id, classId: A.classId, termId: A.termId, startDate: new Date('2026-01-10') } });
  const member = await prisma.libraryMember.create({ data: { schoolId: A.schoolId, studentId: s.id, memberType: 'STUDENT' } });
  return { student: s, member };
};
const checkout = (copyId: string, memberId: string) => call('library/borrowing', 'POST', { as: L(), body: { copyId, memberId } });
const lend = async (memberId: string, due?: Date) => {
  const { copies } = await newBook();
  const b = await prisma.borrowing.create({
    data: { schoolId: A.schoolId, copyId: copies[0].id, memberId, checkoutDate: new Date(Date.now() - 20 * 864e5), dueDate: due ?? new Date(Date.now() + 5 * 864e5) },
  });
  await prisma.bookCopy.update({ where: { id: copies[0].id }, data: { status: 'BORROWED' } });
  return { borrowing: b, copy: copies[0] };
};

describe('5.1 — a member is a staff user or a student, never both, never neither', () => {
  it('the database enforces it with check constraints', async () => {
    const { student } = await newStudent();
    const user = A.users.HEAD;
    const insert = (cols: string, vals: string) => t.pg.exec(`INSERT INTO "LibraryMember" ("id","schoolId",${cols}) VALUES ('lm-${++n}','${A.schoolId}',${vals})`);
    await expect(insert(`"userId","studentId","memberType"`, `'${user.id}','${student.id}','STAFF'`)).rejects.toThrow(/exactly_one_person/);
    await expect(insert(`"memberType"`, `'STAFF'`)).rejects.toThrow(/exactly_one_person/);
    await expect(insert(`"studentId","memberType"`, `'${A.studentId}','STAFF'`)).rejects.toThrow(/type_matches/);
    await expect(insert(`"userId","memberType"`, `'${A.users.BURSAR.id}','STUDENT'`)).rejects.toThrow(/type_matches/);
  });

  it("a member's person must be in the same school", async () => {
    await expect(
      t.pg.exec(`INSERT INTO "LibraryMember" ("id","schoolId","studentId","memberType") VALUES ('lm-x','${A.schoolId}','${B.studentId}','STUDENT')`),
    ).rejects.toThrow(/Cross-school reference/);
  });

  it('a person can have only one membership', async () => {
    const { student } = await newStudent();
    // (straight to Postgres: the in-memory socket drops after a database error)
    await expect(
      t.pg.exec(`INSERT INTO "LibraryMember" ("id","schoolId","studentId","memberType") VALUES ('lm-dup','${A.schoolId}','${student.id}','STUDENT')`),
    ).rejects.toThrow(/duplicate key|unique/i);
  });
});

describe('5.1 — student members: created on admission, suspended on leaving', () => {
  it('admitting a student gives them a library membership', async () => {
    const body = {
      student: {
        ...defaultRegistrationValues(),
        firstName: 'Rudo', surname: 'Ncube', gender: 'F', dateOfBirth: `${currentYearInHarare() - 13}-03-05`,
        level: 'Form 1', stream: 'North', guardianName: 'Mai Ncube', guardianRelationship: 'MOTHER',
        guardianPhone: '0771234567', houseNumber: '12', suburb: 'Mbare', city: 'Harare',
      },
    };
    const r = await call('admin/students', 'POST', { as: A.operator!, body });
    expect(r.status).toBe(201);
    const member = await prisma.libraryMember.findFirstOrThrow({ where: { student: { firstName: 'Rudo', surname: 'Ncube' } } });
    expect(member).toMatchObject({ memberType: 'STUDENT', userId: null, borrowingSuspended: false, schoolId: A.schoolId });
    expect(await prisma.auditLog.count({ where: { action: 'CREATE_LIBRARY_MEMBER', entityId: member.id } })).toBe(1);
  });

  it('withdrawing or transferring out suspends the membership; others stay active', async () => {
    const [w, tr, stays] = [await newStudent(), await newStudent(), await newStudent()];
    expect((await call('admin/students/lifecycle', 'POST', { as: A.operator!, body: { action: 'WITHDRAW', studentIds: [w.student.id], reason: 'Moved' } })).status).toBe(200);
    expect((await call('admin/students/lifecycle', 'POST', { as: A.operator!, body: { action: 'TRANSFER_OUT', studentIds: [tr.student.id] } })).status).toBe(200);
    const get = (id: string) => prisma.libraryMember.findUniqueOrThrow({ where: { id } });
    expect(await get(w.member.id)).toMatchObject({ borrowingSuspended: true, suspensionReason: 'Student withdrawn' });
    expect(await get(tr.member.id)).toMatchObject({ borrowingSuspended: true, suspensionReason: 'Student transferred out' });
    expect((await get(stays.member.id)).borrowingSuspended).toBe(false);
    expect(await prisma.auditLog.count({ where: { action: 'SUSPEND_LIBRARY_MEMBER', entityId: w.member.id } })).toBe(1);
  });

  it('graduating suspends too', async () => {
    const { suspendStudentMembers } = await import('@/lib/library');
    const { getScopedDb } = await import('@/lib/scoped-db');
    const g = await newStudent();
    await getScopedDb(A.schoolId, A.operator!.id).$tx((tx) => suspendStudentMembers(tx, A.schoolId, A.operator!.id, [g.student.id], 'Student graduated'));
    expect((await prisma.libraryMember.findUniqueOrThrow({ where: { id: g.member.id } })).suspensionReason).toBe('Student graduated');
  });

  it('a suspended student cannot borrow, but can still return what they hold', async () => {
    const s = await newStudent();
    const held = await lend(s.member.id);
    await call('admin/students/lifecycle', 'POST', { as: A.operator!, body: { action: 'WITHDRAW', studentIds: [s.student.id] } });
    const { copies } = await newBook();
    const r = await checkout(copies[0].id, s.member.id);
    expect(r.status).toBe(403);
    expect(r.json.message).toMatch(/suspended.*withdrawn/);
    const back = await call('library/borrowing/[id]/return', 'POST', { as: L(), params: { id: held.borrowing.id }, body: { conditionOnReturn: 'GOOD' } });
    expect(back.status).toBe(200);
  });

  it('members list shows students and staff with a name, search finds students by admission number', async () => {
    const s = await newStudent();
    const all = await call('library/members', 'GET', { as: L() });
    const mine = all.json.data.members.find((m: { id: string }) => m.id === s.member.id);
    expect(mine).toMatchObject({ name: s.student.fullName, memberType: 'STUDENT', detail: `Student ${s.student.admissionNumber}` });
    expect(all.json.data.members.some((m: { memberType: string }) => m.memberType === 'STAFF')).toBe(true);
    const found = await call('library/members', 'GET', { as: L(), query: `?q=${s.student.admissionNumber}` });
    expect(found.json.data.members.map((m: { id: string }) => m.id)).toEqual([s.member.id]);
  });
});

describe('5.1 — checkout rules', () => {
  it('separate loan limits: students 2 books, staff 5 by default', async () => {
    const s = await newStudent();
    for (let i = 0; i < 2; i++) expect((await checkout((await newBook()).copies[0].id, s.member.id)).status).toBe(201);
    const third = await checkout((await newBook()).copies[0].id, s.member.id);
    expect(third.status).toBe(409);
    expect(third.json.message).toMatch(/Students may borrow at most 2 books/);

    const staff = await prisma.libraryMember.findFirstOrThrow({ where: { userId: A.users.TEACHER.id } });
    // (the seeded teacher already holds one book)
    for (let i = 0; i < 4; i++) expect((await checkout((await newBook()).copies[0].id, staff.id)).status).toBe(201);
    const sixth = await checkout((await newBook()).copies[0].id, staff.id);
    expect(sixth.json.message).toMatch(/Staff may borrow at most 5 books/);
  });

  it('the limits are school settings', async () => {
    expect((await call('library/settings', 'GET', { as: L() })).json.data).toEqual({ libraryFineLimit: 5, studentLoanLimit: 2, staffLoanLimit: 5 });
    expect((await call('library/settings', 'PATCH', { as: L(), body: { studentLoanLimit: 3 } })).status).toBe(200);
    const s = await newStudent();
    for (let i = 0; i < 3; i++) expect((await checkout((await newBook()).copies[0].id, s.member.id)).status).toBe(201);
    expect((await checkout((await newBook()).copies[0].id, s.member.id)).json.message).toMatch(/at most 3 books/);
    await call('library/settings', 'PATCH', { as: L(), body: { studentLoanLimit: 2 } });
  });

  it('only library staff may change the settings; values are validated', async () => {
    for (const role of ['TEACHER', 'BURSAR'] as const) {
      expect((await call('library/settings', 'PATCH', { as: A.users[role], body: { studentLoanLimit: 9 } })).status).toBe(403);
    }
    expect((await call('library/settings', 'PATCH', { as: L(), body: { studentLoanLimit: -1 } })).status).toBe(422);
    expect((await call('library/settings', 'PATCH', { as: L(), body: {} })).status).toBe(422);
  });

  it('an overdue book blocks the next checkout until it is returned', async () => {
    const s = await newStudent();
    const late = await lend(s.member.id, new Date(Date.now() - 2 * 864e5));
    const r = await checkout((await newBook()).copies[0].id, s.member.id);
    expect(r.status).toBe(409);
    expect(r.json.message).toMatch(/1 overdue book/);
    await call('library/borrowing/[id]/return', 'POST', { as: L(), params: { id: late.borrowing.id }, body: { conditionOnReturn: 'GOOD' } });
    expect((await checkout((await newBook()).copies[0].id, s.member.id)).status).toBe(201);
  });

  it('unpaid fines above the limit block checkout; settling them clears it; exactly the limit is allowed', async () => {
    const s = await newStudent();
    const { copy } = await lend(s.member.id);
    const open = await prisma.borrowing.findFirstOrThrow({ where: { copyId: copy.id } });
    // returned late with a $6 fine (limit is $5)
    await prisma.borrowing.update({ where: { id: open.id }, data: { returnDate: new Date(), fineAmount: 6, fineSettled: false } });
    await prisma.bookCopy.update({ where: { id: copy.id }, data: { status: 'AVAILABLE' } });
    const blocked = await checkout((await newBook()).copies[0].id, s.member.id);
    expect(blocked.status).toBe(409);
    expect(blocked.json.message).toMatch(/\$6\.00 of unpaid library fines, above the limit of \$5\.00/);

    expect((await call('library/borrowing/[id]/settle-fine', 'POST', { as: L(), params: { id: open.id } })).status).toBe(200);
    expect((await call('library/borrowing/[id]/settle-fine', 'POST', { as: L(), params: { id: open.id } })).status).toBe(409); // already settled
    expect((await checkout((await newBook()).copies[0].id, s.member.id)).status).toBe(201);
    expect(await prisma.auditLog.count({ where: { action: 'SETTLE_LIBRARY_FINE', entityId: open.id } })).toBe(1);

    const s2 = await newStudent();
    const { copy: c2 } = await lend(s2.member.id);
    const b2 = await prisma.borrowing.findFirstOrThrow({ where: { copyId: c2.id } });
    await prisma.borrowing.update({ where: { id: b2.id }, data: { returnDate: new Date(), fineAmount: 5, fineSettled: false } });
    expect((await checkout((await newBook()).copies[0].id, s2.member.id)).status).toBe(201); // 5 is not above 5
  });

  it('a fine cannot be settled on a book still out, or where there is none', async () => {
    const s = await newStudent();
    const { borrowing } = await lend(s.member.id);
    expect((await call('library/borrowing/[id]/settle-fine', 'POST', { as: L(), params: { id: borrowing.id } })).status).toBe(409);
    await call('library/borrowing/[id]/return', 'POST', { as: L(), params: { id: borrowing.id }, body: { conditionOnReturn: 'GOOD' } });
    expect((await call('library/borrowing/[id]/settle-fine', 'POST', { as: L(), params: { id: borrowing.id } })).status).toBe(409);
  });
});

describe('5.2 — copy counts come from BookCopy', () => {
  it('Book has no stored copy count', async () => {
    const cols = await t.pg.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'Book' AND column_name IN ('totalCopies','numberOfCopies')`);
    expect(cols.rows).toHaveLength(0);
  });

  it('adding a book creates the copies and the counts add up whatever happens to them', async () => {
    const created = await call('library/books', 'POST', { as: L(), body: { title: 'Counting', author: 'Cantor', copies: 5 } });
    expect(created.status).toBe(201);
    const bookId = created.json.data.book.id;
    const copies = await prisma.bookCopy.findMany({ where: { bookId }, orderBy: { accessionNumber: 'asc' } });
    expect(copies).toHaveLength(5);

    const s = await newStudent();
    expect((await checkout(copies[0].id, s.member.id)).status).toBe(201); // borrowed
    await call('library/copies/[id]', 'PATCH', { as: L(), params: { id: copies[1].id }, body: { status: 'DAMAGED' } });
    await call('library/copies/[id]', 'PATCH', { as: L(), params: { id: copies[2].id }, body: { status: 'WITHDRAWN' } });
    await call('library/copies/[id]', 'PATCH', { as: L(), params: { id: copies[3].id }, body: { status: 'LOST' } });

    const list = await call('library/books', 'GET', { as: L(), query: '?q=Counting' });
    expect(list.json.data.books[0].copyCounts).toEqual({ total: 5, available: 1, borrowed: 1, lost: 1, damaged: 1, withdrawn: 1 });
    expect(list.json.data.books[0].availableCopiesCount).toBe(1);
    const one = await call('library/books/[id]', 'GET', { as: L(), params: { id: bookId } });
    expect(one.json.data.book.copyCounts).toEqual({ total: 5, available: 1, borrowed: 1, lost: 1, damaged: 1, withdrawn: 1 });
    expect(one.json.data.book.copies.find((c: { id: string }) => c.id === copies[0].id).borrowings[0].memberName).toBe(s.student.fullName);

    // adding a copy later changes the count with no other bookkeeping
    await prisma.bookCopy.create({ data: { schoolId: A.schoolId, bookId, accessionNumber: 'EXTRA-1' } });
    expect((await call('library/books', 'GET', { as: L(), query: '?q=Counting' })).json.data.books[0].copyCounts.total).toBe(6);
  });

  it('"available only" filters on the counted copies', async () => {
    const { book } = await newBook(1, { title: 'Nothing left' });
    await prisma.bookCopy.updateMany({ where: { bookId: book.id }, data: { status: 'WITHDRAWN' } });
    const r = await call('library/books', 'GET', { as: L(), query: '?available=true&q=Nothing' });
    expect(r.json.data.books).toHaveLength(0);
  });
});

describe('5.2 — copy statuses', () => {
  it('a copy handed back damaged becomes DAMAGED and cannot be lent until repaired', async () => {
    const s = await newStudent();
    const { borrowing, copy } = await lend(s.member.id);
    await call('library/borrowing/[id]/return', 'POST', { as: L(), params: { id: borrowing.id }, body: { conditionOnReturn: 'DAMAGED' } });
    expect((await prisma.bookCopy.findUniqueOrThrow({ where: { id: copy.id } })).status).toBe('DAMAGED');
    const r = await checkout(copy.id, s.member.id);
    expect(r.status).toBe(409);
    await call('library/copies/[id]', 'PATCH', { as: L(), params: { id: copy.id }, body: { status: 'AVAILABLE', condition: 'FAIR' } });
    expect((await checkout(copy.id, s.member.id)).status).toBe(201);
  });

  it('a copy on loan cannot be set available, damaged or withdrawn by hand; BORROWED cannot be set by hand', async () => {
    const s = await newStudent();
    const { copy } = await lend(s.member.id);
    for (const status of ['AVAILABLE', 'DAMAGED', 'WITHDRAWN']) {
      expect((await call('library/copies/[id]', 'PATCH', { as: L(), params: { id: copy.id }, body: { status } })).status).toBe(409);
    }
    expect((await call('library/copies/[id]', 'PATCH', { as: L(), params: { id: copy.id }, body: { status: 'BORROWED' } })).status).toBe(422);
  });

  it('lost or withdrawn copies can be put back when found', async () => {
    const { copies } = await newBook();
    for (const status of ['LOST', 'WITHDRAWN']) {
      await call('library/copies/[id]', 'PATCH', { as: L(), params: { id: copies[0].id }, body: { status } });
      expect((await prisma.bookCopy.findUniqueOrThrow({ where: { id: copies[0].id } })).status).toBe(status);
      expect((await call('library/copies/[id]', 'PATCH', { as: L(), params: { id: copies[0].id }, body: { status: 'AVAILABLE' } })).status).toBe(200);
    }
  });
});

describe('5.2 — a student who loses a book is charged its replacement cost', () => {
  it('asks for the replacement cost when the book has none, and changes nothing until it is given', async () => {
    const s = await newStudent();
    const { copy } = await lend(s.member.id);
    const r = await call('library/copies/[id]', 'PATCH', { as: L(), params: { id: copy.id }, body: { status: 'LOST' } });
    expect(r.status).toBe(422);
    expect(r.json.message).toMatch(/replacement cost/);
    expect((await prisma.bookCopy.findUniqueOrThrow({ where: { id: copy.id } })).status).toBe('BORROWED');
    expect(await prisma.charge.count({ where: { studentId: s.student.id } })).toBe(0);
  });

  it('charges the borrowing student, saves the cost on the book, closes the loan and audits', async () => {
    const s = await newStudent();
    const { copy, borrowing } = await lend(s.member.id);
    const r = await call('library/copies/[id]', 'PATCH', { as: L(), params: { id: copy.id }, body: { status: 'LOST', replacementCost: 12.5 } });
    expect(r.status).toBe(200);
    expect(r.json.data.charged).toEqual({ amount: 12.5, currency: 'USD' });
    const charge = await prisma.charge.findFirstOrThrow({ where: { studentId: s.student.id } });
    expect(charge).toMatchObject({ currency: 'USD', termId: A.termId, schoolId: A.schoolId });
    expect(charge.amount.toNumber()).toBe(12.5);
    expect(charge.label).toMatch(/^Lost library book: Book \d+ \(T-/);
    expect((await prisma.book.findUniqueOrThrow({ where: { id: copy.bookId } })).replacementCost?.toNumber()).toBe(12.5);
    expect((await prisma.borrowing.findUniqueOrThrow({ where: { id: borrowing.id } })).returnDate).not.toBeNull();
    expect((await prisma.bookCopy.findUniqueOrThrow({ where: { id: copy.id } })).status).toBe('LOST');
    expect(await prisma.auditLog.count({ where: { action: 'APPLY_CHARGE', entityId: charge.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'UPDATE_BOOK_COPY', entityId: copy.id } })).toBe(1);
  });

  it("uses the book's own replacement cost and currency", async () => {
    const s = await newStudent();
    const { book, copies } = await newBook(1, { replacementCost: 30, replacementCurrency: 'ZIG' });
    await prisma.borrowing.create({ data: { schoolId: A.schoolId, copyId: copies[0].id, memberId: s.member.id, checkoutDate: new Date(), dueDate: new Date(Date.now() + 864e5) } });
    await prisma.bookCopy.update({ where: { id: copies[0].id }, data: { status: 'BORROWED' } });
    const r = await call('library/copies/[id]', 'PATCH', { as: L(), params: { id: copies[0].id }, body: { status: 'LOST', replacementCost: 999 } });
    expect(r.json.data.charged).toEqual({ amount: 30, currency: 'ZIG' });
    expect((await prisma.book.findUniqueOrThrow({ where: { id: book.id } })).replacementCost?.toNumber()).toBe(30);
  });

  it('staff who lose a book are not charged', async () => {
    const staff = await prisma.libraryMember.findFirstOrThrow({ where: { userId: A.users.HEAD.id } }).catch(async () =>
      prisma.libraryMember.create({ data: { schoolId: A.schoolId, userId: A.users.HEAD.id, memberType: 'STAFF' } }));
    const { copy } = await lend(staff.id);
    const before = await prisma.charge.count();
    const r = await call('library/copies/[id]', 'PATCH', { as: L(), params: { id: copy.id }, body: { status: 'LOST' } });
    expect(r.status).toBe(200);
    expect(r.json.data.charged).toBeNull();
    expect(await prisma.charge.count()).toBe(before);
  });

  it('a copy that was not on loan is simply marked lost, no charge', async () => {
    const { copies } = await newBook();
    const before = await prisma.charge.count();
    expect((await call('library/copies/[id]', 'PATCH', { as: L(), params: { id: copies[0].id }, body: { status: 'LOST' } })).status).toBe(200);
    expect(await prisma.charge.count()).toBe(before);
  });

  it('needs an open term to raise the charge', async () => {
    const s = await newStudent();
    const { copy } = await lend(s.member.id);
    await prisma.academicTerm.update({ where: { id: A.termId }, data: { status: 'CLOSED', closedAt: new Date() } });
    const r = await call('library/copies/[id]', 'PATCH', { as: L(), params: { id: copy.id }, body: { status: 'LOST', replacementCost: 10 } });
    expect(r.status).toBe(409);
    expect(r.json.message).toMatch(/No term is open/);
    expect((await prisma.bookCopy.findUniqueOrThrow({ where: { id: copy.id } })).status).toBe('BORROWED');
    await prisma.academicTerm.update({ where: { id: A.termId }, data: { status: 'OPEN', closedAt: null } });
  });
});
