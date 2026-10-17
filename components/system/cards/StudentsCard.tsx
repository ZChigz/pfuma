import { can, type AccessUser } from '@/lib/access-core';
import { getScopedDb } from '@/lib/scoped-db';
import { loadStudentSummary, type SummaryTerm } from '@/lib/system/summary';
import { SummaryCard, SummaryCardEmpty } from './SummaryCard';

const NO_TERM = { label: 'Set up the academic calendar', href: '/admin/academic' };

// Shown only when the Student Information module is on and the viewer may see students.
export async function StudentsCard({ user, term }: { user: AccessUser; term: SummaryTerm | null }) {
  if (!can(user, 'students.list.view')) return null;
  if (!term) return <SummaryCardEmpty label="Students" message="No term yet, so nothing to count." action={NO_TERM} />;
  const s = await loadStudentSummary(getScopedDb(user.schoolId, user.id), user.schoolId, term);
  if (s.total === 0) {
    return (
      <SummaryCardEmpty
        label="Students"
        message="No students in this term yet."
        action={can(user, 'students.profiles.import') ? { label: 'Import students', href: '/students/import' } : undefined}
      />
    );
  }
  return (
    <SummaryCard label="Students" value={s.total}>
      <p>{s.boys} boys &middot; {s.girls} girls{s.unrecorded > 0 ? ` · ${s.unrecorded} not recorded` : ''}</p>
      <p>Active in the term shown</p>
    </SummaryCard>
  );
}
