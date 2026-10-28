// Asks can() first; the service behind it checks the permission again and every transport rule.
import { guarded, body } from '@/lib/finance/route';
import { saveVehicle } from '@/lib/facilities/transport';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/transport/vehicles', ['facilities.transport.manage'], async ({ user, req }) => saveVehicle(user, await body(req)), 201);
