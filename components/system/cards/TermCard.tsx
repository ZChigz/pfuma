import { can, type AccessUser } from '@/lib/access-core';
import { termSummary, type SummaryTerm } from '@/lib/system/summary';
import { termLabel } from '@/lib/term-label';
import { formatDate } from '@/lib/utils';
import { SummaryCard, SummaryCardEmpty } from './SummaryCard';

// Part of Dashboard & System, which cannot be switched off.
export function TermCard({ user, term }: { user: AccessUser; term: SummaryTerm | null }) {
  if (!can(user, 'system.dashboard.view')) return null;
  if (!term) return <SummaryCardEmpty label="Current term" message="No term has been set up yet." />;
  const s = termSummary(term);
  const weeks = (n: number) => `${n} week${n === 1 ? '' : 's'}`;
  return (
    <SummaryCard label={term.status === 'OPEN' ? 'Current term' : 'Term shown'} value={termLabel(term.name)}>
      <p>{formatDate(term.startDate)} to {formatDate(term.endDate)}</p>
      <p>
        {s.state === 'running' && `${weeks(s.weeksRemaining)} remaining`}
        {s.state === 'upcoming' && `Starts in ${weeks(s.weeksUntilStart)}`}
        {s.state === 'ended' && 'Ended'}
        {term.status !== 'OPEN' && ` · ${term.status.toLowerCase()}`}
      </p>
    </SummaryCard>
  );
}
