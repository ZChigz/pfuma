import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { markInvoicePaid } from '@/lib/platform/invoices';
import { requirePlatformAdmin } from '@/lib/platform/session';
import { MarkPaidSchema } from '@/lib/validations/platform';

async function _POST(req: Request, ctx: { params: { id: string } }) {
  const admin = await requirePlatformAdmin(req);
  const raw = await req.clone().text();
  const parsed = raw ? await parseBody(req, MarkPaidSchema) : { data: {} as { paidOn?: string } };
  if ('error' in parsed) return parsed.error;
  const invoice = await markInvoicePaid(admin, ctx.params.id, parsed.data.paidOn);
  return apiSuccess({ invoice: { id: invoice.id, status: invoice.status } });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/platform/invoices/[id]/pay', _POST as H);
