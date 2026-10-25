// Asks can() first; the service behind it checks the permission again and every stock rule.
import { guarded } from '@/lib/finance/route';
import { findItemByScan } from '@/lib/facilities/inventory';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/inventory/scan', ['facilities.inventory.view', 'facilities.inventory.manage', 'facilities.inventory.receive', 'facilities.inventory.issue', 'facilities.inventory.count', 'facilities.inventory.writeoff'], async ({ user, query }) => findItemByScan(user, query.get('code') ?? ''));
