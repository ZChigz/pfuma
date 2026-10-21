// A server component that imports a constant or calls a helper from a 'use client' module does not get the value: it gets a client
// reference, and the production render fails with "Something went wrong" (development and the render tests do not show it). This
// guard reads every server file under app/ and lib/ and allows only components (Capitalised names) and types from client modules.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');
const isClient = (src: string) => /^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/.test(src);

function files(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(tsx?|jsx?)$/.test(e)) out.push(p);
  }
  return out;
}

function resolveModule(spec: string, from: string): string | null {
  const base = spec.startsWith('@/') ? path.join(root, spec.slice(2)) : spec.startsWith('.') ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return null;
  for (const c of [base, `${base}.tsx`, `${base}.ts`, path.join(base, 'index.tsx'), path.join(base, 'index.ts')]) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

describe('server files take only components from client modules', () => {
  it('imports no constant or helper function from a "use client" file', () => {
    const offenders: string[] = [];
    for (const f of [...files(path.join(root, 'app')), ...files(path.join(root, 'lib'))]) {
      const src = readFileSync(f, 'utf8');
      if (isClient(src)) continue;
      for (const m of Array.from(src.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g))) {
        if (m[1]) continue; // import type { ... }
        const target = resolveModule(m[3]!, f);
        if (!target || !isClient(readFileSync(target, 'utf8'))) continue;
        for (const raw of m[2]!.split(',')) {
          const name = raw.trim().replace(/\s+as\s+\w+$/, '');
          if (!name || name.startsWith('type ')) continue;
          const isComponent = /^[A-Z][a-z0-9]/.test(name) || /^[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*$/.test(name);
          if (!isComponent) offenders.push(`${path.relative(root, f)}: ${name} from ${m[3]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
