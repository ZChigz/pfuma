// @vitest-environment node
// Conventions that keep the access model honest, checked on the source: every route asks for a permission, and nothing decides by a
// role name. A new route or page that breaks them fails here, not in production.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');
const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' || e.name === '.next' ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]));
const rel = (f: string) => path.relative(root, f).split(path.sep).join('/');
const read = (f: string) => fs.readFileSync(f, 'utf8');

describe('every API route asks for a permission', () => {
  // A route holds one of these, or is on the list below with the reason it needs none.
  const GUARD = /requirePermission\(|authorize\(|authorizeAny\(|guarded\(|requireSignedIn\(|getAccess\(|report-routes/;
  const WITHOUT: Record<string, string> = {
    'app/api/auth/': 'Auth.js sign-in and sign-out',
    'app/api/health/': 'uptime probe, returns nothing about a school',
    'app/api/password-reset/': 'a person who cannot sign in asks for a reset link',
    'app/api/cron/': 'scheduled jobs, protected by the cron secret',
    'app/api/platform/': 'the Pfuma console, its own sign-in and session',
    'app/api/portal/': 'the parent portal, a PIN and a private link instead of a staff sign-in',
    'app/api/upload/': 'UploadThing: each upload type checks its permission in lib/upload-router.ts',
    'app/api/account/': 'self-service: any signed-in person changes their own password',
    'app/api/system/support/end/': 'ends the support session you are in',
  };
  const routes = walk(path.join(root, 'app/api')).filter((f) => f.endsWith('route.ts')).map(rel);

  it('has no handler without a check, apart from the listed routes', () => {
    const unguarded: string[] = [];
    for (const f of routes.filter((r) => !Object.keys(WITHOUT).some((p) => r.startsWith(p)))) {
      const source = read(path.join(root, f));
      // Routes written as `async function _GET ...` are checked handler by handler; the module routes wrap each export in guarded().
      // From one handler to the next function, the `type H` line, or an export.
      const re = /async function (_(GET|POST|PUT|PATCH|DELETE))\b[\s\S]*?(?=\nasync function _|\ntype H|\nexport const|\nexport async|$)/g;
      let found = false;
      for (let m = re.exec(source); m; m = re.exec(source)) {
        found = true;
        if (!GUARD.test(m[0])) unguarded.push(`${f} ${m[2]}`);
      }
      if (!found && !GUARD.test(source)) unguarded.push(`${f} (file)`);
    }
    expect(unguarded).toEqual([]);
  });

  it('knows the routes it exempts still exist', () => {
    for (const p of Object.keys(WITHOUT)) expect(routes.some((f) => f.startsWith(p)), p).toBe(true);
  });
});

describe('nothing decides by a role name', () => {
  // Rules that are about particular offices live here; so does managing roles themselves, signing in, and the Pfuma console.
  const ALLOWED = [
    'lib/access/guards.ts',
    'lib/staff-roles.ts',
    'lib/system/users.ts',
    'lib/auth.ts', 'lib/auth.config.ts', 'lib/session-check.ts',
    'lib/platform/',
    'lib/validations/',
  ];
  const PATTERNS: [RegExp, string][] = [
    [/\b(user|session\.user|u|actor)\.role\s*(===|!==|==|!=)\s*['"]/, 'compares the access level to a role name'],
    [/\b(user|session\.user)\.role\)?\.includes|\.includes\((user|session\.user)\.role\)/, 'checks the access level against a list'],
    [/\[\s*['"](ADMIN|DIRECTOR|HEAD|BURSAR|TEACHER|LIBRARIAN|OWNER|ADMINISTRATOR|DEPUTY_HEAD|HR_OFFICER|HOD)['"][^\]]*\]\s*(as [^.]+)?\.includes/, 'checks against a list of role names'],
    [/\broles\??\.(includes|some)\(\s*(\(?\w+\)?\s*=>\s*\w+\s*===\s*)?['"][A-Z_]+['"]/, 'checks whether the person holds a named role'],
    [/\bcan[A-Z]\w*\((user|session\.user)\.role\)/, 'calls an older role-array guard'],
    [/\bPermission\.\w+\.includes/, 'uses an older role array'],
    [/\bROLE_(ALLOWED|HOME|NAV)\b/, 'uses a per-role table'],
    [/\buserRole\b(?!\.)/, 'passes a role into a component'],
  ];
  const files = ['app', 'lib', 'components', 'middleware.ts']
    .flatMap((p) => (fs.statSync(path.join(root, p)).isDirectory() ? walk(path.join(root, p)) : [path.join(root, p)]))
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .map(rel)
    .filter((f) => !ALLOWED.some((a) => f.startsWith(a)));

  it('keeps every page, route, component and service free of role-name checks', () => {
    const found: string[] = [];
    for (const f of files) {
      const lines = read(path.join(root, f)).split(/\r?\n/);
      lines.forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        for (const [re, why] of PATTERNS) if (re.test(line)) found.push(`${f}:${i + 1} ${why}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(found).toEqual([]);
  });
});

describe('nobody sees everything', () => {
  // The wildcard is gone: no role holds "*" (the database refuses the row), so no code may look for it or treat a person as "full".
  const sources = ['lib', 'app', 'components', 'middleware.ts'].flatMap((d) => (fs.statSync(path.join(root, d)).isDirectory() ? walk(path.join(root, d)) : [path.join(root, d)])).filter((f) => /\.(ts|tsx)$/.test(f));

  it('has no isFull() and no WILDCARD anywhere in the application', () => {
    const hits = sources.filter((f) => /\bisFull\b|\bWILDCARD\b/.test(read(f))).map(rel);
    expect(hits).toEqual([]);
  });

  it('never looks for a role that holds "*"', () => {
    const hits = sources.filter((f) => /permissionKey:\s*(\{\s*in:\s*\[[^\]]*'\*'|'\*')/.test(read(f))).map(rel);
    expect(hits).toEqual([]);
  });
});
