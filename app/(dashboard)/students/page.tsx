import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { listStudents, parseStudentListQuery } from '@/lib/students/list';
import { syncSuspensions } from '@/lib/students/discipline';
import { studentAccess } from '@/lib/students/rules';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { ExportListButton } from '@/components/students/ExportButton';
import { StudentsListClient } from '@/components/students/StudentsListClient';

export const metadata = { title: 'Students · Pfuma' };

const button = 'inline-flex min-h-[44px] items-center justify-center rounded-full px-5 text-sm font-semibold';

export default async function StudentsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { user, can } = await getAccess();
  if (!can('students.profiles.view')) return <AccessDenied />;
  const access = studentAccess(user);
  const db = getScopedDb(user.schoolId, user.id);

  // Suspensions start and end by themselves; the daily schedule does it, and so does opening this page.
  if (!user.readOnly) { try { await syncSuspensions(user.schoolId, user.id); } catch { /* the schedule will do it */ } }

  const query = parseStudentListQuery(searchParams);
  const [result, classes, levels, houses, range] = await Promise.all([
    listStudents(user, query),
    db.schoolClass.findMany({ where: { active: true, level: { active: true } }, orderBy: [{ level: { order: 'asc' } }, { stream: 'asc' }], select: { id: true, name: true, stream: true, level: { select: { order: true } } } }),
    db.level.findMany({ where: { active: true }, orderBy: { order: 'asc' }, select: { order: true, name: true } }),
    db.house.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    db.student.aggregate({ _min: { admissionDate: true }, _max: { admissionDate: true } }),
  ]);
  const first = range._min.admissionDate?.getUTCFullYear();
  const last = range._max.admissionDate?.getUTCFullYear();
  const years = first && last ? Array.from({ length: last - first + 1 }, (_, i) => last - i) : [];

  return (
    <div className="flex flex-col gap-4 pb-6">
      <PageHeader
        title="Students"
        description="Find any student in two seconds: search, filter, and open the profile."
        breadcrumbs={[{ label: 'Student Information' }, { label: 'Students' }]}
        actions={
          <>
            {access.create && <Link href="/students/new" className={`${button} bg-primary text-white hover:bg-primary-hover`}>Add student</Link>}
            {access.import && <Link href="/students/import" className={`${button} border border-primary bg-white text-primary hover:bg-tint`}>Import students</Link>}
            {access.export && <ExportListButton />}
          </>
        }
      />
      <StudentsListClient
        rows={result.rows}
        counts={result.counts}
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        termName={result.term?.name ?? null}
        searchTooShort={result.searchTooShort}
        classes={classes.map((c) => ({ id: c.id, name: c.name, stream: c.stream, levelOrder: c.level.order }))}
        forms={levels}
        streams={Array.from(new Set(classes.map((c) => c.stream).filter(Boolean)))}
        houses={houses}
        admissionYears={years}
        flags={{
          create: access.create, import: access.import, export: access.export, edit: access.edit, moveClass: access.manageEnrolment, recordIncident: access.recordIncident,
          startLeaving: access.startLeaving, guardians: access.guardians, print: access.profile,
        }}
      />
    </div>
  );
}
