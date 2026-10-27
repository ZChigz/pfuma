// Asks can() first; the service behind it checks the permission again and every sick bay rule.
import { guarded, body } from '@/lib/finance/route';
import { listVisits, recordVisit } from '@/lib/facilities/sickbay';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/sickbay', ['facilities.sickbay.record', 'facilities.sickbay.view'], async ({ user, query }) => listVisits(user, { studentId: query.get('studentId') || undefined, admittedOnly: query.get('admitted') === '1', days: query.get('days') ? Number(query.get('days')) : undefined }));
export const POST = guarded('POST /api/facilities/sickbay', ['facilities.sickbay.record'], async ({ user, req }) => recordVisit(user, await body(req)), 201);
