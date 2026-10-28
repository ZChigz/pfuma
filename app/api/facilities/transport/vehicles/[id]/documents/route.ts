// Asks can() first; the service behind it checks the permission again and every transport rule.
import { guarded, body } from '@/lib/finance/route';
import { addVehicleDoc } from '@/lib/facilities/transport';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/transport/vehicles/[id]/documents', ['facilities.transport.manage'], async ({ user, params, req }) => addVehicleDoc(user, params.id!, await body(req)), 201);
