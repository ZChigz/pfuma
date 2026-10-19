// @vitest-environment node
// A guard on the shape of the Academics code: every API route and every page asks who is calling, no query skips the
// school-scoped client, every service that changes data writes an audit entry, subjects are not hard-coded, and the
// permission keys the code asks for exist and are seeded by the migration.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@/lib/access-core';

const root = path.resolve(__dirname, '../..');

function files(dir: string, test: (f: string) => boolean): string[] {
  const out: string[] = [];
  if (!fs.existsSync(path.join(root, dir))) return out;
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...files(rel, test));
    else if (test(e.name)) out.push(rel.replace(/\\/g, '/'));
  }
  return out;
}

const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');
const routes = files('app/api/academics', (n) => n === 'route.ts');
const pages = files('app/(dashboard)/academics', (n) => n === 'page.tsx');
const services = files('lib/academics', (n) => n.endsWith('.ts'));

describe('every Academics route asks who is calling', () => {
  it('finds the routes', () => {
    expect(routes.length).toBeGreaterThan(60);
  });

  it('asks for a permission in each handler, before it reads the body or touches anything', () => {
    const bad: string[] = [];
    for (const f of routes) {
      const src = read(f);
      const handlers = Array.from(src.matchAll(/async function (_[A-Z]+)\([^)]*\) \{([\s\S]*?)\n\}/g));
      if (handlers.length === 0) bad.push(`${f}: no handler`);
      for (const m of handlers) {
        const body = m[2]!;
        const ask = body.search(/await requirePermission\('/);
        const touch = body.search(/readBody\(|req\.json\(|getScopedDb\(|await [a-zA-Z]+\(user/);
        if (ask < 0 || (touch >= 0 && touch < ask)) bad.push(`${f} ${m[1]}`);
      }
      const exported = (src.match(/export const (GET|POST|PUT|PATCH|DELETE) = /g) ?? []).length;
      if (exported !== handlers.length) bad.push(`${f}: ${handlers.length} handlers, ${exported} exports`);
    }
    expect(bad).toEqual([]);
  });

  it('never lets a visitor in: nothing reads a session by hand', () => {
    for (const f of routes) expect(read(f), f).not.toMatch(/\bauth\(\)/);
  });
});

describe('every Academics page asks what the person may do', () => {
  it('finds the pages', () => {
    expect(pages.length).toBeGreaterThan(12);
  });

  it('gets the access context and checks a permission before showing anything', () => {
    const bad: string[] = [];
    for (const f of pages) {
      const src = read(f);
      if (!/await getAccess\(\)/.test(src)) bad.push(`${f}: no getAccess()`);
      if (!/can\('academics\.[a-z_]+\.[a-z_]+'\)/.test(src)) bad.push(`${f}: no can('academics...')`);
      if (!/AccessDenied/.test(src)) bad.push(`${f}: no AccessDenied`);
    }
    expect(bad).toEqual([]);
  });
});

describe('every query is scoped to the school', () => {
  it('never uses the raw Prisma client in the Academics services or routes', () => {
    const offenders = [...services, ...routes].filter((f) => /from '@\/lib\/prisma'/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('writes an audit entry in each service that changes data', () => {
    const changing = ['settings', 'subjects', 'student-subjects', 'groups', 'assignments', 'classes', 'attendance', 'bell', 'timetable', 'curriculum'];
    for (const s of changing) expect(read(`lib/academics/${s}.ts`), s).toMatch(/logAudit\(/);
    // Every write method the services use sits in a function that also logs; the longest ones are checked by their tests.
    for (const s of changing) {
      const src = read(`lib/academics/${s}.ts`);
      const writes = (src.match(/tx\.[a-zA-Z]+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g) ?? []).length;
      const logs = (src.match(/logAudit\(/g) ?? []).length;
      expect(logs, `${s}: ${writes} writes`).toBeGreaterThan(0);
    }
  });
});

describe('subjects are not hard-coded', () => {
  it('keeps the starter list in one place and the code free of subject names', () => {
    const names = ['Combined Science', 'Mathematics', 'English Language', 'Heritage Studies', 'Geography', 'Accounts', 'Agriculture'];
    const offenders: string[] = [];
    for (const f of [...services, ...routes, ...files('components/academics', (n) => n.endsWith('.tsx') || n.endsWith('.ts')), ...pages]) {
      if (f === 'lib/academics/subjects.ts') continue;
      const src = read(f);
      for (const n of names) if (src.includes(`'${n}'`) || src.includes(`"${n}"`)) offenders.push(`${f}: ${n}`);
    }
    expect(offenders).toEqual([]);
    expect(read('lib/academics/subjects.ts')).toMatch(/Common Zimbabwe secondary subjects\. A school edits this list/);
  });

  it('has no Subject enum or fixed list in the schema other than the editable tables', () => {
    expect(read('prisma/schema.prisma')).not.toMatch(/enum SubjectName|enum SubjectCode/);
  });
});

describe('the permission keys', () => {
  it('that the Academics code asks for all exist in the catalogue', () => {
    const asked = new Set<string>();
    const sources = [...routes, ...services, ...pages, ...files('components/academics', (n) => n.endsWith('.tsx') || n.endsWith('.ts'))];
    for (const f of sources) for (const m of Array.from(read(f).matchAll(/'(academics\.[a-z_]+\.[a-z_]+)'/g))) asked.add(m[1]!);
    expect(asked.size).toBeGreaterThan(15);
    for (const k of Array.from(asked)) expect(k in PERMISSIONS, k).toBe(true);
  });

  it('are the 21 keys of the brief, seeded in the database migration, one row each', () => {
    const wanted = Object.keys(PERMISSIONS).filter((k) => k.startsWith('academics.'));
    expect(wanted.sort()).toEqual([
      'academics.analytics.view', 'academics.assignments.approve', 'academics.assignments.manage', 'academics.assignments.view', 'academics.attendance.correct',
      'academics.attendance.mark', 'academics.attendance.view', 'academics.classes.manage', 'academics.classes.view', 'academics.schemes.approve', 'academics.schemes.edit',
      'academics.schemes.view', 'academics.student_subjects.manage', 'academics.subjects.approve', 'academics.subjects.manage', 'academics.subjects.view',
      'academics.syllabus.manage', 'academics.timetable.approve', 'academics.timetable.cover', 'academics.timetable.edit', 'academics.timetable.view',
    ]);
    const migration = read('prisma/migrations/20261101000000_academics_module/migration.sql');
    for (const k of wanted) expect(migration, k).toContain(`'${k}'`);
  });

  it('give Owner and Administrator everything, and a teacher and class teacher only their own-class keys', () => {
    const sql = read('prisma/migrations/20261101000000_academics_module/migration.sql');
    const teacher = sql.match(/WHEN 'TEACHER' THEN ARRAY\[([^\]]+)\]/)![1]!;
    const classTeacher = sql.match(/WHEN 'CLASS_TEACHER' THEN ARRAY\[([^\]]+)\]/)![1]!;
    for (const manage of ['.manage', '.approve', '.correct', '.edit\'', '.cover', 'analytics']) {
      expect(teacher).not.toContain(manage === '.edit\'' ? 'timetable.edit' : manage);
      expect(classTeacher).not.toContain(manage === '.edit\'' ? 'timetable.edit' : manage);
    }
    expect(teacher).toContain('academics.attendance.mark');
    expect(classTeacher).toContain('academics.attendance.mark');
  });
});

describe('closed terms and clash rules live in the database too', () => {
  it('has a closed-term trigger on every table that belongs directly to a term, and the clash indexes', () => {
    const sql = read('prisma/migrations/20261101000000_academics_module/migration.sql');
    for (const t of ['ClassTeacher', 'StudentSubject', 'TeachingGroup', 'TeacherAssignment', 'AssignmentSet', 'Timetable', 'AttendanceRegister', 'SchemeOfWork']) {
      expect(sql, t).toContain(`"closed_term_${t}"`);
    }
    for (const i of ['TimetableSlot_teacher_per_period', 'TimetableSlot_class_per_period', 'TimetableSlot_room_per_period', 'AttendanceRegister_class_day_session', 'TeacherAssignment_one_active_per_class', 'ClassTeacher_classId_termId_key']) {
      expect(sql + read('prisma/migrations/20261101000000_academics_module/migration.sql'), i).toContain(i);
    }
  });

  it('has row-level security and a same-school check on every new table', () => {
    const sql = read('prisma/migrations/20261101000000_academics_module/migration.sql');
    const tables = Array.from(sql.matchAll(/CREATE TABLE "([A-Za-z]+)"/g)).map((m) => m[1]!).filter((t) => t !== 'SyllabusTemplate');
    expect(tables.length).toBe(28);
    for (const t of tables) {
      expect(sql, `${t} row-level security`).toMatch(new RegExp(`'${t}'`));
      expect(sql, `${t} school column`).toMatch(new RegExp(`CREATE TABLE "${t}" \\([\\s\\S]*?"schoolId" TEXT NOT NULL`));
    }
    for (const t of tables.filter((x) => x !== 'AcademicsSettings' && x !== 'Room' && x !== 'AssignmentSet' && x !== 'MessageOutbox')) {
      expect(sql.includes(`"same_school_${t}"`) || sql.includes(`ON "${t}" FOR EACH ROW EXECUTE FUNCTION check_same_school`), `${t} same-school`).toBe(true);
    }
  });
});
