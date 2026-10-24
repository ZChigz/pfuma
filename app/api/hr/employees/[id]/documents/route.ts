// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded, body } from '@/lib/finance/route';
import * as emp from '@/lib/hr/employees';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/hr/employees/[id]/documents', ["hr.documents.manage"], async ({ user, req, params }) => emp.saveDocument(user, params.id!, await body(req)), 201);
