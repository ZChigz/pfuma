// Asks can() first; the service behind it checks the permission again and every exeats rule.
import { guarded, body } from '@/lib/finance/route';
import { listVisitors, logVisitor } from '@/lib/facilities/exeats';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/exeats/visitors', ['facilities.visitors.log', 'facilities.exeats.request'], async ({ user, query }) => listVisitors(user, query.get('date') || undefined));
export const POST = guarded('POST /api/facilities/exeats/visitors', ['facilities.visitors.log'], async ({ user, req }) => logVisitor(user, await body(req)), 201);
