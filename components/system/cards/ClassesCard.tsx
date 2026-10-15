import { can, type AccessUser } from '@/lib/access-core';
import { getScopedDb } from '@/lib/scoped-db';
import { loadClassSummary, type SummaryTerm } from '@/lib/system/summary';
import { SummaryCard, SummaryCardEmpty } from './SummaryCard';

// Shown only when the Academics module is on.
export async function ClassesCard({ user, term }: { user: AccessUser; term: SummaryTerm | null }) {
  if (!can(user, 'academics.classes.view')) return null;
  if (!term) {
    return <SummaryCardEmpty label="Classes" message="No term yet, so nothing to count." action={{ label: 'Set up the academic calendar', href: '/admin/academic' }} />;
  }
  const c = await loadClassSummary(getScopedDb(user.schoolId, user.id), user.schoolId, term);
  if (c.classes === 0) {
    return <SummaryCardEmpty label="Classes" message="No classes created yet." action={{ label: 'Create classes', href: '/admin/classes' }} />;
  }
  // Classes exist but nobody is enrolled: an average of 0 would look like a real figure.
  const empty = c.averageSize === 0;
  return (
    <SummaryCard label="Classes" value={c.classes}>
      <p>{empty ? 'No students enrolled in this term yet' : `Average class size ${c.averageSize}`}</p>
      {!empty && (
        <p className={c.overCapacity > 0 ? 'font-medium text-warn' : undefined}>
          {c.overCapacity === 0 ? 'None over capacity' : `${c.overCapacity} over capacity`}
        </p>
      )}
    </SummaryCard>
  );
}
