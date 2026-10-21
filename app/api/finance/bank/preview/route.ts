// The first rows of an uploaded statement, so the bursar can say which column is the date, the amount and the reference.
import { guarded } from '@/lib/finance/route';
import { ServiceError } from '@/lib/api';
import * as bank from '@/lib/finance/bank';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/finance/bank/preview', 'finance.bank.reconcile', async ({ req }) => {
  const file = (await req.formData()).get('file');
  if (!(file instanceof File)) throw new ServiceError('Choose the statement file', 422);
  if (file.size > 5 * 1024 * 1024) throw new ServiceError('The file is larger than 5 MB', 422);
  const rows = await bank.readTable({ name: file.name, data: Buffer.from(await file.arrayBuffer()) });
  return { rows: rows.slice(0, 12), total: rows.length };
});
