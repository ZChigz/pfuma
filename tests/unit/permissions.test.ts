import { describe, it, expect } from 'vitest';
import {
  canVerifyPayment,
  canVoidPayment,
  canApplyCharge,
  canPublishResults,
  canManageAssets,
  canDisposeAsset,
  canManageLibrary,
  canManageStudents,
  canVoidExpense,
  canManageSubjects,
  canEnterMarks,
} from '@/lib/permissions';
import type { UserRole } from '@/types';

// Asserts that calling fn() rejects with a Response whose status is 403.
async function expectForbidden(fn: () => Promise<void>) {
  await expect(fn()).rejects.toSatisfy(
    (e: unknown) => e instanceof Response && e.status === 403,
  );
}

// Asserts that calling fn() resolves without throwing.
async function expectAllowed(fn: () => Promise<void>) {
  await expect(fn()).resolves.toBeUndefined();
}

// ─── canVerifyPayment ────────────────────────────────────────────────────────

describe('canVerifyPayment', () => {
  it.each(['DIRECTOR', 'HEAD'] as UserRole[])('%s is allowed', async (role) => {
    await expectAllowed(() => canVerifyPayment(role));
  });
  it.each(['BURSAR', 'TEACHER', 'LIBRARIAN'] as UserRole[])('%s is forbidden', async (role) => {
    await expectForbidden(() => canVerifyPayment(role));
  });
});

// ─── canVoidPayment ──────────────────────────────────────────────────────────

describe('canVoidPayment', () => {
  it('DIRECTOR is allowed', async () => {
    await expectAllowed(() => canVoidPayment('DIRECTOR'));
  });
  it.each(['HEAD', 'BURSAR', 'TEACHER', 'LIBRARIAN'] as UserRole[])('%s is forbidden', async (role) => {
    await expectForbidden(() => canVoidPayment(role));
  });
});

// ─── canApplyCharge ──────────────────────────────────────────────────────────

describe('canApplyCharge', () => {
  it.each(['DIRECTOR', 'HEAD'] as UserRole[])('%s is allowed', async (role) => {
    await expectAllowed(() => canApplyCharge(role));
  });
  it.each(['BURSAR', 'TEACHER', 'LIBRARIAN'] as UserRole[])('%s is forbidden', async (role) => {
    await expectForbidden(() => canApplyCharge(role));
  });
});

// ─── canPublishResults ───────────────────────────────────────────────────────

describe('canPublishResults', () => {
  it.each(['DIRECTOR', 'HEAD'] as UserRole[])('%s is allowed', async (role) => {
    await expectAllowed(() => canPublishResults(role));
  });
  it.each(['BURSAR', 'TEACHER', 'LIBRARIAN'] as UserRole[])('%s is forbidden', async (role) => {
    await expectForbidden(() => canPublishResults(role));
  });
});

// ─── canManageAssets ─────────────────────────────────────────────────────────

describe('canManageAssets', () => {
  it.each(['DIRECTOR', 'HEAD', 'BURSAR'] as UserRole[])('%s is allowed', async (role) => {
    await expectAllowed(() => canManageAssets(role));
  });
  it.each(['TEACHER', 'LIBRARIAN'] as UserRole[])('%s is forbidden', async (role) => {
    await expectForbidden(() => canManageAssets(role));
  });
});

// ─── canDisposeAsset ─────────────────────────────────────────────────────────

describe('canDisposeAsset', () => {
  it.each(['DIRECTOR', 'HEAD'] as UserRole[])('%s is allowed', async (role) => {
    await expectAllowed(() => canDisposeAsset(role));
  });
  it.each(['BURSAR', 'TEACHER', 'LIBRARIAN'] as UserRole[])('%s is forbidden', async (role) => {
    await expectForbidden(() => canDisposeAsset(role));
  });
});

// ─── canManageLibrary ────────────────────────────────────────────────────────

describe('canManageLibrary', () => {
  it.each(['DIRECTOR', 'HEAD', 'LIBRARIAN'] as UserRole[])('%s is allowed', async (role) => {
    await expectAllowed(() => canManageLibrary(role));
  });
  it.each(['BURSAR', 'TEACHER'] as UserRole[])('%s is forbidden', async (role) => {
    await expectForbidden(() => canManageLibrary(role));
  });
});

// ─── canManageStudents ───────────────────────────────────────────────────────

describe('canManageStudents', () => {
  it.each(['DIRECTOR', 'HEAD', 'BURSAR'] as UserRole[])('%s is allowed', async (role) => {
    await expectAllowed(() => canManageStudents(role));
  });
  it.each(['TEACHER', 'LIBRARIAN'] as UserRole[])('%s is forbidden', async (role) => {
    await expectForbidden(() => canManageStudents(role));
  });
});

// ─── canVoidExpense ──────────────────────────────────────────────────────────

describe('canVoidExpense', () => {
  it('DIRECTOR is allowed', async () => {
    await expectAllowed(() => canVoidExpense('DIRECTOR'));
  });
  it.each(['HEAD', 'BURSAR', 'TEACHER', 'LIBRARIAN'] as UserRole[])('%s is forbidden', async (role) => {
    await expectForbidden(() => canVoidExpense(role));
  });
});

// ─── canManageSubjects ───────────────────────────────────────────────────────

describe('canManageSubjects', () => {
  it.each(['DIRECTOR', 'HEAD'] as UserRole[])('%s is allowed', async (role) => {
    await expectAllowed(() => canManageSubjects(role));
  });
  it.each(['BURSAR', 'TEACHER', 'LIBRARIAN'] as UserRole[])('%s is forbidden', async (role) => {
    await expectForbidden(() => canManageSubjects(role));
  });
});

// ─── canEnterMarks ───────────────────────────────────────────────────────────

describe('canEnterMarks', () => {
  it.each(['DIRECTOR', 'HEAD', 'TEACHER'] as UserRole[])('%s is allowed', async (role) => {
    await expectAllowed(() => canEnterMarks(role));
  });
  it.each(['BURSAR', 'LIBRARIAN'] as UserRole[])('%s is forbidden', async (role) => {
    await expectForbidden(() => canEnterMarks(role));
  });
});

// ─── Error shape ─────────────────────────────────────────────────────────────

describe('forbidden Response shape', () => {
  it('throws a Response with status 403 and JSON body', async () => {
    let caught: unknown;
    try {
      await canVoidPayment('BURSAR');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Response);
    const res = caught as Response;
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, message: 'Forbidden' });
  });
});
