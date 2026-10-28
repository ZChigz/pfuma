// Asks can() first; the service behind it checks the permission again and every transport rule.
import { guarded, body } from '@/lib/finance/route';
import { addDriverDoc } from '@/lib/facilities/transport';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/transport/drivers/[id]/documents', ['facilities.transport.manage'], async ({ user, params, req }) => addDriverDoc(user, params.id!, await body(req)), 201);
