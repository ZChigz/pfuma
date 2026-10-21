// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as setup from '@/lib/finance/setup';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/controls', ['finance.settings.manage', 'finance.funds.manage', 'finance.reports.view', 'finance.payments.record', 'finance.payments.verify'], async ({ user }) => setup.getControls(user));
export const PUT = guarded('PUT /api/finance/controls', 'finance.settings.manage', async ({ user, req }) => setup.saveControls(user, await body(req)));
