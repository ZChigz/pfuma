// Asks can() first; the service behind it checks the permission again and every hostel rule.
import { guarded, body } from '@/lib/finance/route';
import { listInspections, saveInspection } from '@/lib/facilities/hostel';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/hostel/inspections', ['facilities.hostel.inspect', 'facilities.hostel.manage', 'facilities.hostel.view'], async ({ user, query }) => listInspections(user, { hostelId: query.get('hostelId') || undefined }));
export const POST = guarded('POST /api/facilities/hostel/inspections', ['facilities.hostel.inspect'], async ({ user, req }) => saveInspection(user, await body(req)), 201);
