// Asks can() first; the service behind it checks the permission again and every tuck shop rule.
import { guarded, body } from '@/lib/finance/route';
import { sell, todaysSales } from '@/lib/facilities/tuckshop';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/tuckshop/sales', ['facilities.tuckshop.sell', 'facilities.tuckshop.cashup'], async ({ user, query }) => todaysSales(user, query.get('date') || undefined));
export const POST = guarded('POST /api/facilities/tuckshop/sales', ['facilities.tuckshop.sell'], async ({ user, req }) => sell(user, await body(req)), 201);
