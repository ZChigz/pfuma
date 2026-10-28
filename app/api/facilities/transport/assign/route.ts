// Asks can() first; the service behind it checks the permission again and every transport rule.
import { guarded, body } from '@/lib/finance/route';
import { assignLearner, removeLearner } from '@/lib/facilities/transport';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/transport/assign', ['facilities.transport.assign'], async ({ user, req }) => assignLearner(user, await body(req)), 201);
export const DELETE = guarded('DELETE /api/facilities/transport/assign', ['facilities.transport.assign'], async ({ user, req }) => removeLearner(user, await body(req)));
