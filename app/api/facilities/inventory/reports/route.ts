// Asks can() first; the service behind it checks the permission again and every stock rule.
import { guarded } from '@/lib/finance/route';
import { inventoryReports } from '@/lib/facilities/inventory';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/inventory/reports', ['facilities.inventory.view', 'facilities.inventory.manage', 'facilities.inventory.receive', 'facilities.inventory.issue', 'facilities.inventory.count', 'facilities.inventory.writeoff'], async ({ user, query }) => inventoryReports(user, { from: query.get('from') || undefined, to: query.get('to') || undefined }));
