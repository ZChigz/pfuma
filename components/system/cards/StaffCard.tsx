import { can, type AccessUser } from '@/lib/access-core';
import { getScopedDb } from '@/lib/scoped-db';
import { loadStaffSummary } from '@/lib/system/summary';
import { SummaryCard } from './SummaryCard';

// Shown only when the HR & Staff module is on.
export async function StaffCard({ user }: { user: AccessUser }) {
  if (!can(user, 'hr.staff.view')) return null;
  const s = await loadStaffSummary(getScopedDb(user.schoolId, user.id), user.schoolId);
  return (
    <SummaryCard label="Staff" value={s.active} href={can(user, 'system.users.view') ? '/admin/users' : undefined}>
      <p>{s.loggedInThisWeek} logged in this week</p>
      <p>Active accounts</p>
    </SummaryCard>
  );
}
