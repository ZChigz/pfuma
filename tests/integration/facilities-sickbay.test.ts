// @vitest-environment node
// The sick bay against a real PostgreSQL: medical alerts are logged, a medicine that matches an allergy is refused unless someone says why,
// medicine from the sick bay store comes out of stock, a clinic referral needs where/how/who, the guardian is told, a learner kept to rest
// shows as In sick bay in the class register and the roll call (only that fact), the medication round is ticked once, and the database holds
// the rules too.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, userWithRoles, type SeededSchool } from '../helpers/seed';
import { actorOf } from '../helpers/academics';
import { addStudent } from '../helpers/students';
import { fails } from '../helpers/finance';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

type Actor = Awaited<ReturnType<typeof actorOf>>;
let t: TestDb;
let prisma: typeof import('@/lib/prisma').prisma;
let sb: typeof import('@/lib/facilities/sickbay');
let inv: typeof import('@/lib/facilities/inventory');
let hs: typeof import('@/lib/facilities/hostel');
let scoped: typeof import('@/lib/scoped-db');
let A: SeededSchool; let B: SeededSchool;
let op: Actor; let nurse: Actor; let teacher: Actor; let opB: Actor;
const kid: Record<string, string> = {};
const item: Record<string, string> = {};
const today = () => new Date(Date.now() + 2 * 3_600_000).toISOString().slice(0, 10);

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  [sb, inv, hs, scoped] = await Promise.all([import('@/lib/facilities/sickbay'), import('@/lib/facilities/inventory'), import('@/lib/facilities/hostel'), import('@/lib/scoped-db')]);
  A = await seedSchool(prisma, 'School A', { operator: true });
  B = await seedSchool(prisma, 'School B', { operator: true });
  const nurseU = await userWithRoles(prisma, A, ['NURSE'], 'nurse');
  const teacherU = await userWithRoles(prisma, A, ['TEACHER'], 'teacher');
  for (const [k, n, b] of [['sue', 'Sue', 'BOARDER'], ['tom', 'Tom', 'BOARDER'], ['day', 'Dayo', 'DAY']] as const) kid[k] = (await addStudent(prisma, A, { firstName: n, surname: 'Learner', gender: 'M', boarding: b })).id;
  kid.other = (await addStudent(prisma, B, { firstName: 'Other', surname: 'School', gender: 'M', boarding: 'BOARDER' })).id;
  [op, nurse, teacher, opB] = await Promise.all([actorOf(prisma, A.operator!.id), actorOf(prisma, nurseU.id), actorOf(prisma, teacherU.id), actorOf(prisma, B.operator!.id)]);
  // Sue is allergic to penicillin and takes a daily tablet kept by the matron.
  const profile = await prisma.medicalProfile.create({ data: { schoolId: A.schoolId, studentId: kid.sue!, allergies: [{ name: 'Penicillin', severity: 'SEVERE' }], hasSevereAllergy: true, conditions: [{ name: 'Asthma' }] } });
  await prisma.medicationEntry.create({ data: { schoolId: A.schoolId, profileId: profile.id, name: 'Inhaler', dose: '2 puffs', whenGiven: 'Morning 07:00', keptBy: 'MATRON' } });
  // Medicine in the sick bay store.
  const stores = (await inv.listStores(op)).stores;
  const store = stores.find((s) => s.name === 'Sick bay')!.id;
  item.paracetamol = (await inv.saveItem(op, { name: 'Paracetamol', category: 'MEDICAL', unit: 'EACH', reorderLevel: 5 })).id;
  await inv.receiveStock(op, { storeId: store, reason: 'Opening stock', lines: [{ itemId: item.paracetamol, qty: 20, unitCostCents: 5 }] });
}, 240_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

describe('alerts and medicine', () => {
  it('shows the allergies first, and logs that the alerts were opened', async () => {
    const a = await sb.medicalAlerts(nurse, kid.sue!);
    expect(a.severe).toBe(true);
    expect(a.allergies[0]).toMatchObject({ name: 'Penicillin', severity: 'SEVERE' });
    expect(a.medications[0]).toMatchObject({ name: 'Inhaler' });
    expect(await prisma.auditLog.count({ where: { schoolId: A.schoolId, action: 'MEDICAL_VIEWED', entityId: kid.sue } })).toBeGreaterThanOrEqual(1);
    await fails(sb.medicalAlerts(teacher, kid.sue!), 403);
    await fails(sb.medicalAlerts(nurse, kid.other!), 404);
  });

  it('refuses a medicine the learner is allergic to unless a reason is recorded', async () => {
    const visit = { studentId: kid.sue, complaint: 'FEVER', outcome: 'BACK_TO_CLASS', medication: [{ name: 'Penicillin V', dose: '250 mg' }] };
    await fails(sb.recordVisit(nurse, visit), 409, /allergic to Penicillin/);
    expect(await prisma.facSickBayVisit.count({ where: { studentId: kid.sue } })).toBe(0);
    const r = await sb.recordVisit(nurse, { ...visit, allergyOverrideReason: 'Doctor on the phone approved a supervised dose' });
    expect(r.allergyOverride).toBe(true);
  });

  it('takes medicine from the sick bay store out of stock', async () => {
    const before = (await sb.sickBayMedicine(nurse)).find((m) => m.itemId === item.paracetamol)!.qty;
    await sb.recordVisit(nurse, { studentId: kid.tom, complaint: 'HEADACHE', outcome: 'BACK_TO_CLASS', treatment: 'Rest', medication: [{ name: 'Paracetamol', dose: '500 mg', stockItemId: item.paracetamol, qty: 2 }] });
    expect((await sb.sickBayMedicine(nurse)).find((m) => m.itemId === item.paracetamol)!.qty).toBe(before - 2);
    await fails(sb.recordVisit(nurse, { studentId: kid.tom, complaint: 'HEADACHE', outcome: 'BACK_TO_CLASS', medication: [{ name: 'Paracetamol', stockItemId: item.paracetamol, qty: 500 }] }), 409, /Not enough/);
    await fails(sb.recordVisit(teacher, { studentId: kid.tom, complaint: 'HEADACHE', outcome: 'BACK_TO_CLASS' }), 403);
  });
});

describe('outcomes', () => {
  it('needs the clinic, the transport and who goes with the learner for a referral, and tells the guardian', async () => {
    await fails(sb.recordVisit(nurse, { studentId: kid.tom, complaint: 'INJURY', complaintNote: 'Sprain', outcome: 'SENT_TO_CLINIC' }), 422);
    await fails(sb.recordVisit(nurse, { studentId: kid.tom, complaint: 'INJURY', outcome: 'SENT_TO_CLINIC', referral: { facility: 'Mpilo', transport: '', accompaniedBy: 'Matron' } }), 422);
    const r = await sb.recordVisit(nurse, { studentId: kid.tom, complaint: 'INJURY', outcome: 'SENT_TO_CLINIC', referral: { facility: 'Mpilo Hospital', transport: 'School car', accompaniedBy: 'Matron' } });
    expect(r.smsQueued).toBe(1);
    const sms = await prisma.messageOutbox.findFirstOrThrow({ where: { schoolId: A.schoolId, studentId: kid.tom }, orderBy: { createdAt: 'desc' } });
    expect(sms.body).toContain('Mpilo Hospital');
    const row = await prisma.facSickBayVisit.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.guardianInformedMethod).toBe('SMS');
  });

  it('keeps a learner to rest: In sick bay in the class register and the roll call, nothing more, until discharged', async () => {
    await prisma.schoolModule.create({ data: { schoolId: A.schoolId, module: 'communication', enabled: false } });
    const r = await sb.recordVisit(nurse, { studentId: kid.sue, complaint: 'ASTHMA', outcome: 'REST_IN_SICK_BAY', observations: 'Wheezing' });
    expect(r.admitted).toBe(true);
    await fails(sb.recordVisit(nurse, { studentId: kid.sue, complaint: 'FEVER', outcome: 'BACK_TO_CLASS' }), 409, /already in the sick bay/);
    const attendance = await import('@/lib/academics/attendance');
    const locks = await scoped.getScopedDb(A.schoolId, op.id).$tx((tx) => attendance.lockedStudents(tx, A.schoolId, today(), [kid.sue!, kid.tom!]));
    expect(locks.get(kid.sue!)).toBe('SICK_BAY');
    expect(locks.get(kid.tom!)).toBeUndefined();
    // Nothing of the complaint is in what the register sees.
    expect(JSON.stringify([...locks])).not.toMatch(/Wheez|ASTHMA/);
    const away = await scoped.getScopedDb(A.schoolId, op.id).$tx((tx) => import('@/lib/facilities/away').then((m) => m.awayStatus(tx, A.schoolId, [kid.sue!], new Date(), today())));
    expect(away.get(kid.sue!)).toBe('SICK_BAY');
    const out = await sb.discharge(nurse, r.id, { note: 'Breathing well' });
    expect(out.dischargedAt).toBeTruthy();
    await fails(sb.discharge(nurse, r.id, {}), 409, /already discharged/);
    // Discharged, so from the next day the learner is no longer In sick bay (today still counts: they were there for part of it).
    const tomorrow = new Date(Date.now() + 2 * 3_600_000 + 86_400_000).toISOString().slice(0, 10);
    const after = await scoped.getScopedDb(A.schoolId, op.id).$tx((tx) => attendance.lockedStudents(tx, A.schoolId, tomorrow, [kid.sue!]));
    expect(after.get(kid.sue!)).toBeUndefined();
  });

  it('needs the guardian told before a learner is sent home, by SMS or by saying how', async () => {
    // Communication is off in this school now, so no SMS can go.
    await fails(sb.recordVisit(nurse, { studentId: kid.tom, complaint: 'FEVER', temperatureC: 39.1, outcome: 'SENT_HOME' }), 422, /how the guardian was told/);
    const ok = await sb.recordVisit(nurse, { studentId: kid.tom, complaint: 'FEVER', temperatureC: 39.1, outcome: 'SENT_HOME', guardianTold: 'Phoned the mother' });
    expect(ok.smsQueued).toBe(0);
    expect((await prisma.facSickBayVisit.findUniqueOrThrow({ where: { id: ok.id } })).guardianInformedMethod).toBe('Phoned the mother');
  });

  it('is held by the database too: no rest without admission, no rewriting a visit, one admission at a time', async () => {
    await expect(t.pg.query(`INSERT INTO "FacSickBayVisit" ("id","schoolId","studentId","visitedAt","complaint","outcome","recordedById","updatedAt") VALUES ('x1','${A.schoolId}','${kid.tom}',now(),'FEVER','REST_IN_SICK_BAY','${nurse.id}',now())`)).rejects.toThrow(/admission time/);
    await expect(t.pg.query(`INSERT INTO "FacSickBayVisit" ("id","schoolId","studentId","visitedAt","complaint","outcome","recordedById","updatedAt") VALUES ('x2','${A.schoolId}','${kid.tom}',now(),'FEVER','SENT_TO_CLINIC','${nurse.id}',now())`)).rejects.toThrow(/clinic/);
    const any = await prisma.facSickBayVisit.findFirstOrThrow({ where: { studentId: kid.tom, outcome: 'SENT_HOME' } });
    await expect(t.pg.query(`UPDATE "FacSickBayVisit" SET "outcome" = 'BACK_TO_CLASS' WHERE "id" = '${any.id}'`)).rejects.toThrow(/not rewritten/);
    await expect(t.pg.query(`DELETE FROM "FacSickBayVisit" WHERE "id" = '${any.id}'`)).rejects.toThrow();
  });
});

describe('the medication round', () => {
  it('lists the medicine the matron keeps, ticks each dose once, and flags the rest as missed when closed', async () => {
    const round = await sb.medicationRound(nurse);
    const dose = round.rows.find((r) => r.medicine === 'Inhaler')!;
    expect(dose).toMatchObject({ dueTime: '07:00', student: 'Sue Learner' });
    await fails(sb.giveDose(teacher, dose.id, {}), 403);
    await sb.giveDose(nurse, dose.id, {});
    await fails(sb.giveDose(nurse, dose.id, {}), 409, /already given/);
    // A second dose that nobody ticks.
    const profile = await prisma.medicalProfile.findUniqueOrThrow({ where: { studentId: kid.sue! } });
    await prisma.medicationEntry.create({ data: { schoolId: A.schoolId, profileId: profile.id, name: 'Vitamin', whenGiven: 'Night', keptBy: 'OFFICE' } });
    const again = await sb.medicationRound(nurse);
    expect(again.rows).toHaveLength(2);
    expect((await sb.closeRound(nurse, {})).missed).toBe(1);
    expect((await sb.medicationRound(nurse)).rows.find((r) => r.medicine === 'Vitamin')!.missed).toBe(true);
    expect((await sb.closeRound(nurse, {})).missed).toBe(0);
  });
});

describe('another school and the old Medical tab', () => {
  it('cannot see or change this school\'s visits', async () => {
    expect(await sb.listVisits(opB)).toEqual([]);
    const v = await prisma.facSickBayVisit.findFirstOrThrow({ where: { schoolId: A.schoolId } });
    await fails(sb.discharge(opB, v.id, {}), 404);
    await fails(sb.recordVisit(opB, { studentId: kid.sue, complaint: 'FEVER', outcome: 'BACK_TO_CLASS' }), 404);
  });

  it('shows the visits on the Medical tab once the sick bay holds them, and the old route stops taking new ones', async () => {
    const medical = await import('@/lib/students/medical');
    const actor = op as unknown as Parameters<typeof medical.viewMedical>[0];
    const view = await medical.viewMedical(actor, kid.tom!);
    expect(view.sickBay.visits.length).toBeGreaterThanOrEqual(3);
    expect(view.sickBay.visits.some((x) => x.outcome === 'SENT_HOME')).toBe(true);
    await fails(medical.recordSickBayVisit(actor, kid.tom!, { visitedAt: '2026-10-01 10:00', complaint: 'Cough', outcome: 'RETURNED_TO_CLASS', guardianInformed: false }), 409, /now recorded in Facilities/);
  });
});
