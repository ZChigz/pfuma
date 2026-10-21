// Bank reconciliation: the bursar uploads a bank or EcoCash merchant statement (CSV or Excel) with the column mapping for that bank.
// This file is written by hand (the route generator must not overwrite it): the upload is multipart.
import { guarded } from '@/lib/finance/route';
import { ServiceError } from '@/lib/api';
import * as bank from '@/lib/finance/bank';

export const runtime = 'nodejs';

const MAX_BYTES = 5 * 1024 * 1024;

export const GET = guarded('GET /api/finance/bank/statements', 'finance.bank.reconcile', async ({ user }) => bank.listStatements(user));

export const POST = guarded('POST /api/finance/bank/statements', 'finance.bank.reconcile', async ({ user, req }) => {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new ServiceError('Choose the statement file', 422);
  if (file.size > MAX_BYTES) throw new ServiceError('The file is larger than 5 MB. Upload a shorter period.', 422);
  let mapping: unknown;
  try { mapping = JSON.parse(String(form.get('mapping') ?? '')); } catch { throw new ServiceError('The column mapping is not valid', 422); }
  const rows = await bank.readTable({ name: file.name, data: Buffer.from(await file.arrayBuffer()) });
  return bank.uploadStatement(user, {
    bank: String(form.get('bank') ?? ''), account: String(form.get('account') ?? ''), currency: String(form.get('currency') ?? '') as 'USD' | 'ZIG', mapping: mapping as never, fileName: file.name,
  }, rows);
}, 201);
