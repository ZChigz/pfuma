// Asks can() first; the service behind it checks the permission again and every exeats rule.
import { guarded, body } from '@/lib/finance/route';
import { listExeats, requestExeat } from '@/lib/facilities/exeats';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/exeats', ['facilities.exeats.request', 'facilities.exeats.approve', 'facilities.exeats.signout'], async ({ user, query }) => listExeats(user, { status: query.get('status') || undefined, studentId: query.get('studentId') || undefined, scope: (query.get('scope') as 'open' | 'today' | 'all' | null) || undefined }));
export const POST = guarded('POST /api/facilities/exeats', ['facilities.exeats.request'], async ({ user, req }) => requestExeat(user, await body(req)), 201);
