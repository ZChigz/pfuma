// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded, body } from '@/lib/finance/route';
import * as letters from '@/lib/hr/letters';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/hr/employees/[id]/letters', ["hr.documents.manage"], async ({ user, req, params }) => letters.generateLetter(user, params.id!, await body(req)), 201);
