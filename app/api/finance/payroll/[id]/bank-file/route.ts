// A CSV the bank's bulk-payment upload accepts: employee, account, currency, amount, method, narrative. Unpaid lines only.
import { guarded } from '@/lib/finance/route';
import { csvResponse } from '@/lib/csv';
import { payrollBulkFile } from '@/lib/finance/payroll';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/payroll/[id]/bank-file', 'finance.payroll.pay', async ({ user, params }) => {
  const csv = await payrollBulkFile(user, params.id);
  return csvResponse(`payroll-${params.id}.csv`, csv);
});
