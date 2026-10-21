// The termly claim for a sponsor (for BEAM, the list the school submits): PDF, Excel or CSV.
import { guarded } from '@/lib/finance/route';
import { sponsorClaim } from '@/lib/finance/sponsors';
import { formatMoney } from '@/lib/finance/money';
import { asFormat, tableResponse } from '@/lib/finance/downloads';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/sponsors/[id]/claim/export', ['finance.sponsors.manage', 'finance.reports.view'], async ({ user, params, query }) => {
  const c = await sponsorClaim(user, params.id, query.get('termId') || undefined);
  const doc = {
    title: `Claim to ${c.sponsor.name}: ${c.term.name}`, subtitle: `${c.school}. ${c.learners} learner(s).`,
    headers: ['Learner', 'Admission no.', 'Class', 'Fee item', 'Reference', 'Currency', 'Claimed', 'Paid'],
    rows: c.lines.map((l) => [l.name, l.admissionNumber, l.className ?? '', l.item, l.reference ?? '', l.currency, formatMoney(l.amountCents, l.currency), formatMoney(l.paidCents, l.currency)]),
    align: ['left', 'left', 'left', 'left', 'left', 'left', 'right', 'right'] as ('left' | 'right')[], landscape: true,
    totals: ['Total', '', '', '', '', '', (['USD', 'ZIG'] as const).filter((x) => c.totals[x]).map((x) => formatMoney(c.totals[x], x)).join(' + '), (['USD', 'ZIG'] as const).filter((x) => c.paid[x]).map((x) => formatMoney(c.paid[x], x)).join(' + ')],
  };
  return tableResponse(user, doc, asFormat(query.get('format') ?? 'pdf'), `claim-${c.sponsor.name}-${c.term.name}`.replace(/\s+/g, '-'));
});
