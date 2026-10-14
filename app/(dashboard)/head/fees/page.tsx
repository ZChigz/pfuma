import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { formatUSD, formatZiG } from '@/lib/utils';
import { listTerms } from '@/lib/academic/terms';
import { BulkFeeModal } from '@/components/accounting/BulkFeeModal';
import { FeeStructureModal } from '@/components/accounting/FeeStructureModal';
import type { SessionUser } from '@/types';

export default async function HeadFeesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  if (user.role !== 'HEAD') redirect('/');

  const [feeStructures, classes, levels, termRows] = await Promise.all([
    prisma.feeStructure.findMany({
      where: { schoolId: user.schoolId },
      include: { level: { select: { name: true, order: true } }, term: { select: { name: true } } },
      orderBy: [{ term: { startDate: 'desc' } }, { level: { order: 'asc' } }, { label: 'asc' }],
    }),
    prisma.schoolClass.findMany({
      where: { schoolId: user.schoolId, active: true },
      select: { id: true, name: true, levelId: true },
      orderBy: [{ level: { order: 'asc' } }, { stream: 'asc' }],
    }),
    prisma.level.findMany({ where: { schoolId: user.schoolId }, select: { id: true, name: true }, orderBy: { order: 'asc' } }),
    listTerms(user.schoolId),
  ]);
  const terms = termRows.map((t) => ({ id: t.id, name: t.name, status: t.status }));

  const feeStructureOptions = feeStructures.map((f) => ({
    id: f.id,
    label: f.label,
    levelId: f.levelId,
    levelName: f.level?.name ?? 'All levels',
    termId: f.termId,
    termName: f.term.name,
    currency: f.currency,
    amount: f.amount.toNumber(),
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">Fee Management</h1>
          <p className="mt-1 text-sm text-muted">Apply fees in bulk and manage fee structures</p>
        </div>
        <BulkFeeModal feeStructures={feeStructureOptions} classes={classes} levels={levels} terms={terms} />
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-medium text-muted">Fee Structures</p>
          <FeeStructureModal levels={levels} terms={terms} />
        </div>

        {feeStructures.length === 0 ? (
          <p className="rounded-2xl bg-white px-4 py-12 text-center text-sm text-muted">
            No fee structures defined yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl bg-white">
            <table className="w-full text-left text-sm text-ink">
              <thead className="border-b border-line bg-white">
                <tr>
                  {['Level', 'Term', 'Label', 'Amount', ''].map((h, i) => (
                    <th key={i} className="px-4 py-3.5 text-xs font-medium text-subtle">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-white">
                {feeStructureOptions.map((f) => (
                  <tr key={f.id}>
                    <td className="px-4 py-3 font-medium">{f.levelName}</td>
                    <td className="px-4 py-3 text-muted">{f.termName}</td>
                    <td className="px-4 py-3">{f.label}</td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {f.currency === 'USD' ? formatUSD(f.amount) : formatZiG(f.amount)}
                    </td>
                    <td className="px-4 py-3">
                      <FeeStructureModal feeStructure={f} levels={levels} terms={terms} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
