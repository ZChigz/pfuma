// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded } from '@/lib/finance/route';
import * as leave from '@/lib/hr/leave';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/hr/leave/balances', ["hr.self.leave","hr.leave.view_all"], async ({ user, query }) => leave.getBalances(user, query.get("employeeId") || undefined, query.get("year") ? Number(query.get("year")) : undefined));
