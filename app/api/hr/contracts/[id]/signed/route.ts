// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded, body } from '@/lib/finance/route';
import * as rec from '@/lib/hr/recruitment';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/hr/contracts/[id]/signed', ["hr.contracts.manage"], async ({ user, req, params }) => rec.attachSignedContract(user, params.id!, await body(req)));
