// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded } from '@/lib/finance/route';
import * as letters from '@/lib/hr/letters';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/hr/letters/[id]', ["hr.documents.manage","hr.employees.view","hr.discipline.view","hr.self.details","hr.self.leave","hr.self.payslips"], async ({ user, params }) => letters.getLetter(user, params.id!));
