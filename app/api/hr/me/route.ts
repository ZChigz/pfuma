// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded } from '@/lib/finance/route';
import * as emp from '@/lib/hr/employees';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/hr/me', ["hr.self.details"], async ({ user }) => emp.getMyRecord(user));
