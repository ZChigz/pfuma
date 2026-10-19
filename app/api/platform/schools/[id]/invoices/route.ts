import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { createInvoice } from '@/lib/platform/invoices';
import { requirePlatformAdmin } from '@/lib/platform/session';
import { CreateInvoiceSchema } from '@/lib/validations/platform';

async function _POST(req: Request, ctx: { params: { id: string } }) {
  const admin = await requirePlatformAdmin(req);
  const parsed = await parseBody(req, CreateInvoiceSchema);
  if ('error' in parsed) return parsed.error;
  const invoice = await createInvoice(admin, ctx.params.id, parsed.data);
  return apiSuccess({ invoice: { id: invoice.id, number: invoice.number } }, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/platform/schools/[id]/invoices', _POST as H);
