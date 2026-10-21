// One handler per report, shared by the API routes: JSON by default, a CSV file with ?format=csv (which needs the export permission).
import { ServiceError } from '@/lib/api';
import type { PermissionKey } from '@/lib/access-core';
import { csvResponse } from '@/lib/csv';
import { holds, todayInHarare } from '@/lib/finance/common';
import { guarded, q, readQuery, type RouteCtx } from '@/lib/finance/route';
import * as reports from '@/lib/finance/reports';
import * as exp from '@/lib/finance/exports';
import { listExpenses } from '@/lib/finance/expenses';
import { listPayments } from '@/lib/finance/payments';

const view: PermissionKey[] = ['finance.reports.view'];

function wantsCsv(c: RouteCtx): boolean {
  if (c.query.get('format') !== 'csv') return false;
  if (!holds(c.user, 'finance.reports.export')) throw new ServiceError('Forbidden', 403);
  return true;
}

const period = { from: q.iso, to: q.iso, fundId: q.id };
const monthStart = () => `${todayInHarare().slice(0, 8)}01`;

export const overviewRoute = guarded('GET /api/finance/reports/overview', [...view, 'finance.accounts.view', 'finance.payments.view', 'finance.payments.verify', 'finance.requests.approve', 'finance.requests.disburse'],
  async (c) => reports.overview(c.user, readQuery(c.query, { termId: q.id }).termId));

export const fundsRoute = guarded('GET /api/finance/reports/funds', view, async (c) => {
  const p = readQuery(c.query, period);
  const r = await reports.fundSummary(c.user, { from: p.from ?? monthStart(), to: p.to ?? todayInHarare(), fundId: p.fundId });
  return wantsCsv(c) ? csvResponse(`funds-${r.from}-${r.to}.csv`, exp.fundsCsv(r.rows)) : r;
});

export const cashUpRoute = guarded('GET /api/finance/reports/cash-up', view, async (c) => {
  const p = readQuery(c.query, period);
  const r = await reports.cashUp(c.user, { from: p.from, to: p.to, fundId: p.fundId });
  return wantsCsv(c) ? csvResponse(`cash-up-${r.from}-${r.to}.csv`, exp.cashUpCsv(r)) : r;
});

export const arrearsRoute = guarded('GET /api/finance/reports/arrears', [...view, 'finance.accounts.view'], async (c) => {
  const p = readQuery(c.query, { termId: q.id, classId: q.id, levelId: q.id, fundId: q.id, currency: q.currency });
  const r = await reports.arrears(c.user, p);
  return wantsCsv(c) ? csvResponse(`arrears-${r.term.name}.csv`, exp.arrearsCsv(r.rows)) : r;
});

export const expenditureRoute = guarded('GET /api/finance/reports/expenditure', [...view, 'finance.expenses.view'], async (c) => {
  const p = readQuery(c.query, period);
  const r = await reports.expenditure(c.user, { from: p.from ?? monthStart(), to: p.to ?? todayInHarare(), fundId: p.fundId });
  if (!wantsCsv(c)) return r;
  const all = await listExpenses(c.user, { from: r.from, to: r.to, fundId: p.fundId, pageSize: 5000, includeVoided: true });
  if (all.total > all.rows.length) throw new ServiceError('Too many rows for one file. Choose a shorter period.', 422);
  return csvResponse(`expenses-${r.from}-${r.to}.csv`, exp.expensesCsv(all.rows));
});

export const paymentsExportRoute = guarded('GET /api/finance/reports/payments', [...view, 'finance.payments.view'], async (c) => {
  const p = readQuery(c.query, { ...period, currency: q.currency });
  if (!wantsCsv(c)) throw new ServiceError('Add ?format=csv', 422);
  const from = p.from ?? monthStart();
  const to = p.to ?? todayInHarare();
  const out = await listPayments(c.user, { from, to, fundId: p.fundId, currency: p.currency, pageSize: 5000 });
  if (out.total > out.rows.length) throw new ServiceError('Too many rows for one file. Choose a shorter period.', 422);
  return csvResponse(`payments-${from}-${to}.csv`, exp.paymentsCsv(out.rows));
});
