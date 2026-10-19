import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { actionLabel } from '@/lib/system/audit-labels';
import { EXIT_REASON_LABEL } from '@/lib/students/rules';
import type { ActivityEntry, ProfileEnrolment, ProfileOverview } from '@/lib/students/profile';
import { formatDay, formatWhen } from '@/lib/students/format';
import { Facts, Section, StatusBadge } from '@/components/students/shared';

const ENTRY: Record<string, string> = { NEW_FORM_1: 'New Form 1', NEW_LOWER_6: 'New Lower 6', TRANSFER_IN: 'Transfer in', RETURNING: 'Returning' };
const ORPHAN: Record<string, string> = { NONE: '', SINGLE: 'Single orphan', DOUBLE: 'Double orphan' };

export function OverviewTab({ o }: { o: ProfileOverview }) {
  const results = o.entryResults as { grade7Units?: number; oLevelPasses?: number; oLevelPoints?: number } | null;
  return (
    <div className="flex flex-col gap-4">
      <Section title="Personal details">
        <Facts rows={[
          ['First name(s)', o.firstName], ['Surname', o.surname], ['Gender', o.gender === 'M' ? 'Male' : o.gender === 'F' ? 'Female' : null],
          ['Date of birth', o.dateOfBirth ? `${formatDay(o.dateOfBirth)}${o.age !== null ? ` (${o.age} years)` : ''}` : null],
          ['Birth certificate no.', o.birthCertificateNumber ?? (o.hasBirthCertificate ? 'On file (you may not see the number)' : null)],
          ['Nationality', o.nationality], ['Home language', o.homeLanguage], ['Religion', o.religion],
        ]} />
      </Section>
      <Section title="Contact">
        <Facts rows={[['Address', o.address], ['Primary guardian', o.primaryGuardian ? `${o.primaryGuardian.fullName}, ${o.primaryGuardian.phone}` : null]]} />
      </Section>
      <Section title="Admission and previous school">
        <Facts rows={[
          ['Admitted', formatDay(o.admissionDate)], ['Entry', o.entryType ? ENTRY[o.entryType] : null], ['Previous school', o.previousSchool],
          ['Grade 7 units', results?.grade7Units ?? null], ['O Level passes', results?.oLevelPasses ?? null], ['O Level points', results?.oLevelPoints ?? null],
        ]} />
      </Section>
      <Section title="Support">
        <Facts rows={[
          ['BEAM beneficiary', o.isBeam ? 'Yes' : null], ['Sponsor', o.sponsorName], ['Orphan status', ORPHAN[o.orphanStatus] || null],
          ['Special educational needs', o.specialNeeds ? `Yes${o.specialNeedsNote ? `: ${o.specialNeedsNote}` : ''}` : null],
        ]} />
      </Section>
      <Section title="Siblings at the school">
        {o.siblings.length === 0 ? <p className="text-sm text-muted">No siblings at the school.</p> : (
          <ul className="flex flex-col divide-y divide-line">
            {o.siblings.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 py-2.5">
                <Link href={`/students/${s.id}`} className="font-medium text-primary hover:underline">{s.fullName}</Link>
                <span className="flex items-center gap-2 text-sm text-muted">{s.className ?? 'No class'}<StatusBadge status={s.status} /></span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

export function EnrolmentTab({ e }: { e: ProfileEnrolment }) {
  return (
    <div className="flex flex-col gap-4">
      <Section title="Admission">
        <Facts rows={[['Admission number', e.admission.admissionNumber], ['Admitted', formatDay(e.admission.admissionDate)], ['Entry', e.admission.entryType ? ENTRY[e.admission.entryType] : null], ['Previous school', e.admission.previousSchool]]} />
      </Section>
      <Section title="Class history by term">
        {e.history.length === 0 ? <p className="text-sm text-muted">No terms yet.</p> : (
          <ul className="flex flex-col divide-y divide-line">
            {e.history.map((h) => (
              <li key={h.termId} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <span className="font-medium text-ink">{h.term}</span>
                <span>{h.className}</span>
                <span className="text-muted">{formatDay(h.startDate)}{h.endDate ? ` to ${formatDay(h.endDate)}` : ''}</span>
                <Badge variant={h.status === 'ACTIVE' ? 'success' : h.status === 'PROMOTED' ? 'info' : 'neutral'} label={h.status.toLowerCase().replace(/_/g, ' ')} />
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Class moves">
        {e.moves.length === 0 ? <p className="text-sm text-muted">No class moves.</p> : (
          <ul className="flex flex-col divide-y divide-line">
            {e.moves.map((m) => (
              <li key={m.id} className="py-2.5 text-sm">
                <p className="font-medium text-ink">{m.from ?? '—'} → {m.to} <Badge variant={m.status === 'APPROVED' ? 'success' : m.status === 'PENDING' ? 'warning' : 'danger'} label={m.status.toLowerCase()} /></p>
                <p className="text-muted">{formatDay(m.effectiveDate)} · {m.reason}{m.reasonNote ? ` (${m.reasonNote})` : ''} · asked by {m.requestedBy}{m.approvedBy ? `, decided by ${m.approvedBy}` : ''}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

export function ActivityTab({ total, entries }: { total: number; entries: ActivityEntry[] }) {
  return (
    <Section title={`Activity (${total})`}>
      {entries.length === 0 ? <p className="text-sm text-muted">Nothing recorded yet.</p> : (
        <ul className="flex flex-col divide-y divide-line">
          {entries.map((a) => (
            <li key={a.id} className="py-2.5 text-sm">
              <p className="font-medium text-ink">{actionLabel(a.action)}{a.detail ? <span className="font-normal text-muted"> · {a.detail}</span> : null}</p>
              <p className="text-xs text-muted">{formatWhen(a.at)} · {a.actor}</p>
            </li>
          ))}
        </ul>
      )}
      {total > entries.length && <p className="mt-3 text-xs text-muted">Showing the latest {entries.length} of {total}. The full history is in the audit log.</p>}
    </Section>
  );
}

export { EXIT_REASON_LABEL };
