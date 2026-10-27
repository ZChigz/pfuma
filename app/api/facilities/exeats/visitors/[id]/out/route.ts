// Asks can() first; the service behind it checks the permission again and every exeats rule.
import { guarded } from '@/lib/finance/route';
import { visitorOut } from '@/lib/facilities/exeats';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/exeats/visitors/[id]/out', ['facilities.visitors.log'], async ({ user, params }) => visitorOut(user, params.id!));
