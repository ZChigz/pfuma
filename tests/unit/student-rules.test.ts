import { describe, expect, it } from 'vitest';
import { PERMISSION_KEYS } from '@/lib/access-core';
import type { AccessUser } from '@/lib/access-core';
import { PERMISSIONS } from '@/lib/access-core';
import {
  buildAlerts, canRejoin, canStartLeaving, canSuspend, classListSections, exportColumnsFor, formatBirthCert, isAtSchool,
  isValidBirthCert, normaliseBirthCert, registerStudentTab, sortBySurname, statusForExit, studentAccess, suspensionHasEnded,
  visibleStudentTabs, EXPORT_COLUMNS,
} from '@/lib/students/rules';

const user = (grants: string[], extra: Partial<AccessUser> = {}): AccessUser => ({ id: 'u1', schoolId: 's1', role: 'TEACHER', grants, ...extra });
const ADMIN = user([...PERMISSION_KEYS]);
const NOBODY = user([]);

describe('permission keys', () => {
  const KEYS = [
    'students.profiles.view', 'students.profiles.create', 'students.profiles.edit', 'students.profiles.export', 'students.profiles.import',
    'students.guardians.view', 'students.guardians.edit', 'students.guardians.view_ids',
    'students.admissions.view', 'students.admissions.manage', 'students.admissions.approve',
    'students.enrolment.view', 'students.enrolment.manage', 'students.enrolment.approve',
    'students.promotion.manage', 'students.promotion.approve',
    'students.documents.view', 'students.documents.upload', 'students.documents.generate',
    'students.discipline.view', 'students.discipline.create', 'students.discipline.approve',
    'students.medical.view', 'students.medical.edit', 'students.medical.export',
    'students.leavers.manage', 'students.leavers.approve', 'students.alumni.view', 'students.alumni.export',
  ];

  it('exist in the catalogue, and the owner and administrator (*) hold every one', () => {
    for (const k of KEYS) {
      expect(k in PERMISSIONS, k).toBe(true);
      expect(ADMIN.grants).toContain('students.profiles.view');
    }
    const a = studentAccess(ADMIN);
    expect(Object.values(a).every(Boolean)).toBe(true);
  });

  it('give a user with no grants nothing at all', () => {
    expect(Object.values(studentAccess(NOBODY)).some(Boolean)).toBe(false);
  });

  it('every key fits the shape the Permission table allows (three lowercase segments)', () => {
    for (const k of KEYS) expect(k).toMatch(/^[a-z]+\.[a-z_]+\.[a-z_]+$/);
  });

  it('keep medical access separate from profile access', () => {
    const a = studentAccess(user(['students.profiles.view']));
    expect(a.profile).toBe(true);
    expect(a.medical).toBe(false);
    expect(a.discipline).toBe(false);
    expect(a.idNumbers).toBe(false);
  });

  it('make a suspended school or a support session read-only: looking is allowed, changing is not', () => {
    const a = studentAccess(user([...PERMISSION_KEYS], { readOnly: true }));
    expect(a.profile).toBe(true);
    expect(a.edit).toBe(false);
    expect(a.create).toBe(false);
    expect(a.approveLeaving).toBe(false);
  });

  it('switch off with the module', () => {
    expect(studentAccess(user([...PERMISSION_KEYS], { disabledModules: ['students'] })).profile).toBe(false);
  });
});

describe('status path', () => {
  it('only an active student can be suspended', () => {
    expect(canSuspend('ACTIVE')).toBe(true);
    for (const s of ['SUSPENDED', 'TRANSFERRED', 'GRADUATED', 'WITHDRAWN', 'EXPELLED', 'DECEASED'] as const) expect(canSuspend(s), s).toBe(false);
  });

  it('only students at the school can start leaving', () => {
    expect(canStartLeaving('ACTIVE')).toBe(true);
    expect(canStartLeaving('SUSPENDED')).toBe(true);
    expect(canStartLeaving('TRANSFERRED')).toBe(false);
    expect(isAtSchool('GRADUATED')).toBe(false);
  });

  it('transferred, withdrawn and graduated students can rejoin; expelled and deceased cannot', () => {
    expect(canRejoin('TRANSFERRED')).toBe(true);
    expect(canRejoin('WITHDRAWN')).toBe(true);
    expect(canRejoin('GRADUATED')).toBe(true);
    expect(canRejoin('EXPELLED')).toBe(false);
    expect(canRejoin('DECEASED')).toBe(false);
    expect(canRejoin('ACTIVE')).toBe(false);
  });

  it('maps each reason for leaving to one status; completing O Level or A Level are both Graduated', () => {
    expect(statusForExit('TRANSFER')).toBe('TRANSFERRED');
    expect(statusForExit('COMPLETED_O_LEVEL')).toBe('GRADUATED');
    expect(statusForExit('COMPLETED_A_LEVEL')).toBe('GRADUATED');
    expect(statusForExit('WITHDRAWN_BY_GUARDIAN')).toBe('WITHDRAWN');
    expect(statusForExit('RELOCATED_ABROAD')).toBe('WITHDRAWN');
    expect(statusForExit('OTHER')).toBe('WITHDRAWN');
    expect(statusForExit('EXPELLED')).toBe('EXPELLED');
    expect(statusForExit('DECEASED')).toBe('DECEASED');
  });

  it('ends a suspension the day after its end date', () => {
    expect(suspensionHasEnded('2026-03-05', '2026-03-05')).toBe(false);
    expect(suspensionHasEnded('2026-03-05', '2026-03-06')).toBe(true);
    expect(suspensionHasEnded('2026-03-05', '2026-03-01')).toBe(false);
  });
});

describe('birth certificate numbers', () => {
  it('are normalised: capitals, no spaces, dashes or slashes', () => {
    expect(normaliseBirthCert('63-123456 a 42')).toBe('63123456A42');
    expect(normaliseBirthCert(' 63 123456-A/42 ')).toBe('63123456A42');
  });

  it('accept the Zimbabwe format in any spacing and reject anything else', () => {
    for (const ok of ['63-123456 A 42', '63123456A42', '08-1234567-Z-05', '75 12345 b 99']) expect(isValidBirthCert(ok), ok).toBe(true);
    for (const bad of ['', '123', '63-123456 42', '63-123456 AB 42', 'ABCDEFGH', '63-1234 A 42', '63-123456 A 4']) expect(isValidBirthCert(bad), bad).toBe(false);
  });

  it('show the stored number in the usual layout', () => {
    expect(formatBirthCert('63123456A42')).toBe('63-123456 A 42');
    expect(formatBirthCert('LEGACY-1')).toBe('LEGACY-1');
  });

  it('give two spellings of one certificate the same stored value', () => {
    expect(normaliseBirthCert('63-123456 A 42')).toBe(normaliseBirthCert('63123456a42'));
  });
});

describe('profile tabs', () => {
  it('show a role only the tabs it may see', () => {
    expect(visibleStudentTabs(NOBODY)).toEqual([]);
    expect(visibleStudentTabs(user(['students.profiles.view', 'students.documents.view'])).map((t) => t.key)).toEqual(['overview', 'documents']);
    expect(visibleStudentTabs(ADMIN).map((t) => t.key)).toEqual(['overview', 'guardians', 'enrolment', 'documents', 'discipline', 'medical', 'activity']);
  });

  it('let another module register a tab, shown only to people who may see it', () => {
    registerStudentTab({ key: 'fees', label: 'Fees', permission: 'finance.fees.view' });
    expect(visibleStudentTabs(ADMIN).map((t) => t.key).at(-1)).toBe('fees');
    expect(visibleStudentTabs(user(['students.profiles.view'])).map((t) => t.key)).toEqual(['overview']);
    expect(visibleStudentTabs(user([...PERMISSION_KEYS], { disabledModules: ['finance'] })).map((t) => t.key)).not.toContain('fees');
    registerStudentTab({ key: 'fees', label: 'Fees and charges', permission: 'finance.fees.view' });
    expect(visibleStudentTabs(ADMIN).filter((t) => t.key === 'fees')).toHaveLength(1);
  });
});

describe('exports', () => {
  const keys = (u: AccessUser) => exportColumnsFor(u).map((c) => c.key);

  it('leave out medical, discipline and ID-number columns for a user who may not see them', () => {
    const plain = keys(user(['students.profiles.export', 'students.profiles.view']));
    for (const hidden of ['medicalAlert', 'specialNeedsNote', 'incidentCount', 'birthCertificateNumber', 'guardianNationalId', 'guardianName', 'guardianPhone']) {
      expect(plain, hidden).not.toContain(hidden);
    }
    expect(plain).toContain('admissionNumber');
    expect(plain).toContain('class');
  });

  it('add each sensitive column only with its own permission', () => {
    expect(keys(user(['students.medical.export']))).toContain('medicalAlert');
    expect(keys(user(['students.medical.view']))).not.toContain('medicalAlert'); // viewing is not exporting
    expect(keys(user(['students.discipline.view']))).toContain('incidentCount');
    expect(keys(user(['students.guardians.view_ids']))).toEqual(expect.arrayContaining(['birthCertificateNumber', 'guardianNationalId']));
    expect(keys(user(['students.guardians.view']))).toEqual(expect.arrayContaining(['guardianName', 'guardianPhone']));
    expect(keys(user(['students.guardians.view']))).not.toContain('guardianNationalId');
  });

  it('give an administrator every column', () => {
    expect(keys(ADMIN)).toEqual(EXPORT_COLUMNS.map((c) => c.key));
  });

  it('cannot be talked into a column by asking for it', () => {
    const asked = exportColumnsFor(user(['students.profiles.export']), ['admissionNumber', 'medicalAlert', 'guardianNationalId']);
    expect(asked.map((c) => c.key)).toEqual(['admissionNumber']);
  });

  it('give a support session no export at all', () => {
    expect(studentAccess(user([...PERMISSION_KEYS], { noExport: true })).export).toBe(false);
  });
});

describe('alert strip', () => {
  it('is empty when nothing applies', () => {
    expect(buildAlerts({}, { canSeeMedical: true })).toEqual([]);
  });

  it('names the allergy only for someone who may see medical details', () => {
    const input = { severeAllergies: ['penicillin'], hasMedicalAlert: true };
    expect(buildAlerts(input, { canSeeMedical: true })).toEqual([{ kind: 'medical', text: 'Allergy: penicillin' }]);
    expect(buildAlerts(input, { canSeeMedical: false })).toEqual([{ kind: 'medical', text: 'Medical alert: severe allergy' }]);
    expect(JSON.stringify(buildAlerts(input, { canSeeMedical: false }))).not.toContain('penicillin');
  });

  it('adds suspension with its end date, special needs and custody notes', () => {
    const a = buildAlerts({ suspension: { endDate: '2026-03-05' }, specialNeeds: true, custodyNotes: ['Only collect with mother'] }, { canSeeMedical: false });
    expect(a.map((x) => x.kind)).toEqual(['suspension', 'special-needs', 'custody']);
    expect(a[0]!.text).toContain('2026-03-05');
    expect(a[2]!.text).toBe('Only collect with mother');
  });
});

describe('class lists', () => {
  const rows = [
    { surname: 'Moyo', firstName: 'Tendai', gender: 'M' as const },
    { surname: 'Dube', firstName: 'Rufaro', gender: 'F' as const },
    { surname: 'Chari', firstName: 'Tino', gender: 'M' as const },
    { surname: 'dube', firstName: 'Anesu', gender: 'M' as const },
    { surname: 'Éloi', firstName: 'Zed', gender: 'F' as const },
    { surname: 'Zulu', firstName: 'Lee', gender: null },
  ];

  it('sorts alphabetically by surname, then first name, ignoring case and accents', () => {
    expect(sortBySurname(rows).map((r) => `${r.surname} ${r.firstName}`)).toEqual([
      'Chari Tino', 'dube Anesu', 'Dube Rufaro', 'Éloi Zed', 'Moyo Tendai', 'Zulu Lee',
    ]);
  });

  it('does not change the list it was given', () => {
    const before = rows.map((r) => r.surname);
    sortBySurname(rows);
    expect(rows.map((r) => r.surname)).toEqual(before);
  });

  it('lists everyone together, or boys and girls separately', () => {
    const together = classListSections(rows, false);
    expect(together).toHaveLength(1);
    expect(together[0]!.title).toBeNull();
    expect(together[0]!.students).toHaveLength(6);

    const apart = classListSections(rows, true);
    expect(apart.map((s) => s.title)).toEqual(['Boys', 'Girls', 'Gender not recorded']);
    expect(apart[0]!.students.map((r) => r.surname)).toEqual(['Chari', 'dube', 'Moyo']);
    expect(apart[1]!.students.map((r) => r.surname)).toEqual(['Dube', 'Éloi']);
  });

  it('leaves out the unknown-gender section when everyone has one', () => {
    expect(classListSections(rows.filter((r) => r.gender), true).map((s) => s.title)).toEqual(['Boys', 'Girls']);
  });
});
