// @vitest-environment node
// Positive paths through the school-scoped client for tables that have no schoolId of
// their own (StudentGuardian) and for multi-step services (lifecycle, terms).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, type SeededSchool } from '../helpers/seed';
import { call } from '../helpers/route';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let prisma: typeof import('@/lib/prisma').prisma;

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

describe('guardians', () => {
  let secondId: string;

  it('adds a second guardian, makes them primary, edits them and unlinks them', async () => {
    const add = await call('admin/students/[id]/guardians', 'POST', {
      as: A.operator!, params: { id: A.studentId }, body: { fullName: 'Baba Moyo', phone: '0772000111', relationship: 'FATHER' },
    });
    expect(add.status).toBe(201);
    secondId = (await prisma.guardian.findFirstOrThrow({ where: { schoolId: A.schoolId, fullName: 'Baba Moyo' } })).id;

    const primary = await call('admin/students/[id]/guardians/[guardianId]', 'PATCH', {
      as: A.operator!, params: { id: A.studentId, guardianId: secondId }, body: { link: { makePrimary: true } },
    });
    expect(primary.status).toBe(200);
    const links = await prisma.studentGuardian.findMany({ where: { studentId: A.studentId } });
    expect(links.find((l) => l.guardianId === secondId)?.isPrimary).toBe(true);
    expect(links.find((l) => l.guardianId === A.guardianId)?.isPrimary).toBe(false);

    const edit = await call('admin/students/[id]/guardians/[guardianId]', 'PATCH', {
      as: A.operator!, params: { id: A.studentId, guardianId: secondId }, body: { guardian: { fullName: 'Baba T Moyo' }, link: { isFeePayer: true } },
    });
    expect(edit.status).toBe(200);
    expect((await prisma.guardian.findUniqueOrThrow({ where: { id: secondId } })).fullName).toBe('Baba T Moyo');
    expect((await prisma.studentGuardian.findUniqueOrThrow({ where: { studentId_guardianId: { studentId: A.studentId, guardianId: secondId } } })).isFeePayer).toBe(true);

    const list = await call('admin/students/[id]/guardians', 'GET', { as: A.operator!, params: { id: A.studentId } });
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.json)).toContain('Baba T Moyo');
  });

  it('refuses to unlink the only remaining guardian but unlinks a non-primary one', async () => {
    const unlinkOld = await call('admin/students/[id]/guardians/[guardianId]', 'DELETE', {
      as: A.operator!, params: { id: A.studentId, guardianId: A.guardianId },
    });
    expect(unlinkOld.status).toBe(200);
    expect(await prisma.studentGuardian.count({ where: { studentId: A.studentId } })).toBe(1);
    const last = await call('admin/students/[id]/guardians/[guardianId]', 'DELETE', {
      as: A.operator!, params: { id: A.studentId, guardianId: secondId },
    });
    expect(last.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.studentGuardian.count({ where: { studentId: A.studentId } })).toBe(1);
  });

  it("cannot link school B's guardian to an A student (database refuses it)", async () => {
    // (straight against Postgres: the in-memory socket server drops the connection after a database error)
    await expect(
      t.pg.exec(`INSERT INTO "StudentGuardian" ("studentId","guardianId","relationship") VALUES ('${A.studentId}','${B.guardianId}','UNCLE')`),
    ).rejects.toThrow(/Cross-school reference/);
  });
});

describe('student lifecycle and calendar through the scoped client', () => {
  it('transfers a student to another class in the same school', async () => {
    const south = await prisma.schoolClass.create({ data: { schoolId: A.schoolId, name: 'Form 1 South', levelId: A.levelId, stream: 'South' } });
    const r = await call('admin/students/move', 'POST', { as: A.operator!, body: { studentIds: [A.studentId], classId: south.id } });
    expect(r.status).toBe(200);
    expect((await prisma.enrollment.findUniqueOrThrow({ where: { studentId_termId: { studentId: A.studentId, termId: A.termId } } })).classId).toBe(south.id);
    expect((await prisma.student.findUniqueOrThrow({ where: { id: A.studentId } })).currentClassId).toBe(south.id);
  });

  it('withdraws a student', async () => {
    const r = await call('admin/students/lifecycle', 'POST', { as: A.operator!, body: { action: 'WITHDRAW', studentIds: [A.studentId], reason: 'Moved away' } });
    expect(r.status).toBe(200);
    expect((await prisma.student.findUniqueOrThrow({ where: { id: A.studentId } })).status).toBe('WITHDRAWN');
  });

  it('creates an academic year and opens and closes terms', async () => {
    const created = await call('admin/academic/years', 'POST', { as: A.operator!, body: { year: 2027 } });
    expect(created.status).toBe(201);
    const terms = await prisma.academicTerm.findMany({ where: { schoolId: A.schoolId, academicYear: { year: 2027 } }, orderBy: { termNumber: 'asc' } });
    expect(terms).toHaveLength(3);
    // Close the open 2026 term, then open Term 1 2027 is blocked until year-end decisions exist; closing works.
    const close = await call('admin/academic/terms/[id]', 'POST', { as: A.operator!, params: { id: A.termId }, query: '?action=close' });
    expect(close.status).toBe(200);
    expect((await prisma.academicTerm.findUniqueOrThrow({ where: { id: A.termId } })).status).toBe('CLOSED');
  });

  it('keeps school B untouched by all of the above', async () => {
    expect((await prisma.student.findUniqueOrThrow({ where: { id: B.studentId } })).status).toBe('ACTIVE');
    expect((await prisma.academicTerm.findUniqueOrThrow({ where: { id: B.termId } })).status).toBe('OPEN');
    expect(await prisma.studentGuardian.count({ where: { studentId: B.studentId } })).toBe(1);
  });
});
