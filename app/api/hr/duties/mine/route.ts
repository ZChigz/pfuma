// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded } from '@/lib/finance/route';
import * as duties from '@/lib/hr/duties';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/hr/duties/mine', ["hr.self.details"], async ({ user, query }) => duties.myDuties(user, query.get("from") || undefined));
