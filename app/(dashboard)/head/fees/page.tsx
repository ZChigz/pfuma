import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { formatUSD, formatZiG } from '@/lib/utils';
import { BulkFeeModal } from '@/components/accounting/BulkFeeModal';
import { FeeStructureModal } from '@/components/accounting/FeeStructureModal';
import type { SessionUser } from '@/types';

export default async function HeadFeesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  if (user.role !== 'HEAD') redirect('/');

  const [feeStructures, classes] = await Promise.all([
    prisma.feeStructure.findMany({
      where: { schoolId: user.schoolId },
      orderBy: [{ grade: 'asc' }, { term: 'desc' }, { label: 'asc' }],
    }),
    prisma.schoolClass.findMany({
      where: { schoolId: user.schoolId, active: true },
      select: { id: true, name: true, grade: true },
      orderBy: [{ grade: 'asc' }, { section: 'asc' }],
    }),
  ]);

  const feeStructureOptions = feeStructures.map((f) => ({
    id: f.id,
    label: f.label,
    grade: f.grade,
    term: f.term,
    currency: f.currency,
    amount: f.amount.toNumber(),
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#14301f]">Fee Management</h1>
          <p className="mt-0.5 text-sm text-[#6b7a70]">Apply fees in bulk and manage fee structures</p>
        </div>
        <BulkFeeModal feeStructures={feeStructureOptions} classes={classes} />
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-semibold   text-[#6b7a70]">Fee Structures</p>
          <FeeStructureModal />
        </div>

        {feeStructures.length === 0 ? (
          <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-[#6b7a70]">
            No fee structures defined yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-[#e3e9e4]">
            <table className="w-full text-left text-sm text-[#14301f]">
              <thead className="border-b border-[#e3e9e4] bg-[#f4f6f4]">
                <tr>
                  {['Grade', 'Term', 'Label', 'Amount', ''].map((h, i) => (
                    <th key={i} className="px-4 py-3 text-xs font-semibold   text-[#6b7a70]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e3e9e4] bg-white">
                {feeStructureOptions.map((f) => (
                  <tr key={f.id}>
                    <td className="px-4 py-3 font-medium">{f.grade}</td>
                    <td className="px-4 py-3 text-[#6b7a70]">{f.term}</td>
                    <td className="px-4 py-3">{f.label}</td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {f.currency === 'USD' ? formatUSD(f.amount) : formatZiG(f.amount)}
                    </td>
                    <td className="px-4 py-3">
                      <FeeStructureModal feeStructure={f} />
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
