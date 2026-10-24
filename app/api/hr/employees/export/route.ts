// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded } from '@/lib/finance/route';
import * as emp from '@/lib/hr/employees';
import { csvOut } from '@/lib/hr/route';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/hr/employees/export', ["hr.directory.view","hr.employees.view"], async ({ user, query }) => csvOut(await emp.exportDirectory(user, Object.fromEntries(query))));
