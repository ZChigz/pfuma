// Asks can() first; the service behind it checks the permission again and every tuck shop rule.
import { guarded, body } from '@/lib/finance/route';
import { cashUp, listCashUps } from '@/lib/facilities/tuckshop';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/tuckshop/cashup', ['facilities.tuckshop.cashup', 'facilities.tuckshop.sell'], async ({ user }) => listCashUps(user));
export const POST = guarded('POST /api/facilities/tuckshop/cashup', ['facilities.tuckshop.sell'], async ({ user, req }) => cashUp(user, await body(req)), 201);
