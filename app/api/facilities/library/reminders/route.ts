// Asks can() first; the service behind it checks the permission again and every library rule.
import { guarded } from '@/lib/finance/route';
import { sendOverdueReminders } from '@/lib/facilities/library';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/library/reminders', ['facilities.library.desk', 'facilities.library.manage'], async ({ user }) => sendOverdueReminders(user));
