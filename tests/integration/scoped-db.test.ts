// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, type SeededSchool } from '../helpers/seed';

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let prisma: typeof import('@/lib/prisma').prisma;
let getScopedDb: typeof import('@/lib/scoped-db').getScopedDb;

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  ({ getScopedDb } = await import('@/lib/scoped-db'));
  A = await seedSchool(prisma, 'School A');
  B = await seedSchool(prisma, 'School B');
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

describe('getScopedDb — query scoping', () => {
  it("lists only the caller's rows", async () => {
    const db = getScopedDb(A.schoolId, A.users.ADMIN.id);
    const students = await db.student.findMany();
    expect(students.map((s) => s.id)).toEqual([A.studentId]);
    expect((await db.payment.findMany()).every((p) => p.schoolId === A.schoolId)).toBe(true);
  });

  it("cannot read another school's row by id", async () => {
    const db = getScopedDb(A.schoolId, A.users.ADMIN.id);
    expect(await db.student.findUnique({ where: { id: B.studentId } })).toBeNull();
    expect(await db.student.findFirst({ where: { id: B.studentId } })).toBeNull();
    expect(await db.student.count({ where: { id: B.studentId } })).toBe(0);
  });

  it("cannot update or delete another school's row", async () => {
    const db = getScopedDb(A.schoolId, A.users.ADMIN.id);
    await expect(db.student.update({ where: { id: B.studentId }, data: { medicalNotes: 'x' } })).rejects.toThrow();
    await expect(db.student.delete({ where: { id: B.studentId } })).rejects.toThrow();
    expect((await db.student.updateMany({ where: { id: B.studentId }, data: { medicalNotes: 'x' } })).count).toBe(0);
    expect((await db.student.deleteMany({ where: { id: B.studentId } })).count).toBe(0);
    const still = await prisma.student.findUnique({ where: { id: B.studentId } });
    expect(still?.medicalNotes).toBeNull();
  });

  it('adds schoolId to creates and refuses another school', async () => {
    const db = getScopedDb(A.schoolId, A.users.ADMIN.id);
    const g = await db.guardian.create({ data: { fullName: 'New', phone: '+263772000000' } as never });
    expect(g.schoolId).toBe(A.schoolId);
    await expect(
      db.guardian.create({ data: { schoolId: B.schoolId, fullName: 'Sneaky', phone: '+263772000001' } }),
    ).rejects.toThrow(/another school/);
  });

  it('refuses to move a row to another school', async () => {
    const db = getScopedDb(A.schoolId, A.users.ADMIN.id);
    await expect(
      db.guardian.update({ where: { id: A.guardianId }, data: { schoolId: B.schoolId } }),
    ).rejects.toThrow(/another school/);
  });

  it('scopes school lookups and child tables', async () => {
    const db = getScopedDb(A.schoolId, A.users.ADMIN.id);
    await expect(db.school.findUnique({ where: { id: B.schoolId } })).rejects.toThrow(/another school/);
    expect((await db.school.findUnique({ where: { id: A.schoolId } }))?.name).toBe('School A');
    const links = await db.studentGuardian.findMany();
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((l) => l.studentId !== B.studentId)).toBe(true);
    expect((await db.expenseRequestItem.findMany()).length).toBe(1);
  });

  it('runs a transaction with the school context and rolls it back on error', async () => {
    const db = getScopedDb(A.schoolId, A.users.ADMIN.id);
    await expect(
      db.$tx(async (tx) => {
        await tx.guardian.create({ data: { fullName: 'Rolled back', phone: '+263772111111' } as never });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await prisma.guardian.count({ where: { fullName: 'Rolled back' } })).toBe(0);
  });
});

describe('row-level security (second layer)', () => {
  it("hides other schools' rows from a session that only set app.school_id", async () => {
    const rows = await prisma.$transaction([
      prisma.$executeRaw`SELECT set_config('app.school_id', ${A.schoolId}, true)`,
      prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "Student"`,
    ]);
    const ids = (rows[1] as { id: string }[]).map((r) => r.id);
    expect(ids).toContain(A.studentId);
    expect(ids).not.toContain(B.studentId);
  });

  it('blocks writes to another school even with raw SQL', async () => {
    await prisma.$transaction([
      prisma.$executeRaw`SELECT set_config('app.school_id', ${A.schoolId}, true)`,
      prisma.$executeRaw`UPDATE "Student" SET "medicalNotes" = 'hacked' WHERE id = ${B.studentId}`,
    ]); // RLS makes the UPDATE match zero rows
    expect((await prisma.student.findUnique({ where: { id: B.studentId } }))?.medicalNotes).toBeNull();
  });

  it('rejects an INSERT for another school (checked straight against Postgres)', async () => {
    await expect(
      t.pg.transaction(async (tx) => {
        await tx.query(`SELECT set_config('app.school_id', $1, true)`, [A.schoolId]);
        await tx.query(
          `INSERT INTO "Guardian" ("id","schoolId","fullName","phone") VALUES ('x1', $1, 'Evil', '+263')`,
          [B.schoolId],
        );
      }),
    ).rejects.toThrow(/row-level security/);
  });

  it('applies to child tables through their parent', async () => {
    const rows = await prisma.$transaction([
      prisma.$executeRaw`SELECT set_config('app.school_id', ${A.schoolId}, true)`,
      prisma.$queryRaw<{ studentId: string }[]>`SELECT "studentId" FROM "StudentGuardian"`,
    ]);
    const ids = (rows[1] as { studentId: string }[]).map((r) => r.studentId);
    expect(ids).not.toContain(B.studentId);
  });
});

describe('audit trigger', () => {
  it('records before/after JSON for creates, updates and deletes made through the scoped client', async () => {
    const db = getScopedDb(A.schoolId, A.users.ADMIN.id);
    const g = await db.guardian.create({ data: { fullName: 'Audited', phone: '+263773000000' } as never });
    await db.guardian.update({ where: { id: g.id }, data: { phone: '+263773999999' } });
    await db.guardian.delete({ where: { id: g.id } });

    const rows = await prisma.auditLog.findMany({
      where: { entityType: 'Guardian', entityId: g.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.map((r) => r.action)).toEqual(['DATA_CREATE', 'DATA_UPDATE', 'DATA_DELETE']);
    expect(rows[0].before).toBeNull();
    expect((rows[0].after as { phone: string }).phone).toBe('+263773000000');
    expect((rows[1].before as { phone: string }).phone).toBe('+263773000000');
    expect((rows[1].after as { phone: string }).phone).toBe('+263773999999');
    expect(rows[2].after).toBeNull();
    expect(rows.every((r) => r.actorId === A.users.ADMIN.id && r.schoolId === A.schoolId)).toBe(true);
  });

  it('never stores password hashes', async () => {
    const db = getScopedDb(A.schoolId, A.users.ADMIN.id);
    await db.user.update({
      where: { id: A.users.TEACHER.id },
      data: { passwordHash: 'new-hash', tokenVersion: { increment: 1 } },
    });
    const row = await prisma.auditLog.findFirst({
      where: { entityType: 'User', entityId: A.users.TEACHER.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(JSON.stringify(row)).not.toMatch(/passwordHash/);
    expect(JSON.stringify(row)).not.toMatch(/new-hash/);
  });

  it('covers Student, Enrollment, Charge, Payment, Expense and Mark', async () => {
    const db = getScopedDb(A.schoolId, A.users.ADMIN.id);
    await db.student.update({ where: { id: A.studentId }, data: { medicalNotes: 'asthma' } });
    await db.charge.update({ where: { id: A.chargeId }, data: { label: 'Tuition T1' } });
    await db.payment.update({ where: { id: A.paymentId }, data: { reference: 'R1' } });
    await db.expense.update({ where: { id: A.expenseId }, data: { note: 'n' } });
    await db.mark.update({ where: { id: A.markId }, data: { rawMark: 61 } });
    const enr = await db.enrollment.findFirstOrThrow();
    await db.enrollment.update({ where: { id: enr.id }, data: { status: 'PROMOTED' } });
    const types = new Set(
      (await prisma.auditLog.findMany({ where: { action: 'DATA_UPDATE', schoolId: A.schoolId } })).map((r) => r.entityType),
    );
    for (const m of ['Student', 'Charge', 'Payment', 'Expense', 'Mark', 'Enrollment']) expect(types).toContain(m);
  });

  it('does not log writes that carry no actor, and AuditLog rows are append-only', async () => {
    const before = await prisma.auditLog.count();
    await prisma.guardian.create({ data: { schoolId: A.schoolId, fullName: 'Seed', phone: '+263774000000' } });
    expect(await prisma.auditLog.count()).toBe(before);
    const row = await prisma.auditLog.findFirstOrThrow();
    await expect(prisma.auditLog.update({ where: { id: row.id }, data: { detail: 'x' } })).rejects.toThrow(/cannot be changed/);
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/cannot be changed/);
  });
});
