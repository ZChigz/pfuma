// Asks can() first; the service behind it checks the permission again and every tuck shop rule.
import { guarded } from '@/lib/finance/route';
import { confirmCashUp } from '@/lib/facilities/tuckshop';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/tuckshop/cashup/[id]/confirm', ['facilities.tuckshop.cashup'], async ({ user, params }) => confirmCashUp(user, params.id!));
