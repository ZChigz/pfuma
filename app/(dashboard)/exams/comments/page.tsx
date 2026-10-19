import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { getViewTerm } from '@/lib/system/view-term';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';

export const metadata = { title: 'Report card comments · Pfuma' };

export default async function CommentsIndexPage() {
  const { user, can } = await getAccess();
  if (!can('exams.comments.class') && !can('exams.comments.head')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const { term } = await getViewTerm(user.schoolId, db);
  const header = <PageHeader title="Report card comments" description="The class teacher's comment on each student, and the Head's remark." breadcrumbs={[{ label: 'Examinations', href: '/exams' }, { label: 'Comments' }]} />;
  if (!term) return <div className="flex flex-col gap-4">{header}<EmptyState title="No term yet" description="Set up an academic year and its terms in School Settings first." cta={{ label: 'School Settings', href: '/system/settings' }} /></div>;
  const wide = can('exams.comments.head');
  const classes = await db.schoolClass.findMany({
    where: { active: true, enrollments: { some: { termId: term.id, status: 'ACTIVE' } }, ...(wide ? {} : { classTeachers: { some: { termId: term.id, userId: user.id } } }) },
    select: { id: true, name: true, _count: { select: { enrollments: { where: { termId: term.id, status: 'ACTIVE' } } } } }, orderBy: [{ level: { order: 'asc' } }, { name: 'asc' }],
  });
  return (
    <div className="flex flex-col gap-4 pb-8">
      {header}
      {classes.length === 0 ? <EmptyState title="No classes" description={wide ? 'No class has students enrolled this term.' : 'You are not the class teacher of any class this term.'} /> : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {classes.map((c) => (
            <li key={c.id}><Link href={`/exams/comments/${c.id}`} className="block rounded-2xl bg-white p-4 hover:ring-2 hover:ring-primary/30"><h2 className="text-base font-semibold text-ink">{c.name}</h2><p className="text-sm text-muted">{c._count.enrollments} students · {term.name}</p></Link></li>
          ))}
        </ul>
      )}
    </div>
  );
}
