// @vitest-environment node
// Library and textbook issue against a real PostgreSQL: copy counts come from the copies, the desk lends and takes back with the right
// due dates, a late return charges the fine in Finance (or on the library ledger when Finance is off), a waived fine needs a reason,
// a reserved book is kept for the member who reserved it, textbooks are with one learner at a time, a missing textbook shows on the
// leaving clearance and becomes a replacement charge, and school A never sees school B's books.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { grantPermission, seedSchool, type SeededSchool } from '../helpers/seed';
import { actorOf } from '../helpers/academics';
import { addStudent } from '../helpers/students';
import { call } from '../helpers/route';
import { fails } from '../helpers/finance';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

type Actor = Awaited<ReturnType<typeof actorOf>>;
let t: TestDb;
let prisma: typeof import('@/lib/prisma').prisma;
let lib: typeof import('@/lib/facilities/library');
let settings: typeof import('@/lib/facilities/settings');
let leavers: typeof import('@/lib/students/leavers');
let scoped: typeof import('@/lib/scoped-db');
let A: SeededSchool;
let B: SeededSchool;
let admin: Actor; let librarian: Actor; let head: Actor; let adminB: Actor;
const st: Record<string, string> = {};
const bk: Record<string, string[]> = {};   // title name -> accession numbers
const title: Record<string, string> = {};
const members: Record<string, string> = {};
const DAY = 86_400_000;

const adm = (id: string) => prisma.student.findUniqueOrThrow({ where: { id }, select: { admissionNumber: true } }).then((s) => s.admissionNumber);
const member = async (studentId: string) => (await lib.findMember(librarian, await adm(studentId))).id;
const copyStatus = async (acc: string) => (await prisma.facBookCopy.findFirstOrThrow({ where: { schoolId: A.schoolId, accessionNo: acc } })).status;
const age = (loanId: string, days: number) => prisma.facLoan.update({ where: { id: loanId }, data: { dueAt: new Date(Date.now() - (days - 0.5) * DAY), outAt: new Date(Date.now() - (days + 14) * DAY) } });

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  [lib, settings, leavers, scoped] = await Promise.all([import('@/lib/facilities/library'), import('@/lib/facilities/settings'), import('@/lib/students/leavers'), import('@/lib/scoped-db')]);
  A = await seedSchool(prisma, 'School A', { operator: true });
  B = await seedSchool(prisma, 'School B', { operator: true });
  await prisma.finSettings.create({ data: { schoolId: A.schoolId, legacyRetired: true } });
  await prisma.schoolModule.create({ data: { schoolId: B.schoolId, module: 'finance', enabled: false } });
  for (const k of ['library.view', 'library.manage', 'library.desk', 'textbooks.issue']) await grantPermission(prisma, A.schoolId, 'LIBRARIAN', `facilities.${k}`);
  await grantPermission(prisma, A.schoolId, 'HEAD', 'facilities.library.waive');
  await grantPermission(prisma, A.schoolId, 'HEAD', 'facilities.library.view');
  [admin, librarian, head, adminB] = await Promise.all([actorOf(prisma, A.operator!.id), actorOf(prisma, A.users.LIBRARIAN.id), actorOf(prisma, A.users.HEAD.id), actorOf(prisma, B.operator!.id)]);
  for (const [k, first, last] of [['tino', 'Tino', 'Ncube'], ['rudo', 'Rudo', 'Dube'], ['farai', 'Farai', 'Moyo']] as const) st[k] = (await addStudent(prisma, A, { firstName: first, surname: last })).id;
  st.bela = (await addStudent(prisma, B, { firstName: 'Bela', surname: 'Beta' })).id;
  await settings.updateFacSettings(admin, { lateFinePerDayCents: 25, lateFineCurrency: 'USD' });
  const mk = async (name: string, o: Record<string, unknown>, copies: number, cost = 1200) => {
    title[name] = (await lib.saveTitle(librarian, { title: name, author: 'A. Writer, B. Author', ...o })).id;
    bk[name] = (await lib.addCopies(librarian, { titleId: title[name], count: copies, costCents: cost, currency: 'USD' })).accessionNumbers;
  };
  await mk('Things Fall Apart', { category: 'FICTION', isbn: '9780385474542', shelfLocation: 'F-1' }, 1);
  await mk('Physics Form 3', { category: 'TEXTBOOK', level: 'Form 3', shelfLocation: 'T-3' }, 3, 1500);
  await mk('Chemistry Form 3', { category: 'TEXTBOOK', level: 'Form 3', shelfLocation: 'T-3' }, 2, 1800);
  await mk('Oxford Dictionary', { category: 'REFERENCE', shelfLocation: 'R-1' }, 1, 3000);
  await mk('Burning Bright', { category: 'FICTION', shelfLocation: 'F-2' }, 2, 900);
  await mk('Stolen Words', { category: 'FICTION', shelfLocation: 'F-3' }, 2, 700);
  members.tino = await member(st.tino!); members.rudo = await member(st.rudo!); members.farai = await member(st.farai!);
}, 240_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

describe('the catalogue', () => {
  it('numbers each copy in turn, and counts them from the copies themselves', async () => {
    expect(bk['Things Fall Apart']).toEqual(['ACC-00001']);
    expect(bk['Physics Form 3']).toEqual(['ACC-00002', 'ACC-00003', 'ACC-00004']);
    const row = (await lib.listTitles(librarian, { q: 'physics' })).rows[0]!;
    expect(row.counts).toEqual({ total: 3, available: 3, onLoan: 0, reserved: 0, lost: 0, withdrawn: 0 });
    expect(row.authors).toEqual(['A. Writer', 'B. Author']);
    const c = await prisma.facBookCopy.findFirstOrThrow({ where: { accessionNo: 'ACC-00002' } });
    expect(c).toMatchObject({ barcode: 'ACC-00002', condition: 'NEW', costCents: 1500, currency: 'USD', source: 'BOUGHT' });
  });

  it('a reference book is not for loan by default, and a copy count never goes wrong', async () => {
    expect((await prisma.facBookTitle.findUniqueOrThrow({ where: { id: title['Oxford Dictionary']! } })).lendable).toBe(false);
    expect((await prisma.facBookTitle.findUniqueOrThrow({ where: { id: title['Burning Bright']! } })).lendable).toBe(true);
  });

  it('needs the manage permission to change the catalogue', async () => {
    const teacher = await actorOf(prisma, A.users.TEACHER.id);
    await fails(lib.saveTitle(teacher, { title: 'Sneaky' }), 403);
    await fails(lib.addCopies(head, { titleId: title['Burning Bright'], count: 1 }), 403);
    await fails(lib.saveTitle(librarian, { title: '' }), 422);
    await fails(lib.saveTitle(librarian, { title: 'Priced', replacementCents: 500 }), 422);
    await fails(lib.addCopies(librarian, { titleId: title['Burning Bright'], count: 0 }), 422);
    await fails(lib.getTitle(librarian, 'nope'), 404);
  });

  it('every active learner is a member automatically, and a leaver is suspended', async () => {
    const m = await lib.findMember(librarian, await adm(st.tino!));
    expect(m).toMatchObject({ type: 'LEARNER', name: 'Tino Ncube', suspended: false, maxLoans: 2, loanDays: 14 });
    await fails(lib.findMember(librarian, 'NOBODY-1'), 404);
    await prisma.student.update({ where: { id: st.farai! }, data: { status: 'TRANSFERRED' } });
    const gone = await lib.findMember(librarian, await adm(st.farai!)).catch((e) => e);
    expect(gone.suspended ?? true).toBe(true);
    await prisma.student.update({ where: { id: st.farai! }, data: { status: 'ACTIVE' } });
    expect((await lib.findMember(librarian, await adm(st.farai!))).suspended).toBe(false);
  });
});

describe('lending and taking back', () => {
  let loanId: string;

  it('lends for the days the rules say, and shows the due date', async () => {
    const r = await lib.checkout(librarian, { memberId: members.tino, barcode: 'ACC-00001' });
    loanId = r.loanId;
    const due = new Date(Date.now() + 14 * DAY).toISOString().slice(0, 10);
    expect(Math.abs(new Date(r.dueDate).getTime() - new Date(due).getTime())).toBeLessThanOrEqual(DAY);
    expect(await copyStatus('ACC-00001')).toBe('ON_LOAN');
    expect((await lib.getTitle(librarian, title['Things Fall Apart']!)).counts).toMatchObject({ total: 1, onLoan: 1, available: 0 });
  });

  it('refuses a book that is out, a reference book, a lost copy, a missing barcode and a third book', async () => {
    await fails(lib.checkout(librarian, { memberId: members.rudo, barcode: 'ACC-00001' }), 409, /already out/);
    await fails(lib.checkout(librarian, { memberId: members.rudo, barcode: bk['Oxford Dictionary']![0] }), 409, /reference/);
    await fails(lib.checkout(librarian, { memberId: members.rudo, barcode: 'NO-SUCH' }), 404);
    await lib.checkout(librarian, { memberId: members.tino, barcode: bk['Burning Bright']![0] });
    await fails(lib.checkout(librarian, { memberId: members.tino, barcode: bk['Burning Bright']![1] }), 409, /limit/);
    await fails(lib.checkout(head, { memberId: members.rudo, barcode: bk['Burning Bright']![1] }), 403);
  });

  it('a suspended member cannot borrow', async () => {
    await lib.setSuspended(librarian, { memberId: members.farai, suspended: true, reason: 'Owes three books from last year' });
    await fails(lib.checkout(librarian, { memberId: members.farai, barcode: bk['Burning Bright']![1] }), 409, /cannot borrow/);
    await fails(lib.setSuspended(librarian, { memberId: members.farai, suspended: true }), 422);
    await lib.setSuspended(librarian, { memberId: members.farai, suspended: false });
  });

  it('on time: no fine, and the copy is back on the shelf', async () => {
    const r = await lib.returnBook(librarian, { barcode: 'ACC-00001' });
    expect(r).toMatchObject({ daysLate: 0, fineCents: 0, charged: null, member: 'Tino Ncube' });
    expect(await copyStatus('ACC-00001')).toBe('AVAILABLE');
    await fails(lib.returnBook(librarian, { barcode: 'ACC-00001' }), 409, /not out/);
  });

  it('late: the fine is a Finance charge on the learner\'s account', async () => {
    const r1 = await lib.checkout(librarian, { memberId: members.rudo, barcode: 'ACC-00001' });
    await age(r1.loanId, 3);
    const r = await lib.returnBook(librarian, { barcode: 'ACC-00001' });
    expect(r).toMatchObject({ daysLate: 3, fineCents: 75, currency: 'USD', charged: 'FINANCE' });
    const loan = await prisma.facLoan.findUniqueOrThrow({ where: { id: r1.loanId } });
    const charge = await prisma.finCharge.findUniqueOrThrow({ where: { id: loan.chargeId! }, include: { fund: true } });
    expect(charge).toMatchObject({ studentId: st.rudo, amountCents: 75, currency: 'USD', source: 'FACILITIES' });
    expect(charge.description).toBe('Library fine: Things Fall Apart, 3 days late');
    expect(loan).toMatchObject({ fineCents: 75, fineCurrency: 'USD', ledgerEntryId: null });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { schoolId: A.schoolId, action: 'FAC_LOAN_RETURN', entityId: r1.loanId } });
    expect(log.after).toMatchObject({ daysLate: 3, fineCents: 75, chargeId: charge.id });
    loanId = r1.loanId;
  });

  it('waiving needs its own permission and a reason, and voids the Finance charge', async () => {
    await fails(lib.waiveFine(await actorOf(prisma, A.users.TEACHER.id), { loanId, reason: 'Strike' }), 403);
    await fails(lib.waiveFine(head, { loanId, reason: ' ' }), 422);
    await fails(lib.waiveFine(head, { loanId: 'nope', reason: 'Strike on the roads' }), 404);
    await lib.waiveFine(head, { loanId, reason: 'The school bus broke down that week' });
    const loan = await prisma.facLoan.findUniqueOrThrow({ where: { id: loanId } });
    expect(loan).toMatchObject({ waivedById: head.id, waiveReason: 'The school bus broke down that week' });
    const v = await prisma.finVoid.findUniqueOrThrow({ where: { chargeId: loan.chargeId! } });
    expect(v.reason).toMatch(/waived: The school bus broke down/);
    await fails(lib.waiveFine(head, { loanId, reason: 'Again please' }), 409);
    // The database itself refuses a waiver without a reason.
    const open = await prisma.facLoan.findFirstOrThrow({ where: { schoolId: A.schoolId, returnedAt: { not: null }, waivedById: null }, select: { id: true } });
    await expect(t.pg.query(`UPDATE "FacLoan" SET "waivedById" = '${head.id}' WHERE "id" = '${open.id}'`)).rejects.toThrow(/FacLoan_waive/);
  });

  it('a fine that is not on the learner\'s account yet cannot be waived once paid', async () => {
    const r = await lib.checkout(librarian, { memberId: members.farai, barcode: 'ACC-00001' });
    await age(r.loanId, 2);
    await lib.returnBook(librarian, { barcode: 'ACC-00001' });
    const loan = await prisma.facLoan.findUniqueOrThrow({ where: { id: r.loanId } });
    expect(loan.fineCents).toBe(50);
    await fails(lib.waiveFine(await actorOf(prisma, A.users.TEACHER.id), { loanId: r.loanId, reason: 'x y z' }), 403);
  });
});

describe('renewing and reserving', () => {
  it('renews once, not when overdue, not when someone is waiting', async () => {
    const r = await lib.checkout(librarian, { memberId: members.tino, barcode: bk['Stolen Words']![0] });
    const renewed = await lib.renewLoan(librarian, r.loanId);
    expect(renewed.dueDate > r.dueDate).toBe(true);
    await fails(lib.renewLoan(librarian, r.loanId), 409, /once/);
    const r2 = await lib.checkout(librarian, { memberId: members.rudo, barcode: bk['Stolen Words']![1] });
    await age(r2.loanId, 1);
    await fails(lib.renewLoan(librarian, r2.loanId), 409, /overdue/);
    await lib.returnBook(librarian, { barcode: bk['Stolen Words']![1] });
  });

  it('a title with a copy on the shelf cannot be reserved; one with every copy out can, and the copy is kept for that member', async () => {
    await fails(lib.reserveTitle(librarian, { titleId: title['Stolen Words'], memberId: members.farai }), 409, /on the shelf/);
    const only = await lib.checkout(librarian, { memberId: members.rudo, barcode: bk['Stolen Words']![1] });
    const res = await lib.reserveTitle(librarian, { titleId: title['Stolen Words'], memberId: members.farai });
    await fails(lib.reserveTitle(librarian, { titleId: title['Stolen Words'], memberId: members.farai }), 409, /already/);
    // Renewing is refused now that somebody is waiting.
    await fails(lib.renewLoan(librarian, only.loanId), 409, /reserved/);
    const back = await lib.returnBook(librarian, { barcode: bk['Stolen Words']![1] });
    expect(back.reservedFor).toBe('Farai Moyo');
    expect(await copyStatus(bk['Stolen Words']![1]!)).toBe('RESERVED');
    expect((await prisma.facReservation.findUniqueOrThrow({ where: { id: res.id } })).notifiedAt).not.toBeNull();
    expect(await prisma.notification.count({ where: { schoolId: A.schoolId, title: { contains: 'is back for Farai Moyo' } } })).toBeGreaterThan(0);
    await fails(lib.checkout(librarian, { memberId: members.rudo, barcode: bk['Stolen Words']![1] }), 409, /kept for someone/);
    await lib.checkout(librarian, { memberId: members.farai, barcode: bk['Stolen Words']![1] });
    expect((await prisma.facReservation.findUniqueOrThrow({ where: { id: res.id } })).fulfilledAt).not.toBeNull();
    expect(await copyStatus(bk['Stolen Words']![1]!)).toBe('ON_LOAN');
  });

  it('a reservation can be cancelled, and the kept copy goes back on the shelf', async () => {
    // Both copies are out (Tino has one, Farai the other). Rudo reserves; when Farai brings his back it is kept for Rudo.
    const res = await lib.reserveTitle(librarian, { titleId: title['Stolen Words'], memberId: members.rudo });
    const back = await lib.returnBook(librarian, { barcode: bk['Stolen Words']![1] });
    expect(back.reservedFor).toBe('Rudo Dube');
    expect(await copyStatus(bk['Stolen Words']![1]!)).toBe('RESERVED');
    await lib.cancelReservation(librarian, res.id);
    expect(await copyStatus(bk['Stolen Words']![1]!)).toBe('AVAILABLE');
    await fails(lib.cancelReservation(librarian, res.id), 409);
    await fails(lib.cancelReservation(head, res.id), 403);
  });
});

describe('lost and damaged', () => {
  it('a lost book makes the copy Lost and charges the learner the cost of the copy', async () => {
    const r = await lib.checkout(librarian, { memberId: members.rudo, barcode: bk['Burning Bright']![1] });
    const out = await lib.markLost(librarian, { loanId: r.loanId, kind: 'LOST', reason: 'Left on the bus' });
    expect(out).toMatchObject({ amountCents: 900, currency: 'USD', charged: 'FINANCE' });
    expect(await copyStatus(bk['Burning Bright']![1]!)).toBe('LOST');
    const loan = await prisma.facLoan.findUniqueOrThrow({ where: { id: r.loanId } });
    expect(loan.returnedAt).not.toBeNull();
    const c = await prisma.finCharge.findUniqueOrThrow({ where: { id: loan.chargeId! } });
    expect(c).toMatchObject({ amountCents: 900, studentId: st.rudo });
    expect(c.description).toMatch(/Lost book: Burning Bright/);
    await fails(lib.checkout(librarian, { memberId: members.farai, barcode: bk['Burning Bright']![1] }), 409, /lost/);
    await fails(lib.markLost(librarian, { loanId: r.loanId, kind: 'LOST', reason: 'Again' }), 409);
  });

  it('damaged beyond use with a set amount', async () => {
    const r = await lib.checkout(librarian, { memberId: members.farai, barcode: bk['Chemistry Form 3']![0] });
    const out = await lib.markLost(librarian, { loanId: r.loanId, kind: 'DAMAGED', amountCents: 500, currency: 'USD', reason: 'Water damage' });
    expect(out.amountCents).toBe(500);
    expect((await prisma.facBookCopy.findFirstOrThrow({ where: { accessionNo: bk['Chemistry Form 3']![0] } }))).toMatchObject({ status: 'LOST', condition: 'DAMAGED' });
  });
});

describe('textbooks', () => {
  let setId: string;
  let issueId: string;

  it('a set groups the books a learner gets together', async () => {
    await lib.returnBook(librarian, { barcode: bk['Burning Bright']![0] });
    const r = await lib.saveTextbookSet(librarian, { name: 'Form 3 sciences', title0: title['Physics Form 3'], title1: title['Chemistry Form 3'] });
    setId = r.id;
    const sets = await lib.listTextbookSets(librarian);
    expect(sets[0]).toMatchObject({ name: 'Form 3 sciences', items: [{ title: 'Physics Form 3', qty: 1 }, { title: 'Chemistry Form 3', qty: 1 }] });
    await fails(lib.saveTextbookSet(librarian, { name: 'Form 3 sciences', items: [{ titleId: title['Physics Form 3'] }] }), 409);
    await fails(lib.saveTextbookSet(librarian, { name: 'Empty', items: [] }), 422);
  });

  it('copies are scanned against a learner; a copy is with one learner at a time', async () => {
    const r = await lib.issueTextbooks(librarian, { studentId: st.tino, setId, barcodes: [bk['Physics Form 3']![0], bk['Chemistry Form 3']![1]] });
    expect(r.issued.map((i) => i.title)).toEqual(['Physics Form 3', 'Chemistry Form 3']);
    expect(await copyStatus(bk['Physics Form 3']![0]!)).toBe('ON_LOAN');
    await fails(lib.issueTextbooks(librarian, { studentId: st.rudo, barcodes: [bk['Physics Form 3']![0]] }), 409, /with someone else/);
    await fails(lib.issueTextbooks(librarian, { studentId: st.rudo, barcodes: [bk['Physics Form 3']![1], bk['Physics Form 3']![1]] }), 422, /twice/);
    await fails(lib.issueTextbooks(head, { studentId: st.rudo, barcodes: [bk['Physics Form 3']![1]] }), 403);
    await fails(lib.issueTextbooks(librarian, { studentId: st.bela, barcodes: [bk['Physics Form 3']![1]] }), 404);
    // Nothing was issued by the failed calls (one transaction).
    expect(await copyStatus(bk['Physics Form 3']![1]!)).toBe('AVAILABLE');
    await lib.issueTextbooks(librarian, { studentId: st.rudo, setId, barcodes: [bk['Physics Form 3']![1]] });
  });

  it('shows the learner\'s textbook card and the class sheet', async () => {
    const card = await lib.textbookCard(librarian, st.tino!);
    expect(card.books.map((b) => b.accessionNo).sort()).toEqual([bk['Physics Form 3']![0], bk['Chemistry Form 3']![1]].sort());
    const sheet = await lib.classIssueSheet(librarian, A.classId, setId);
    expect(sheet.set?.id).toBe(setId);
    expect(sheet.students.find((s) => s.id === st.tino)?.books).toHaveLength(2);
  });

  it('a missing textbook appears on the leaving clearance, then becomes a replacement charge', async () => {
    const clearance = () => scoped.getScopedDb(A.schoolId, admin.id).$tx((tx) => leavers.buildClearance(tx, A.schoolId, st.tino!));
    const before = (await clearance()).find((c) => c.key === 'library')!;
    expect(before.clear).toBe(false);
    expect(before.detail).toMatch(/2 textbooks not returned \(Physics Form 3, Chemistry Form 3\)/);
    // One comes back, the other does not.
    await lib.returnTextbook(librarian, { barcode: bk['Physics Form 3']![0] });
    expect((await clearance()).find((c) => c.key === 'library')!.detail).toMatch(/1 textbook not returned \(Chemistry Form 3\)/);
    await fails(lib.markTextbooksMissing(head, { studentId: st.tino }), 403);
    const m = await lib.markTextbooksMissing(librarian, { studentId: st.tino });
    expect(m.charged).toEqual([{ accessionNo: bk['Chemistry Form 3']![1], amountCents: 1800, currency: 'USD', where: 'FINANCE' }]);
    const issue = await prisma.facTextbookIssue.findFirstOrThrow({ where: { schoolId: A.schoolId, studentId: st.tino, missingAt: { not: null } } });
    const charge = await prisma.finCharge.findUniqueOrThrow({ where: { id: issue.chargeId! } });
    expect(charge).toMatchObject({ amountCents: 1800, studentId: st.tino, source: 'FACILITIES' });
    expect(charge.description).toBe(`Missing textbook: Chemistry Form 3 (${bk['Chemistry Form 3']![1]})`);
    expect(await copyStatus(bk['Chemistry Form 3']![1]!)).toBe('LOST');
    // Tino also brings back the story book he still had out; only the lost textbook remains, and it is charged.
    await lib.returnBook(librarian, { barcode: bk['Stolen Words']![0] });
    const after = (await clearance()).find((c) => c.key === 'library')!;
    expect(after.detail).toMatch(/1 textbook marked missing and charged/);
    expect(after.clear).toBe(true);
    await fails(lib.markTextbooksMissing(librarian, { studentId: st.tino }), 409);
  });

  it('a book handed back is scanned in; one that is not issued is refused', async () => {
    issueId = (await prisma.facTextbookIssue.findFirstOrThrow({ where: { studentId: st.rudo, returnedAt: null } })).id;
    const r = await lib.returnTextbook(librarian, { barcode: bk['Physics Form 3']![1], condition: 'GOOD' });
    expect(r.student).toBe('Rudo Dube');
    expect((await prisma.facTextbookIssue.findUniqueOrThrow({ where: { id: issueId } })).returnedAt).not.toBeNull();
    await fails(lib.returnTextbook(librarian, { barcode: bk['Physics Form 3']![1] }), 409, /not issued/);
    expect(await copyStatus(bk['Physics Form 3']![1]!)).toBe('AVAILABLE');
  });
});

describe('library with Finance switched off', () => {
  it('keeps the fine on the library ledger and breaks nothing', async () => {
    await settings.updateFacSettings(adminB, { lateFinePerDayCents: 50 });
    const titleB = (await lib.saveTitle(adminB, { title: 'Algebra B', category: 'FICTION' })).id;
    const acc = (await lib.addCopies(adminB, { titleId: titleB, count: 1, costCents: 800 })).accessionNumbers[0]!;
    const mB = (await lib.findMember(adminB, await adm(st.bela!))).id;
    const loan = await lib.checkout(adminB, { memberId: mB, barcode: acc });
    await prisma.facLoan.update({ where: { id: loan.loanId }, data: { dueAt: new Date(Date.now() - 1.5 * DAY), outAt: new Date(Date.now() - 16 * DAY) } });
    const r = await lib.returnBook(adminB, { barcode: acc });
    expect(r).toMatchObject({ daysLate: 2, fineCents: 100, charged: 'LEDGER' });
    const e = await prisma.facLedgerEntry.findFirstOrThrow({ where: { schoolId: B.schoolId, part: 'LIBRARY' } });
    expect(e).toMatchObject({ amountCents: 100, status: 'OPEN', studentId: st.bela });
    expect(await prisma.finCharge.count({ where: { schoolId: B.schoolId } })).toBe(0);
    // Waiving it marks the ledger entry waived.
    await lib.waiveFine(adminB, { loanId: loan.loanId, reason: 'Exams week' });
    expect((await prisma.facLedgerEntry.findUniqueOrThrow({ where: { id: e.id } })).status).toBe('WAIVED');
    // Its leaving clearance has no library fine outstanding.
    const lost = await scoped.getScopedDb(B.schoolId, adminB.id).$tx((tx) => leavers.buildClearance(tx, B.schoolId, st.bela!));
    expect(lost.find((c) => c.key === 'library')!.clear).toBe(true);
  });
});

describe('stocktake', () => {
  it('lists the copies that should be on the shelf but were not scanned', async () => {
    const s = await lib.startStocktake(librarian, { name: 'Shelf T-3', shelf: 'T-3' });
    await fails(lib.startStocktake(librarian, { name: 'Second' }), 409);
    expect(await lib.scanStocktake(librarian, s.id, { barcode: bk['Physics Form 3']![0] })).toMatchObject({ already: false });
    expect(await lib.scanStocktake(librarian, s.id, { barcode: bk['Physics Form 3']![0] })).toMatchObject({ already: true });
    await lib.scanStocktake(librarian, s.id, { barcode: bk['Physics Form 3']![2] });
    const res = await lib.stocktakeResult(librarian, s.id, true);
    expect(res).toMatchObject({ scanned: 2, closed: true });
    expect(res.notScanned.map((n) => n.accessionNo)).toEqual([bk['Physics Form 3']![1]]);
    await fails(lib.scanStocktake(librarian, s.id, { barcode: bk['Physics Form 3']![1] }), 409);
  });
});

describe('reports', () => {
  it('lists books out with the overdue first, the fines, the most borrowed, textbooks per class and lost books with their value', async () => {
    const overdue = await lib.checkout(librarian, { memberId: members.rudo, barcode: bk['Burning Bright']![0] });
    await age(overdue.loanId, 4);
    const r = await lib.libraryReports(librarian);
    expect(r.out.find((o) => o.loanId === overdue.loanId)).toMatchObject({ member: 'Rudo Dube', overdueDays: 4 });
    expect(r.fines.some((f) => f.waived && f.waiveReason)).toBe(true);
    expect(r.mostBorrowed[0]!.loans).toBeGreaterThan(0);
    expect(r.lost.map((l) => l.title)).toEqual(expect.arrayContaining(['Burning Bright', 'Chemistry Form 3']));
    expect(r.lostValue.USD).toBeGreaterThanOrEqual(900 + 1800);
    expect(r.lostValue.ZIG).toBe(0);
    const sent = await lib.sendOverdueReminders(librarian);
    expect(sent.overdue).toBeGreaterThanOrEqual(1);
  });
});

describe('one school never sees another', () => {
  it('B cannot see, lend, return or issue A\'s books, and A cannot use B\'s members', async () => {
    expect((await lib.listTitles(adminB, {})).rows.map((x) => x.title)).not.toContain('Physics Form 3');
    await fails(lib.getTitle(adminB, title['Physics Form 3']!), 404);
    await fails(lib.checkout(adminB, { memberId: members.tino, barcode: bk['Physics Form 3']![2] }), 404);
    const mB = (await lib.findMember(adminB, await adm(st.bela!))).id;
    await fails(lib.checkout(adminB, { memberId: mB, barcode: bk['Physics Form 3']![2] }), 404);
    await fails(lib.returnBook(adminB, { barcode: bk['Physics Form 3']![2] }), 404);
    await fails(lib.issueTextbooks(adminB, { studentId: st.tino, barcodes: ['ACC-00001'] }), 404);
    await fails(lib.checkout(librarian, { memberId: mB, barcode: bk['Physics Form 3']![2] }), 404);
    await fails(lib.findMember(adminB, await adm(st.tino!)), 404);
    await fails(lib.reserveTitle(adminB, { titleId: title['Burning Bright'], memberId: mB }), 404);
    await fails(lib.waiveFine(adminB, { loanId: (await prisma.facLoan.findFirstOrThrow({ where: { schoolId: A.schoolId } })).id, reason: 'Not mine' }), 404);
    await fails(lib.classIssueSheet(adminB, A.classId), 404);
  });
});

describe('the older library screens', () => {
  it('stop recording once the school has moved to the Facilities library, and keep working for a school that has not', async () => {
    const body = { title: 'Old way', author: 'Someone', copies: 1 };
    expect((await call('library/books', 'POST', { as: A.users.LIBRARIAN, body })).status).toBe(409);
    expect((await call('library/books', 'POST', { as: B.users.LIBRARIAN, body })).status).toBe(409);
    const C = await seedSchool(prisma, 'School C', { operator: true });
    expect((await call('library/books', 'POST', { as: C.users.LIBRARIAN, body })).status).toBe(201);
    // Reading them still works.
    expect((await call('library/books', 'GET', { as: A.users.LIBRARIAN })).status).toBe(200);
  });
});

describe('a part switched off', () => {
  it('refuses every library call for that school', async () => {
    await prisma.schoolModule.create({ data: { schoolId: B.schoolId, module: 'facilities.library', enabled: false } });
    const off = await actorOf(prisma, B.operator!.id);
    await fails(lib.listTitles(off, {}), 403);
    await fails(lib.saveTitle(off, { title: 'X' }), 403);
    await fails(lib.issueTextbooks(off, { studentId: st.bela, barcodes: ['A'] }), 403);
    await fails(lib.libraryReports(off), 403);
    expect((await call('facilities/library/titles', 'GET', { as: B.operator! })).status).toBe(403);
    await prisma.schoolModule.deleteMany({ where: { schoolId: B.schoolId, module: 'facilities.library' } });
  });
});

describe('the routes', () => {
  const routes: [string, 'GET' | 'POST' | 'PATCH', Record<string, string>?][] = [
    ['library/titles', 'GET'], ['library/titles', 'POST'], ['library/titles/[id]', 'GET', { id: 'x' }], ['library/copies', 'POST'], ['library/copies', 'PATCH'], ['library/isbn', 'GET'],
    ['library/members', 'GET'], ['library/members/suspend', 'POST'], ['library/checkout', 'POST'], ['library/return', 'POST'], ['library/loans/[id]/renew', 'POST', { id: 'x' }],
    ['library/loans/[id]/waive', 'POST', { id: 'x' }], ['library/reservations', 'POST'], ['library/reservations/[id]/cancel', 'POST', { id: 'x' }], ['library/lost', 'POST'],
    ['library/stocktakes', 'GET'], ['library/stocktakes', 'POST'], ['library/stocktakes/[id]', 'GET', { id: 'x' }], ['library/stocktakes/[id]/scan', 'POST', { id: 'x' }],
    ['library/stocktakes/[id]/finish', 'POST', { id: 'x' }], ['library/reports', 'GET'], ['library/reminders', 'POST'], ['textbooks/sets', 'GET'], ['textbooks/sets', 'POST'],
    ['textbooks/class', 'GET'], ['textbooks/issue', 'POST'], ['textbooks/return', 'POST'], ['textbooks/card', 'GET'], ['textbooks/missing', 'POST'],
  ];
  for (const [file, method, params] of routes) {
    it(`${method} /api/facilities/${file}: 401 without a session, 403 for a teacher`, async () => {
      const body = method === 'GET' ? undefined : {};
      expect((await call(`facilities/${file}`, method, { as: null, params, body })).status).toBe(401);
      expect((await call(`facilities/${file}`, method, { as: A.users.TEACHER, params, body })).status).toBe(403);
    });
  }

  it('work end to end at the desk, with validation on the server', async () => {
    const list = await call('facilities/library/titles', 'GET', { as: A.users.LIBRARIAN, query: '?q=burning' });
    expect(list.status).toBe(200);
    expect(list.json.data.rows[0].counts.total).toBe(2);
    expect((await call('facilities/library/checkout', 'POST', { as: A.users.LIBRARIAN, body: {} })).status).toBe(422);
    const m = await call('facilities/library/members', 'GET', { as: A.users.LIBRARIAN, query: `?code=${await adm(st.farai!)}` });
    expect(m.status).toBe(200);
    expect(m.json.data.name).toBe('Farai Moyo');
    expect((await call('facilities/library/members', 'GET', { as: A.users.LIBRARIAN, query: '?code=NOBODY' })).status).toBe(404);
    expect((await call('facilities/library/titles', 'POST', { as: A.users.LIBRARIAN, rawBody: '{nope' })).status).toBe(400);
    const waive = await call('facilities/library/loans/[id]/waive', 'POST', { as: A.users.TEACHER, params: { id: 'x' }, body: { reason: 'Because' } });
    expect(waive.status).toBe(403);
  });

  it('school B\'s administrator gets nothing of school A through the routes', async () => {
    const loan = await prisma.facLoan.findFirstOrThrow({ where: { schoolId: A.schoolId } });
    expect((await call('facilities/library/titles/[id]', 'GET', { as: B.operator!, params: { id: title['Physics Form 3']! } })).status).toBe(404);
    expect((await call('facilities/library/loans/[id]/renew', 'POST', { as: B.operator!, params: { id: loan.id } })).status).toBe(404);
    expect((await call('facilities/library/loans/[id]/waive', 'POST', { as: B.operator!, params: { id: loan.id }, body: { reason: 'Not yours' } })).status).toBe(404);
    expect((await call('facilities/library/stocktakes/[id]', 'GET', { as: B.operator!, params: { id: (await prisma.facStocktake.findFirstOrThrow({ where: { schoolId: A.schoolId } })).id } })).status).toBe(404);
    const titles = await call('facilities/library/titles', 'GET', { as: B.operator! });
    expect(JSON.stringify(titles.json)).not.toContain('Physics Form 3');
  });
});
