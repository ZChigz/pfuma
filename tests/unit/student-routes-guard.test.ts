// @vitest-environment node
// A guard on the shape of the Student Information code: every API route asks for a permission, no query skips the
// school-scoped client, and the permission keys the code asks for really exist.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@/lib/access-core';

const root = path.resolve(__dirname, '../..');

function files(dir: string, test: (f: string) => boolean): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...files(rel, test));
    else if (test(e.name)) out.push(rel.replace(/\\/g, '/'));
  }
  return out;
}

const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');
const studentRoutes = [
  ...files('app/api/students', (n) => n === 'route.ts'),
  ...files('app/api/system/houses', (n) => n === 'route.ts'),
  'app/api/system/settings/documents/route.ts',
];
const legacyRoutes = files('app/api/admin/students', (n) => n === 'route.ts');

describe('every student route asks who is calling', () => {
  it('finds the routes', () => {
    expect(studentRoutes.length).toBeGreaterThan(40);
  });

  it('asks for a permission (or a signed-in user, for lookups the service then checks) in each handler', () => {
    const bad: string[] = [];
    for (const f of studentRoutes) {
      const src = read(f);
      const handlers = (src.match(/async function _[A-Z]+\(/g) ?? []).length;
      const asks = (src.match(/await require(Permission|SignedIn)\(/g) ?? []).length;
      if (handlers === 0 || asks < handlers) bad.push(`${f}: ${handlers} handler(s), ${asks} permission check(s)`);
    }
    expect(bad).toEqual([]);
  });

  it('asks before it reads the body or touches anything', () => {
    const late: string[] = [];
    for (const f of studentRoutes) {
      const src = read(f);
      for (const m of Array.from(src.matchAll(/async function (_[A-Z]+)\([^)]*\) \{([\s\S]*?)\n\}/g))) {
        const body = m[2]!;
        const ask = body.search(/await require(Permission|SignedIn)\(/);
        const touch = body.search(/req\.json\(|parseBody\(|getScopedDb\(|await [a-zA-Z]+\(user/);
        if (ask < 0 || (touch >= 0 && touch < ask)) late.push(`${f} ${m[1]}`);
      }
    }
    expect(late).toEqual([]);
  });

  it('keeps the older admin student routes behind the same permissions', () => {
    for (const f of legacyRoutes) expect(read(f), f).toMatch(/requirePermission\(|requireSignedIn\(/);
    for (const f of files('app/api/admin/students', (n) => n.endsWith('.ts'))) expect(read(f), f).not.toMatch(/canManageEnrollment|canManageGuardians/);
  });
});

describe('every query is scoped to the school', () => {
  it('never uses the raw Prisma client in the student services or routes', () => {
    const offenders = [...files('lib/students', (n) => n.endsWith('.ts')), ...studentRoutes]
      .filter((f) => /from '@\/lib\/prisma'/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('writes an audit entry in each service that changes data', () => {
    const services = ['enrolment', 'houses', 'discipline', 'leavers', 'medical', 'documents', 'admit', 'update', 'admissions', 'promotion', 'import', 'alumni', 'guardians'];
    for (const s of services) expect(read(`lib/students/${s}.ts`), s).toMatch(/logAudit\(|auditLog\.createMany/);
  });

  it('keeps a student from ever being deleted by the code', () => {
    const offenders = files('lib', (n) => n.endsWith('.ts')).concat(files('app', (n) => n.endsWith('.ts') || n.endsWith('.tsx'))).filter((f) => /\.student\.(delete|deleteMany)\(/.test(read(f)));
    expect(offenders).toEqual([]);
  });
});

describe('the permission keys', () => {
  it('that the student code asks for all exist in the catalogue', () => {
    const asked = new Set<string>();
    for (const f of [...studentRoutes, ...files('lib/students', (n) => n.endsWith('.ts'))]) {
      for (const m of Array.from(read(f).matchAll(/'((?:students|system|finance)\.[a-z_]+\.[a-z_]+)'/g))) asked.add(m[1]!);
    }
    expect(asked.size).toBeGreaterThan(20);
    for (const k of Array.from(asked)) expect(k in PERMISSIONS, k).toBe(true);
  });

  it('are seeded in the database migration, one row each', () => {
    const migration = read('prisma/migrations/20261031000000_students_module/migration.sql');
    const wanted = Object.keys(PERMISSIONS).filter((k) => k.startsWith('students.') && k.split('.').length === 3);
    for (const k of wanted) expect(migration, k).toContain(`'${k}'`);
  });

  it('never allow corporal punishment as a discipline action', () => {
    expect(read('prisma/schema.prisma')).not.toMatch(/CORPORAL|CANING|BEATING/);
    expect(read('lib/students/discipline.ts')).toMatch(/Education Amendment Act, 2020/);
  });
});
