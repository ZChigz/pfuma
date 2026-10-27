// @vitest-environment node
// The permission matrix, generated from the access seed (prisma/seed/access.ts) and checked against the real engine, the sidebar
// and the API routes. For every role and every key in the catalogue the question is the same: does the person hold it, and how far
// does it reach? There are no hand-written cases to forget; adding a key, a role or a route adds the checks.
//
//   1. engine   every role x every key: can() and the scope it is held at match the seed
//   2. pages    every role x every sidebar page: the page opens when one of its keys is held
//   3. routes   every role x every list route with one permission check: refused (403) when the key is missing, never when held
//   4. snapshot the whole matrix is written to tests/integration/__matrix__/access-matrix.md, so a changed grant shows in review
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, userWithRoles, type SeededSchool, type SeededUser } from '../helpers/seed';
import { call } from '../helpers/route';
import { ROLES, catalogue, expandGrants } from '../../prisma/seed/access';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

let t: TestDb;
let A: SeededSchool;
let prisma: typeof import('@/lib/prisma').prisma;
let access: typeof import('@/lib/access');
let routes: typeof import('@/lib/access/routes');
let uiMod: typeof import('@/lib/access/ui');

type Ctx = Awaited<ReturnType<typeof import('@/lib/access').loadAccessContext>>;
const people = new Map<string, SeededUser>();
const contexts = new Map<string, Ctx>();

const KEYS = catalogue().map((c) => c.key);
/** The roles that hold "*" until the switch (step 8) are expected to hold every key. */
const everything = (_role: string) => false; // nobody holds "*" any more: every role holds exactly its listed keys

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  access = await import('@/lib/access');
  routes = await import('@/lib/access/routes');
  uiMod = await import('@/lib/access/ui');
  A = await seedSchool(prisma, 'School A');
  for (const r of ROLES) {
    const person = await userWithRoles(prisma, A, [r.key], r.key.toLowerCase());
    people.set(r.key, person);
    contexts.set(r.key, await access.loadAccessContext({ user: { id: person.id, schoolId: person.schoolId, role: 'TEACHER', email: person.email, fullName: person.fullName } as never }));
  }
  const nobody = await userWithRoles(prisma, A, [], 'nobody');
  people.set('NOBODY', nobody);
  contexts.set('NOBODY', await access.loadAccessContext({ user: { id: nobody.id, schoolId: nobody.schoolId, role: 'TEACHER', email: nobody.email, fullName: nobody.fullName } as never }));
}, 300_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

describe('the engine: every role x every key', () => {
  for (const r of ROLES) {
    it(`${r.key} holds exactly what the seed gives it, each at its scope`, () => {
      const ctx = contexts.get(r.key)!;
      const expected = expandGrants(r);
      const ui = uiMod.uiPermissions(ctx);
      const wrong: string[] = [];
      for (const key of KEYS) {
        const should = everything(r.key) || expected.has(key);
        if (access.can(ctx, key) !== should) wrong.push(`${key}: should ${should ? 'be held' : 'not be held'}`);
        else if (should && !everything(r.key)) {
          const scopes = ui[key] ?? [];
          if (scopes.join() !== expected.get(key)) wrong.push(`${key}: held at ${scopes.join() || 'nothing'}, the seed says ${expected.get(key)}`);
        }
      }
      expect(wrong).toEqual([]);
    });
  }

  it('a person with no role holds nothing apart from their own account', () => {
    const ctx = contexts.get('NOBODY')!;
    const held = KEYS.filter((k) => access.can(ctx, k));
    expect(held.filter((k) => !k.startsWith('account.'))).toEqual([]);
  });

  it('a key that is not in the catalogue is held by nobody, the Owner included', () => {
    for (const r of ROLES) expect(access.can(contexts.get(r.key)!, 'made.up.key')).toBe(false);
  });
});

describe('the pages: every role x every sidebar page', () => {
  it('a page opens exactly when one of its keys is held', () => {
    const wrong: string[] = [];
    for (const rule of routes.routeRules()) {
      for (const [roleKey, ctx] of Array.from(contexts)) {
        const should = rule.keys.some((k) => access.can(ctx, k));
        if (routes.mayOpen(ctx, rule.href) !== should) wrong.push(`${roleKey} ${rule.href}: should ${should ? 'open' : 'be refused'}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('the sidebar knows at least one page for every module', () => {
    const modules = new Set(routes.routeRules().flatMap((r) => r.keys.map((k) => k.split('.')[0])));
    for (const m of ['system', 'students', 'academics', 'exams', 'finance', 'hr']) expect(modules.has(m), m).toBe(true);
  });
});

describe('the routes: every role x every list route with one permission check', () => {
  const root = path.resolve(__dirname, '../../app/api');
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

  /** The one permission key a GET handler asks for first, when it asks for exactly one (a route that picks its key by the request is left out). */
  function singleKey(file: string): string | null {
    const text = fs.readFileSync(file, 'utf8');
    const at = text.search(/(async function _?GET\b|export (async )?function GET\b)/);
    if (at < 0) return null;
    const body = text.slice(at).split(/\n(?=async function |export )/)[0]!;
    const keys = Array.from(new Set(Array.from(body.matchAll(/requirePermission\(\s*'([a-z_]+\.[a-z_.]+)'/g)).map((m) => m[1]!)));
    if (keys.length !== 1 || /requirePermission\([^)]*\?/.test(body)) return null;
    return keys[0]!;
  }

  const found = walk(root)
    .filter((f) => f.endsWith(`${path.sep}route.ts`) && !f.includes('['))
    .map((f) => ({ file: path.relative(root, path.dirname(f)).split(path.sep).join('/'), key: singleKey(f) }))
    .filter((r): r is { file: string; key: string } => !!r.key && !/^(platform|portal|cron|auth|upload)\b/.test(r.file));

  it('finds a worthwhile number of routes', () => {
    expect(found.length).toBeGreaterThan(40);
  });

  it('every role is refused (403) where it lacks the key and is never refused for it where it holds it', async () => {
    const wrong: string[] = [];
    for (const { file, key } of found) {
      for (const [roleKey, person] of Array.from(people)) {
        const ctx = contexts.get(roleKey)!;
        const holds = access.can(ctx, key);
        const r = await call(file, 'GET', { as: person }).catch((e: Error) => ({ status: 500, text: e.message }));
        if (!holds && r.status !== 403) wrong.push(`${roleKey} GET ${file} lacks ${key}: answered ${r.status}`);
        if (holds && (r.status === 403 || r.status === 401)) wrong.push(`${roleKey} GET ${file} holds ${key}: answered ${r.status} ${String((r as { text?: string }).text ?? '').slice(0, 80)}`);
      }
    }
    expect(wrong).toEqual([]);
  }, 600_000);
});

describe('the matrix on paper', () => {
  it('is written to tests/integration/__matrix__/access-matrix.md; a changed grant shows as a changed line', async () => {
    const lines: string[] = ['# Access matrix', '', 'Generated from prisma/seed/access.ts by tests/integration/access-matrix.test.ts. One section per role; each line is a key and the scope it is held at.', ''];
    for (const r of ROLES) {
      const held = expandGrants(r);
      lines.push(`## ${r.key}${everything(r.key) ? ' (also "*" until the switch)' : ''}`, '');
      for (const key of KEYS) if (held.has(key)) lines.push(`- ${key} @ ${held.get(key)}`);
      lines.push('');
    }
    await expect(lines.join('\n')).toMatchFileSnapshot('./__matrix__/access-matrix.md');
  });
});
