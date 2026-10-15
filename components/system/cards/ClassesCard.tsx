import { can, type AccessUser } from '@/lib/access-core';
import { getScopedDb } from '@/lib/scoped-db';
import { loadClassSummary, type SummaryTerm } from '@/lib/system/summary';
import { SummaryCard, SummaryCardEmpty } from './SummaryCard';

// Shown only when the Academics module is on.
export async function ClassesCard({ user, term }: { user: AccessUser; term: SummaryTerm | null }) {
  if (!can(user, 'academics.classes.view')) return null;
  if (!term) return <SummaryCardEmpty label="Classes" message="No term to count students in." />;
  const c = await loadClassSummary(getScopedDb(user.schoolId, user.id), user.schoolId, term);
  return (
    <SummaryCard label="Classes" value={c.classes}>
      <p>Average class size {c.averageSize}</p>
      <p className={c.overCapacity > 0 ? 'font-medium text-warn' : undefined}>
        {c.overCapacity === 0 ? 'None over capacity' : `${c.overCapacity} over capacity`}
      </p>
    </SummaryCard>
  );
}
