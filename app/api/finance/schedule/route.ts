// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded } from '@/lib/finance/route';
import * as structures from '@/lib/finance/structures';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/schedule', ['finance.fees.view', 'finance.fees.manage', 'finance.charges.create', 'finance.billing.run', 'finance.fees.approve', 'finance.statements.view'], async ({ user, query }) => structures.feeSchedule(user, query.get('termId') || undefined));
