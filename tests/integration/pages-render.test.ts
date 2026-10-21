// @vitest-environment node
/// <reference types="vite/client" />
// Every dashboard page, run as every role against real data. Server components are
// resolved the way Next does it (async components are awaited down the tree), so the
// page's own queries run through the school-scoped client. A page may redirect or
// show "not found"; it must never throw anything else.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import type { Role } from '@prisma/client';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, ROLES, type SeededSchool } from '../helpers/seed';
import { session } from '../helpers/session';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

const pageModules = import.meta.glob('../../app/\\(dashboard\\)/**/page.tsx') as Record<string, () => Promise<{ default: (props: unknown) => unknown }>>;

// Pages marked 'use client' run in the browser and use hooks; only server pages are exercised here.
const pageSources = import.meta.glob('../../app/\\(dashboard\\)/**/page.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const isClientPage = (file: string) => (pageSources[file] ?? '').slice(0, 400).includes('use client');

let t: TestDb;
let A: SeededSchool;
let prisma: typeof import('@/lib/prisma').prisma;
let intakeId = '';

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  A = await seedSchool(prisma, 'School A');
  intakeId = (await prisma.intake.create({ data: { schoolId: A.schoolId, name: 'Form 1, 2027', levelId: A.levelId, year: 2027, places: 30 } })).id;
  await prisma.application.create({ data: { schoolId: A.schoolId, intakeId, firstName: 'Apply', surname: 'Page', gender: 'F', dateOfBirth: new Date('2014-01-01'), guardianName: 'Mai Page', guardianPhone: '+263771112222' } });
  // A published result, a voided payment and an open request so the busier branches run.
  await prisma.termResult.create({ data: { schoolId: A.schoolId, studentId: A.studentId, termId: A.termId, totalMarks: 60, percentage: 60, classPosition: 1, published: true } });
  await prisma.payment.create({ data: { schoolId: A.schoolId, studentId: A.studentId, currency: 'USD', amount: 5, method: 'CASH', feeLabel: 'x', status: 'VOIDED', recordedBy: A.users.BURSAR.id, voidedBy: A.users.DIRECTOR.id } });
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

const isControlFlow = (e: unknown) =>
  typeof (e as { digest?: string })?.digest === 'string' &&
  /^(NEXT_REDIRECT|NEXT_NOT_FOUND)/.test((e as { digest: string }).digest);

/** Awaits async server components anywhere in the tree; leaves client/sync components alone. */
async function resolve(node: ReactNode, depth = 0): Promise<void> {
  if (depth > 12 || node == null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) await resolve(n, depth + 1);
    return;
  }
  if (!isValidElement(node)) return;
  const el = node as ReactElement<{ children?: ReactNode }>;
  if (typeof el.type === 'function' && el.type.constructor.name === 'AsyncFunction') {
    const out = await (el.type as (p: unknown) => Promise<ReactNode>)(el.props);
    await resolve(out, depth + 1);
  }
  const props = el.props as Record<string, unknown>;
  await resolve(props.children as ReactNode, depth + 1);
}

function propsFor(file: string) {
  const params: Record<string, string> = {};
  if (file.includes('/classes/[id]')) params.id = A.classId;
  else if (file.includes('/accounting/students/[id]')) params.id = A.studentId;
  else if (file.includes('/finance/accounts/[studentId]')) params.studentId = A.studentId;
  else if (file.includes('/assets/[id]')) params.id = A.assetId;
  else if (file.includes('/students/[id]')) params.id = A.studentId;
  else if (file.includes('/admissions/[intakeId]')) params.intakeId = intakeId;
  else if (file.includes('/teacher/requests/[id]')) params.id = A.requestId;
  if (file.includes('[assignmentId]')) params.assignmentId = A.assignmentId;
  return { params, searchParams: { termId: A.termId, classId: A.classId, q: '' } };
}

describe('dashboard pages render without errors for every role', () => {
  const files = Object.keys(pageModules).filter((f) => !isClientPage(f));

  it('found the pages', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  for (const role of ROLES) {
    it(`as ${role}`, async () => {
      const failures: string[] = [];
      for (const file of files) {
        session.current = { ...A.users[role as Role] };
        try {
          const mod = await pageModules[file]();
          const tree = await mod.default(propsFor(file));
          await resolve(tree as ReactNode);
        } catch (e) {
          if (!isControlFlow(e)) failures.push(`${file.replace('../../app/', '')}: ${(e as Error).message?.split('\n').slice(0, 4).join(' | ')}`);
        }
      }
      expect(failures).toEqual([]);
    }, 180_000);
  }
});
