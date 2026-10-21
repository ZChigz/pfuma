// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as sponsors from '@/lib/finance/sponsors';

export const runtime = 'nodejs';

export const PATCH = guarded('PATCH /api/finance/sponsors/[id]', 'finance.sponsors.manage', async ({ user, req, params }) => sponsors.saveSponsor(user, params.id, await body(req)));
