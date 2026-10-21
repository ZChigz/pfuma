// The approved fee schedule of a term as a one-page notice for parents.
import { guarded } from '@/lib/finance/route';
import { feeSchedule } from '@/lib/finance/structures';
import { formatMoney } from '@/lib/finance/money';
import { schoolHead } from '@/lib/finance/downloads';
import { pdfResponse } from '@/lib/students/pdf';
import { TableDocument } from '@/components/finance/pdf/Documents';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/schedule/pdf', ['finance.fees.view', 'finance.fees.manage', 'finance.fees.approve', 'finance.billing.run'], async ({ user, query }) => {
  const s = await feeSchedule(user, query.get('termId') || undefined);
  const doc = { title: `Fees for ${s.term}`, subtitle: `Fee structure version ${s.version}`, headers: ['Who pays', 'Fee', 'Fund', 'Currency', 'Amount'], rows: s.rows.map((r) => [r.group, r.item, r.fund, r.currency, formatMoney(r.amountCents, r.currency)]), align: ['left', 'left', 'left', 'left', 'right'] as ('left' | 'right')[] };
  return pdfResponse(TableDocument, { doc, head: await schoolHead(user) }, `fees-${s.term}.pdf`);
});
