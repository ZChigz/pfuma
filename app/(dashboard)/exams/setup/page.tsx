import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { getViewTerm } from '@/lib/system/view-term';
import { deputyIds, peopleWith } from '@/lib/academics/common';
import { getDeadlines, getExamSettings, listCommentBank, listPlans, listTypes, verifierSetup } from '@/lib/exams/setup';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { SetupClient } from '@/components/exams/SetupClient';

export const metadata = { title: 'Assessment setup · Pfuma' };

export default async function SetupPage() {
  const { user, can } = await getAccess();
  if (!can('exams.setup.manage') && !can('exams.reportcards.settings')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const { term } = await getViewTerm(user.schoolId, db);
  const header = <PageHeader title="Assessment setup" description="What counts towards the term mark and how much, the papers set for every class, the dates, and the report card settings." breadcrumbs={[{ label: 'Examinations', href: '/exams' }, { label: 'Setup' }]} />;
  if (!term) return <div className="flex flex-col gap-4">{header}<EmptyState title="No term yet" description="Set up an academic year and its terms in School Settings first." cta={{ label: 'School Settings', href: '/system/settings' }} /></div>;
  const [terms, levels, subjects, types, plans, deadlines, settings, verifiers, bank, eligible] = await Promise.all([
    db.academicTerm.findMany({ orderBy: { startDate: 'desc' }, select: { id: true, name: true, status: true } }),
    db.level.findMany({ where: { active: true }, orderBy: { order: 'asc' }, select: { id: true, name: true } }),
    db.subject.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    listTypes(user),
    listPlans(user, term.id),
    getDeadlines(user, term.id),
    getExamSettings(user),
    verifierSetup(user),
    listCommentBank(user),
    db.$tx(async (tx) => {
      const ids = Array.from(new Set([...(await peopleWith(tx, user.schoolId, 'exams.marks.verify')), ...(await deputyIds(tx, user.schoolId))]));
      return tx.user.findMany({ where: { id: { in: ids }, active: true }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } });
    }),
  ]);
  return (
    <div className="flex flex-col gap-4 pb-8">
      {header}
      <SetupClient
        termId={term.id} terms={terms} levels={levels} subjects={subjects} types={types} plans={plans} deadlines={deadlines} verifiers={verifiers} bank={bank} eligible={eligible}
        settings={{ ...settings, englishSubjectId: settings.englishSubjectId ?? '', mathsSubjectId: settings.mathsSubjectId ?? '' }}
        flags={{ setup: can('exams.setup.manage'), reportCards: can('exams.reportcards.settings') || can('exams.setup.manage') }}
      />
    </div>
  );
}
