// Library rules shared by the API routes and the student lifecycle.
import type { CopyStatus } from '@prisma/client';
import type { Db } from '@/lib/scoped-db';
import { logAudit } from '@/lib/audit';

// ─── Copy counts (5.2) ───────────────────────────────────────────────────────
// A book has no stored number of copies: the numbers are counted from BookCopy,
// so they can never disagree with the copies that actually exist.

export interface CopyCounts {
  /** Every copy of the book, whatever its status. */
  total: number;
  available: number;
  borrowed: number;
  lost: number;
  damaged: number;
  withdrawn: number;
}

export const emptyCounts = (): CopyCounts => ({ total: 0, available: 0, borrowed: 0, lost: 0, damaged: 0, withdrawn: 0 });

const FIELD: Record<CopyStatus, keyof CopyCounts> = {
  AVAILABLE: 'available', BORROWED: 'borrowed', LOST: 'lost', DAMAGED: 'damaged', WITHDRAWN: 'withdrawn',
};

export function countCopies(copies: { status: CopyStatus }[]): CopyCounts {
  const c = emptyCounts();
  for (const copy of copies) {
    c.total++;
    c[FIELD[copy.status]]++;
  }
  return c;
}

/** Counts for many books in one query. */
export async function copyCounts(db: Db, bookIds: string[]): Promise<Map<string, CopyCounts>> {
  const rows = await db.bookCopy.groupBy({ by: ['bookId', 'status'], where: { bookId: { in: bookIds } }, _count: { _all: true } });
  const out = new Map<string, CopyCounts>(bookIds.map((id) => [id, emptyCounts()]));
  for (const r of rows) {
    const c = out.get(r.bookId) ?? emptyCounts();
    c.total += r._count._all;
    c[FIELD[r.status]] += r._count._all;
    out.set(r.bookId, c);
  }
  return out;
}

// ─── Members (5.1) ───────────────────────────────────────────────────────────

export function memberName(m: { user?: { fullName: string } | null; student?: { fullName: string } | null }): string {
  return m.user?.fullName ?? m.student?.fullName ?? 'Unknown member';
}

/** Gives a student a library membership (idempotent). Called when a student is admitted. */
export async function ensureStudentMember(tx: Db, schoolId: string, actorId: string, studentId: string) {
  const existing = await tx.libraryMember.findUnique({ where: { studentId } });
  if (existing) return existing;
  const member = await tx.libraryMember.create({ data: { schoolId, studentId, memberType: 'STUDENT' } });
  await logAudit(
    { schoolId, actorId, action: 'CREATE_LIBRARY_MEMBER', entityType: 'LibraryMember', entityId: member.id, detail: 'Student admitted' },
    tx,
  );
  return member;
}

/** Suspends the students' memberships (withdrawn, transferred out, graduated). Books they hold stay on loan until returned. */
export async function suspendStudentMembers(tx: Db, schoolId: string, actorId: string, studentIds: string[], reason: string) {
  const members = await tx.libraryMember.findMany({ where: { studentId: { in: studentIds }, borrowingSuspended: false } });
  if (members.length === 0) return 0;
  await tx.libraryMember.updateMany({
    where: { id: { in: members.map((m) => m.id) } },
    data: { borrowingSuspended: true, suspensionReason: reason },
  });
  for (const m of members) {
    await logAudit(
      { schoolId, actorId, action: 'SUSPEND_LIBRARY_MEMBER', entityType: 'LibraryMember', entityId: m.id, detail: reason },
      tx,
    );
  }
  return members.length;
}

// ─── Checkout rules (5.1) ────────────────────────────────────────────────────

export interface CheckoutContext {
  memberType: 'STAFF' | 'STUDENT';
  suspended: boolean;
  suspensionReason?: string | null;
  openBorrowings: { dueDate: Date }[];
  /** Fines on returned books that have not been settled. */
  unpaidFines: number;
  settings: { libraryFineLimit: number; studentLoanLimit: number; staffLoanLimit: number };
  now?: Date;
}

export const loanLimitFor = (type: 'STAFF' | 'STUDENT', s: CheckoutContext['settings']) =>
  type === 'STUDENT' ? s.studentLoanLimit : s.staffLoanLimit;

/** Why this member may not borrow right now, or null. status is the HTTP status to use. */
export function checkoutBlock(ctx: CheckoutContext): { status: number; message: string } | null {
  const now = ctx.now ?? new Date();
  if (ctx.suspended) {
    return { status: 403, message: `This member's borrowing privilege is suspended${ctx.suspensionReason ? `: ${ctx.suspensionReason}` : ''}` };
  }
  const overdue = ctx.openBorrowings.filter((b) => b.dueDate < now).length;
  if (overdue > 0) {
    return { status: 409, message: `This member has ${overdue} overdue book${overdue === 1 ? '' : 's'}. Return ${overdue === 1 ? 'it' : 'them'} before borrowing again.` };
  }
  if (ctx.unpaidFines > ctx.settings.libraryFineLimit) {
    return {
      status: 409,
      message: `This member has $${ctx.unpaidFines.toFixed(2)} of unpaid library fines, above the limit of $${ctx.settings.libraryFineLimit.toFixed(2)}. Settle the fines first.`,
    };
  }
  const limit = loanLimitFor(ctx.memberType, ctx.settings);
  if (ctx.openBorrowings.length >= limit) {
    return {
      status: 409,
      message: `${ctx.memberType === 'STUDENT' ? 'Students' : 'Staff'} may borrow at most ${limit} book${limit === 1 ? '' : 's'} at a time; this member already has ${ctx.openBorrowings.length}.`,
    };
  }
  return null;
}

// ─── The library moved to Facilities & Operations ────────────────────────────
// Once a school has titles in the Facilities library (the data step copies the old catalogue across), the first library screens stop
// recording anything, so the two never disagree about who has which book. They can still be read.

export const LIBRARY_MOVED_MESSAGE = 'This school keeps its library in Facilities & Operations now, so the older library screens no longer record anything. Open Facilities, Library in the sidebar.';

type MovedReader = { facBookTitle: { count: (args: { where: { schoolId: string } }) => PromiseLike<number> } };

export async function libraryMoved(db: MovedReader, schoolId: string): Promise<boolean> {
  return (await db.facBookTitle.count({ where: { schoolId } })) > 0;
}
