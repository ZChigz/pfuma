// The fee-paying guardians of a learner and their children, so a family payment can be recorded for the whole family.
import { guarded } from '@/lib/finance/route';
import { getScopedDb } from '@/lib/scoped-db';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/accounts/[studentId]/payers', ['finance.payments.record', 'finance.accounts.view', 'finance.credit.transfer', 'finance.plans.manage'], async ({ user, params, query }) => {
  const db = getScopedDb(user.schoolId, user.id);
  return db.$tx(async (tx) => {
    const links = await tx.studentGuardian.findMany({ where: { studentId: params.studentId, isFeePayer: true, student: { schoolId: user.schoolId } }, select: { guardian: { select: { id: true, fullName: true } } } });
    const payers = [];
    for (const l of links) {
      const kids = await tx.studentGuardian.findMany({ where: { guardianId: l.guardian.id, student: { schoolId: user.schoolId, status: 'ACTIVE' } }, select: { student: { select: { fullName: true } } } });
      if (kids.length > 1 || query.get('all') === '1') payers.push({ guardianId: l.guardian.id, name: l.guardian.fullName, children: kids.map((k) => k.student.fullName) });
    }
    return { payers };
  });
});
