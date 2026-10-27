// @vitest-environment node
// The access engine without a database: effective permissions, the ten separation-of-duties rules, the serializers, and the page guard.
import { describe, expect, it } from 'vitest';
import { can, PERMISSION_KEYS, type AccessUser } from '@/lib/access-core';
import { effectivePermissions, grantsFor, heldKeys, permissionSummary, SINGLE_PERSON_FINANCE_KEYS } from '@/lib/access/effective';
import { AccessError } from '@/lib/access/errors';
import * as guards from '@/lib/access/guards';
import { mayOpen, requiredKeysFor, routeRules } from '@/lib/access/routes';
import { serializeAuditEntry, serializeEmployee, serializeGuardian, serializeMarkSheet, serializePayslip, serializeStudent, maskTail } from '@/lib/access/serializers';
import { effectiveOf } from '@/lib/access/user';
import type { GrantRow, OverrideRow, Scope } from '@/lib/access/types';

const row = (key: string, scope: Scope = 'SCHOOL', pinType: GrantRow['pinType'] = null, pinId = ''): GrantRow => ({ key, scope, pinType, pinId });
const day = 86_400_000;
const NOW = new Date('2026-10-26T08:00:00Z');
const override = (o: Partial<OverrideRow> & Pick<OverrideRow, 'key' | 'effect'>): OverrideRow =>
  ({ scope: 'SCHOOL', scopeId: '', expiresAt: new Date(NOW.getTime() + 30 * day), revokedAt: null, ...o });

/** A user object the way loadContext makes one. */
function userWith(rows: GrantRow[], extra: Partial<AccessUser> & { overrides?: OverrideRow[]; roleKeys?: string[]; singlePersonFinance?: boolean } = {}): AccessUser {
  const effective = effectivePermissions({ roleGrants: rows, overrides: extra.overrides, roleKeys: extra.roleKeys, singlePersonFinance: extra.singlePersonFinance, now: NOW });
  return { id: 'u1', schoolId: 's1', role: 'TEACHER', effective, grants: heldKeys(effective), denied: Array.from(effective.denied), ...extra };
}

describe('effective permissions', () => {
  it('are the union of every role\'s grants, each at its own scope', () => {
    const eff = effectivePermissions({ roleGrants: [row('exams.marks.enter', 'ASSIGNED'), row('exams.marks.enter', 'CLASS'), row('exams.marks.verify', 'DEPARTMENT'), row('system.dashboard.view')], now: NOW });
    expect(grantsFor(eff, 'exams.marks.enter')).toEqual([{ scope: 'ASSIGNED' }, { scope: 'CLASS' }]);
    expect(grantsFor(eff, 'exams.marks.verify')).toEqual([{ scope: 'DEPARTMENT' }]);
    expect(grantsFor(eff, 'finance.payments.record')).toEqual([]);
  });

  it('narrow a role pinned to one department, class, hostel or store to that place, and leave its other grants alone', () => {
    const eff = effectivePermissions({
      roleGrants: [row('exams.marks.verify', 'DEPARTMENT', 'DEPARTMENT', 'sciences'), row('system.dashboard.view', 'SCHOOL', 'DEPARTMENT', 'sciences'), row('academics.attendance.mark', 'CLASS', 'CLASS', 'f2east')],
      now: NOW,
    });
    expect(grantsFor(eff, 'exams.marks.verify')).toEqual([{ scope: 'DEPARTMENT', scopeId: 'sciences' }]);
    expect(grantsFor(eff, 'system.dashboard.view')).toEqual([{ scope: 'SCHOOL' }]);
    expect(grantsFor(eff, 'academics.attendance.mark')).toEqual([{ scope: 'CLASS', scopeId: 'f2east' }]);
  });

  it('add a GRANT exception until it expires, and ignore it once expired or revoked', () => {
    const grant = override({ key: 'finance.reports.view', effect: 'GRANT' });
    expect(grantsFor(effectivePermissions({ roleGrants: [], overrides: [grant], now: NOW }), 'finance.reports.view')).toEqual([{ scope: 'SCHOOL' }]);
    const later = new Date(NOW.getTime() + 31 * day);
    expect(grantsFor(effectivePermissions({ roleGrants: [], overrides: [grant], now: later }), 'finance.reports.view')).toEqual([]);
    expect(grantsFor(effectivePermissions({ roleGrants: [], overrides: [{ ...grant, revokedAt: NOW }], now: NOW }), 'finance.reports.view')).toEqual([]);
  });

  it('let a DENY beat a grant, whatever the order', () => {
    const rows = [row('finance.payments.void'), row('finance.payments.record')];
    const deny = override({ key: 'finance.payments.void', effect: 'DENY' });
    const grant = override({ key: 'finance.payments.void', effect: 'GRANT' });
    for (const overrides of [[deny], [deny, grant], [grant, deny]]) {
      const eff = effectivePermissions({ roleGrants: rows, overrides, now: NOW });
      expect(grantsFor(eff, 'finance.payments.void')).toEqual([]);
      expect(grantsFor(eff, 'finance.payments.record')).toEqual([{ scope: 'SCHOOL' }]); // a deny takes away that one key and leaves the others
      expect(can(userWith(rows, { overrides }), 'finance.payments.void')).toBe(false);
      expect(can(userWith(rows, { overrides }), 'finance.payments.record')).toBe(true);
    }
  });

  it('let a DENY at one scope remove the grants at that scope only', () => {
    const rows = [row('students.profiles.view', 'ASSIGNED'), row('students.profiles.view', 'CLASS')];
    const eff = effectivePermissions({ roleGrants: rows, overrides: [override({ key: 'students.profiles.view', effect: 'DENY', scope: 'ASSIGNED' })], now: NOW });
    expect(grantsFor(eff, 'students.profiles.view')).toEqual([{ scope: 'CLASS' }]);
    const pinned = effectivePermissions({
      roleGrants: [row('students.profiles.view', 'CLASS', 'CLASS', 'c1'), row('students.profiles.view', 'CLASS', 'CLASS', 'c2')],
      overrides: [override({ key: 'students.profiles.view', effect: 'DENY', scope: 'CLASS', scopeId: 'c1' })], now: NOW,
    });
    expect(grantsFor(pinned, 'students.profiles.view')).toEqual([{ scope: 'CLASS', scopeId: 'c2' }]);
    expect(pinned.scopedDenies.get('students.profiles.view')).toEqual([{ scope: 'CLASS', scopeId: 'c1' }]);
  });

  it('give the Owner of a single-finance-person school the second person\'s keys, and nobody else', () => {
    const owner = effectivePermissions({ roleGrants: [], roleKeys: ['OWNER'], singlePersonFinance: true, now: NOW });
    for (const k of SINGLE_PERSON_FINANCE_KEYS) expect(grantsFor(owner, k)).toEqual([{ scope: 'SCHOOL' }]);
    expect(grantsFor(effectivePermissions({ roleGrants: [], roleKeys: ['OWNER'], singlePersonFinance: false, now: NOW }), 'finance.payments.verify')).toEqual([]);
    expect(grantsFor(effectivePermissions({ roleGrants: [], roleKeys: ['BURSAR'], singlePersonFinance: true, now: NOW }), 'finance.payments.verify')).toEqual([]);
  });

  it('read a bare list of keys the way it has always been read: each held school-wide', () => {
    const bare: AccessUser = { id: 'u', schoolId: 's', role: 'TEACHER', grants: ['exams.marks.enter'] };
    expect(grantsFor(effectiveOf(bare), 'exams.marks.enter')).toEqual([{ scope: 'SCHOOL' }]);
    expect(grantsFor(effectiveOf({ ...bare, denied: ['exams.marks.enter'] }), 'exams.marks.enter')).toEqual([]);
  });

  it('are summarised for the browser as key → scopes', () => {
    const eff = effectivePermissions({ roleGrants: [row('exams.marks.enter', 'ASSIGNED'), row('system.dashboard.view')], now: NOW });
    expect(permissionSummary(eff, PERMISSION_KEYS)).toEqual({ 'exams.marks.enter': ['ASSIGNED'], 'system.dashboard.view': ['SCHOOL'] });
  });
});

describe('the ten separation-of-duties rules', () => {
  // Each rule applies to the Owner and the Administrator exactly as to everyone else: they are identity checks.
  const people = { clerk: { id: 'clerk' }, owner: { id: 'owner', roles: ['OWNER'] }, admin: { id: 'admin', roles: ['ADMINISTRATOR'] }, bursar: { id: 'bursar' }, head: { id: 'head' } };
  const blocked = (fn: () => void, rule: number, message: RegExp) => {
    try { fn(); } catch (e) {
      expect(e).toBeInstanceOf(AccessError);
      expect((e as AccessError).status).toBe(403);
      expect((e as AccessError).code).toBe('SEPARATION_OF_DUTIES');
      expect((e as AccessError).rule).toBe(rule);
      expect((e as AccessError).message).toMatch(message);
      return;
    }
    throw new Error(`rule ${rule} did not block`);
  };

  for (const [name, who] of [['the clerk', people.clerk], ['the Owner', people.owner], ['the Administrator', people.admin]] as const) {
    describe(`as ${name}`, () => {
      it('1: cannot verify a payment they recorded', () => {
        blocked(() => guards.recorderCannotVerify(who, { recordedById: who.id }), 1, /You recorded this payment, so another finance user must verify it\./);
        expect(() => guards.recorderCannotVerify(who, { recordedById: 'someone-else' })).not.toThrow();
      });
      it('2: cannot void a payment, charge or expense they recorded', () => {
        for (const what of ['payment', 'charge', 'expense'] as const) blocked(() => guards.recorderCannotVoid(who, { recordedById: who.id }, what), 2, new RegExp(`You recorded this ${what}`));
        expect(() => guards.recorderCannotVoid(who, { recordedById: 'x' })).not.toThrow();
      });
      it('3: cannot approve or disburse their own purchase request; the approver cannot disburse it', () => {
        blocked(() => guards.requesterCannotApprove(who, { requestedById: who.id }), 3, /You raised this request.*approve/);
        blocked(() => guards.requesterCannotApprove(who, { requestedById: who.id }, 'reject'), 3, /reject/);
        blocked(() => guards.requesterAndApproverCannotDisburse(who, { requestedById: who.id, approvedById: 'h' }), 3, /raised this request.*disburse/);
        blocked(() => guards.requesterAndApproverCannotDisburse(who, { requestedById: 'r', approvedById: who.id }), 3, /approved this request.*disburse/);
        expect(() => guards.requesterAndApproverCannotDisburse(who, { requestedById: 'r', approvedById: 'h' })).not.toThrow();
      });
      it('4: cannot approve a discount, award, payment plan or refund they created', () => {
        for (const what of ['discount', 'award', 'payment plan', 'refund'] as const) blocked(() => guards.creatorCannotApprove(who, { createdById: who.id }, what), 4, new RegExp(`You created this ${what}`));
        expect(() => guards.creatorCannotApprove(who, { createdById: 'x' }, 'refund')).not.toThrow();
      });
      it('5: cannot approve or pay a payroll run they prepared', () => {
        blocked(() => guards.preparerCannotApproveOrPay(who, { preparedById: who.id }, 'approve'), 5, /prepared this payroll run.*approve/);
        blocked(() => guards.preparerCannotApproveOrPay(who, { preparedById: who.id }, 'mark it paid'), 5, /mark it paid/);
        expect(() => guards.preparerCannotApproveOrPay(who, { preparedById: 'hr' }, 'approve')).not.toThrow();
      });
      it('6: cannot verify the mark sheet of an assignment they teach or co-teach', () => {
        blocked(() => guards.teacherCannotVerifyOwnSheet(who, { teacherId: who.id }), 6, /another head of department, or to the Deputy Head/);
        blocked(() => guards.teacherCannotVerifyOwnSheet(who, { teacherId: 't', coTeacherId: who.id }), 6, /You teach this class/);
        expect(() => guards.teacherCannotVerifyOwnSheet(who, { teacherId: 't', coTeacherId: null })).not.toThrow();
      });
      it('7: cannot approve their own leave, exeat request, duty swap or expense claim', () => {
        for (const what of ['leave', 'exeat request', 'duty swap', 'expense claim'] as const) blocked(() => guards.cannotApproveOwn(who, who.id, what), 7, new RegExp(`your own ${what}`));
        expect(() => guards.cannotApproveOwn(who, 'x', 'leave')).not.toThrow();
      });
      it('8: cannot change their own roles, grants or exceptions', () => {
        blocked(() => guards.cannotChangeOwnAccess(who, who.id), 8, /cannot change your own roles or permissions/);
        expect(() => guards.cannotChangeOwnAccess(who, 'other')).not.toThrow();
      });
      it('10: cannot confirm or sign off a cash-up they counted', () => {
        blocked(() => guards.clerkCannotConfirmOwnCashUp(who, { userId: who.id }), 10, /Bursar must confirm/);
        blocked(() => guards.signOffNeedsThirdPerson(who, { userId: who.id, confirmedById: 'b' }), 10, /Head must sign it off/);
        blocked(() => guards.signOffNeedsThirdPerson(who, { userId: 'c', confirmedById: who.id }), 10, /You confirmed this cash-up/);
        expect(() => guards.signOffNeedsThirdPerson(who, { userId: 'c', confirmedById: 'b' })).not.toThrow();
      });
    });
  }

  it('9: a change to bank details needs two people, HR and the Owner', () => {
    const hr = { id: 'hr', roles: ['HR_OFFICER'] }, hr2 = { id: 'hr2', grants: ['hr.pay.manage'] }, owner = people.owner;
    expect(() => guards.bankChangeNeedsHrAndOwner(hr, owner)).not.toThrow();
    expect(() => guards.bankChangeNeedsHrAndOwner(owner, hr2)).not.toThrow();
    blocked(() => guards.bankChangeNeedsHrAndOwner(hr, hr), 9, /cannot do both/);
    blocked(() => guards.bankChangeNeedsHrAndOwner(owner, owner), 9, /cannot do both/);
    blocked(() => guards.bankChangeNeedsHrAndOwner(hr, hr2), 9, /HR and the Owner/);
    blocked(() => guards.bankChangeNeedsHrAndOwner(hr, people.admin), 9, /HR and the Owner/);
    blocked(() => guards.bankChangeNeedsHrAndOwner(people.bursar, owner), 9, /HR and the Owner/);
  });

  it('10: the cash-up is counted by the clerk, confirmed by someone else, signed off by a third', () => {
    expect(() => guards.clerkCannotConfirmOwnCashUp(people.bursar, { userId: 'clerk' })).not.toThrow();
    expect(() => guards.signOffNeedsThirdPerson(people.head, { userId: 'clerk', confirmedById: 'bursar' })).not.toThrow();
  });

  it('lists all ten rules', () => {
    expect(guards.RULES.map((r) => r.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe('serializers', () => {
  const holder = (...keys: string[]): AccessUser => ({ id: 'me', schoolId: 's1', role: 'TEACHER', grants: keys });
  const student = {
    id: 'st1', admissionNumber: 'A1', firstName: 'Tino', surname: 'Moyo', fullName: 'Tino Moyo', currentClassId: 'c1', gender: 'M', photoUrl: 'p.png',
    portalToken: 'secret', portalTokenHash: 'h', portalPinHash: 'p', medicalNotes: 'Asthma', specialNeedsNote: 'Dyslexia', medical: { hasSevereAllergy: true, allergies: ['nuts'] },
    incidents: [{ id: 'i1' }], disciplineActions: [{ id: 'd1' }], finPayments: [{ amountCents: 500 }], balanceCents: 1200,
    guardians: [{ guardian: { id: 'g1', fullName: 'Mrs Moyo', phone: '+263771', nationalId: '63-123456 K 42' }, isPrimary: true }],
  };
  const raw = JSON.stringify;

  it('never send the portal link or PIN, to anyone', () => {
    const everything = holder(...PERMISSION_KEYS);
    for (const u of [holder(), everything]) expect(raw(serializeStudent(u, student))).not.toMatch(/secret|portalToken|portalPinHash/);
  });

  it('give a learner\'s medical details only to students.medical.view, and everyone else the alert line', () => {
    const matron = serializeStudent(holder('students.medical.view'), student);
    expect(matron.medicalNotes).toBe('Asthma');
    expect(matron.medical).toMatchObject({ allergies: ['nuts'] });
    for (const u of [holder('students.profiles.view'), holder('students.discipline.view'), holder('students.guardians.view')]) {
      const s = serializeStudent(u, student);
      expect(s).not.toHaveProperty('medicalNotes');
      expect(s).not.toHaveProperty('medical');
      expect(s).not.toHaveProperty('specialNeedsNote');
      expect(s.medicalAlert).toBe('Medical alert: severe allergy');
    }
  });

  it('show discipline history only with students.discipline.view', () => {
    expect(serializeStudent(holder('students.discipline.view'), student)).toHaveProperty('incidents');
    expect(serializeStudent(holder('students.discipline.create'), student)).not.toHaveProperty('incidents');
    expect(serializeStudent(holder('students.discipline.create'), student)).not.toHaveProperty('disciplineActions');
  });

  it('show fee amounts only with finance.statements.view; a class teacher gets "fees outstanding" and nothing more', () => {
    const bursar = serializeStudent(holder('finance.statements.view', 'students.guardians.view'), student);
    expect(bursar.balanceCents).toBe(1200);
    const classTeacher = serializeStudent(holder('finance.arrears.flag', 'students.guardians.view'), student);
    expect(classTeacher.feesOutstanding).toBe(true);
    expect(raw(classTeacher)).not.toMatch(/1200|500|balanceCents|finPayments/);
    expect(serializeStudent(holder('students.guardians.view'), student)).not.toHaveProperty('feesOutstanding');
  });

  it('cut a profile to name, class, photo and guardian contact for a teacher, and to a lookup for a bursar', () => {
    const teacher = serializeStudent(holder('students.profiles.view', 'students.discipline.create'), student);
    expect(Object.keys(teacher).sort()).toEqual(['admissionNumber', 'currentClassId', 'firstName', 'fullName', 'gender', 'guardians', 'id', 'medicalAlert', 'photoUrl', 'surname'].sort());
    expect(teacher.guardians).toEqual([{ id: 'g1', fullName: 'Mrs Moyo', phone: '+263771', altPhone: null, relationship: null, isPrimary: false }]);
    expect(raw(teacher)).not.toContain('63-123456');
    const bursar = serializeStudent(holder('students.profiles.view'), student);
    expect(bursar).not.toHaveProperty('guardians');
    expect(bursar.fullName).toBe('Tino Moyo');
  });

  it('show a guardian\'s ID number in full only with students.guardians.view_ids, else its last 3 characters', () => {
    const g = { id: 'g1', nationalId: '63-123456 K 42' };
    expect(serializeGuardian(holder('students.guardians.view_ids'), g).nationalId).toBe('63-123456 K 42');
    expect(serializeGuardian(holder('students.guardians.view'), g).nationalId).toBe(maskTail(g.nationalId, 3));
    expect(String(serializeGuardian(holder('students.guardians.view'), g).nationalId).endsWith(' 42')).toBe(true);
    expect(raw(serializeGuardian(holder('students.guardians.view'), g))).not.toContain('123456');
    const full = serializeStudent(holder('students.guardians.view'), student);
    expect(raw(full)).not.toContain('123456');
    expect(raw(serializeStudent(holder('students.guardians.view', 'students.guardians.view_ids'), student))).toContain('63-123456 K 42');
  });

  const employee = {
    id: 'e1', userId: 'colleague', employeeNo: 'E1', title: 'Mr', firstName: 'Farai', surname: 'Dube', jobTitle: 'Groundsman', departmentId: 'd1', workPhone: '+263242',
    nationalId: '63-111111 X 63', homeAddress: '1 Main St', nextOfKin: [{ name: 'Mai' }], dateOfBirth: '1980-01-01',
    medicalNotes: 'Diabetic', zimraTaxNo: 'TX12345678', nssaNo: 'NS87654321', bankAccountNo: '0012345678', pay: { basicCents: 90000, bankName: 'CBZ', zimraTaxNo: 'TX12345678', nssaNo: 'NS87654321' },
    discipline: [{ id: 'dc1' }], tabletPinHash: 'x',
  };

  it('show a staff record by key: the directory to everyone, IDs and address to hr.employees.view, pay to hr.pay.view, discipline to hr.discipline.view', () => {
    const dir = serializeEmployee(holder('hr.directory.view'), employee);
    expect(Object.keys(dir).sort()).toEqual(['departmentId', 'employeeNo', 'firstName', 'id', 'jobTitle', 'surname', 'title', 'workPhone']);
    const hrView = serializeEmployee(holder('hr.directory.view', 'hr.employees.view'), employee);
    expect(hrView.nationalId).toBe('63-111111 X 63');
    expect(hrView.homeAddress).toBe('1 Main St');
    expect(raw(hrView)).not.toMatch(/Diabetic|CBZ|TX12345678|0012345678|dc1/);
    const pay = serializeEmployee(holder('hr.directory.view', 'hr.employees.view', 'hr.pay.view'), employee);
    expect(raw(pay)).toMatch(/Diabetic/);
    expect(pay.bankAccountNo).toBe('0012345678');
    expect(raw(pay)).not.toMatch(/tabletPinHash|dc1/);
    expect(serializeEmployee(holder('hr.directory.view', 'hr.discipline.view'), employee).discipline).toEqual([{ id: 'dc1' }]);
    expect(serializeEmployee(holder(), employee)).toEqual({});
  });

  it('show an employee their own record with tax and NSSA numbers cut to the last 4 and no bank account number', () => {
    const me: AccessUser = { id: 'colleague', schoolId: 's1', role: 'TEACHER', grants: ['hr.self.details', 'hr.directory.view'] };
    const own = serializeEmployee(me, employee);
    expect(own.nationalId).toBe('63-111111 X 63');
    expect(own.zimraTaxNo).toMatch(/^•+5678$/);
    expect(own.nssaNo).toMatch(/^•+4321$/);
    expect((own.pay as Record<string, unknown>).zimraTaxNo).toMatch(/^•+5678$/);
    expect(raw(own)).not.toMatch(/TX12345678|NS87654321|0012345678/);
    expect(own.pay).toMatchObject({ basicCents: 90000 });
  });

  it('give a payslip to its owner (tax and NSSA last 4) or to hr.pay.view, and to nobody else', () => {
    const slip = { id: 'p1', netCents: 80000, zimraTaxNo: 'TX12345678', nssaNo: 'NS87654321' };
    const own = serializePayslip(holder(), slip, 'me');
    expect(own).toMatchObject({ netCents: 80000 });
    expect(own!.zimraTaxNo).toMatch(/^•+5678$/);
    expect(serializePayslip(holder('hr.pay.view'), slip, 'colleague')).not.toBeNull();
    expect(serializePayslip(holder('hr.payroll.view'), slip, 'colleague')).toBeNull();
    expect(serializePayslip(holder(), slip, null)).toBeNull();
  });

  it('hide marks before publishing from everyone but the teachers of the sheet and those who hold exams.results.view', () => {
    const sheet = { id: 'sh1', subject: 'Maths', marks: [{ s: 1, m: 50 }], average: 50 };
    expect(serializeMarkSheet(holder(), sheet, { published: true, teacherIds: ['t'] })).toHaveProperty('marks');
    expect(serializeMarkSheet(holder(), sheet, { published: false, teacherIds: ['t'] })).not.toHaveProperty('marks');
    expect(serializeMarkSheet(holder(), sheet, { published: false, teacherIds: ['t'] })).not.toHaveProperty('average');
    expect(serializeMarkSheet(holder(), sheet, { published: false, teacherIds: ['me'] })).toHaveProperty('marks');
    expect(serializeMarkSheet(holder('exams.results.view'), sheet, { published: false, teacherIds: ['t'] })).toHaveProperty('marks');
    expect(serializeMarkSheet(holder('exams.results.view'), sheet, { published: false, teacherIds: ['t'], reachedByResultsView: false })).not.toHaveProperty('marks');
  });

  it('show finance entries of the audit log only to system.audit.view together with finance.reports.view', () => {
    const fin = { id: 'a1', entityType: 'FinPayment', module: 'finance' }, other = { id: 'a2', entityType: 'User', module: 'system' };
    expect(serializeAuditEntry(holder('system.audit.view'), fin)).toBeNull();
    expect(serializeAuditEntry(holder('system.audit.view'), other)).not.toBeNull();
    expect(serializeAuditEntry(holder('system.audit.view', 'finance.reports.view'), fin)).not.toBeNull();
    expect(serializeAuditEntry(holder('finance.reports.view'), fin)).toBeNull();
    expect(serializeAuditEntry(holder('system.audit.view'), { id: 'a3', entityType: 'CashUp' })).toBeNull();
  });
});

describe('the page guard', () => {
  const user = (...keys: string[]): AccessUser => ({ id: 'me', schoolId: 's1', role: 'TEACHER', grants: keys });

  it('is the sidebar: each page needs the key (or one of the keys) of its menu item', () => {
    expect(requiredKeysFor('/system/users')).toEqual(['system.users.view']);
    expect(requiredKeysFor('/academics/attendance')).toEqual(['academics.attendance.mark', 'academics.attendance.view']);
    expect(routeRules().length).toBeGreaterThan(30);
  });

  it('asks the same of a page under a menu item, taking the longest match', () => {
    expect(requiredKeysFor('/students/abc123')).toEqual(['students.profiles.view']);
    expect(requiredKeysFor('/students/admissions/xyz')).toEqual(['students.admissions.view']);
    expect(requiredKeysFor('/system/users/')).toEqual(['system.users.view']);
    expect(requiredKeysFor('/students?tab=1')).toEqual(['students.profiles.view']);
  });

  it('leaves pages the menu does not know to their own check', () => {
    for (const p of ['/', '/head', '/bursar/expenses', '/change-password', '/system/profile']) expect(requiredKeysFor(p), p).toBeNull();
    expect(mayOpen(user(), '/head')).toBe(true);
  });

  it('refuses a page whose key is not held, opens it when it is, and respects a switched-off module and a deny', () => {
    expect(mayOpen(user(), '/system/users')).toBe(false);
    expect(mayOpen(user('system.users.view'), '/system/users')).toBe(true);
    expect(mayOpen({ ...user('system.users.view'), disabledModules: ['system'] }, '/system/users')).toBe(true); // System cannot be switched off
    expect(mayOpen({ ...user('students.profiles.view'), disabledModules: ['students'] }, '/students/abc')).toBe(false);
    expect(mayOpen({ ...user('students.profiles.view'), denied: ['students.profiles.view'] }, '/students/abc')).toBe(false);
    expect(mayOpen(user('academics.attendance.view'), '/academics/attendance')).toBe(true);
  });
});
