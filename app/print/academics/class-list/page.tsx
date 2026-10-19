import { notFound } from 'next/navigation';
import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { ServiceError } from '@/lib/api';
import { classHeader, classStudents } from '@/lib/academics/classes';
import { getViewTerm } from '@/lib/system/view-term';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PrintBar } from '@/components/academics/PrintBar';

export const metadata = { title: 'Class list · Pfuma' };

// The class list on A4: numbered, by surname, from the enrolment of the term.
export default async function PrintClassList({ searchParams }: { searchParams: { classId?: string } }) {
  const { user, can } = await getAccess();
  if (!can('academics.classes.view')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const { term } = await getViewTerm(user.schoolId, db);
  if (!term || !searchParams.classId) notFound();
  try {
    const [header, list, school] = await Promise.all([
      classHeader(user, searchParams.classId, term.id),
      classStudents(user, searchParams.classId, term.id),
      db.school.findUniqueOrThrow({ where: { id: user.schoolId }, select: { name: true, motto: true } }),
    ]);
    return (
      <article className="mx-auto max-w-[190mm]">
        <PrintBar title={`${header.name} class list`} />
        <header className="mb-4 border-b border-ink pb-2">
          <p className="text-lg font-bold">{school.name}</p>
          <h1 className="text-xl font-bold">{header.name} — class list</h1>
          <p className="text-sm">{header.term.name} · Class teacher: {header.classTeacher ?? '—'} · {header.students} students ({header.boys} boys, {header.girls} girls)</p>
        </header>
        <table className="w-full border-collapse text-sm">
          <thead><tr className="border-b-2 border-ink text-left"><th className="w-10 py-1">No</th><th className="py-1">Name</th><th className="w-32 py-1">Admission no.</th><th className="w-16 py-1">Sex</th></tr></thead>
          <tbody>
            {list.students.map((s) => (
              <tr key={s.id} className="border-b border-line"><td className="py-1 tabular-nums">{s.n}</td><td className="py-1"><b className="uppercase">{s.surname}</b>, {s.firstName}</td><td className="py-1">{s.admissionNumber}</td><td className="py-1">{s.gender ?? ''}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="mt-4 text-xs text-muted">Printed {new Date().toISOString().slice(0, 10)} from Pfuma.</p>
      </article>
    );
  } catch (err) {
    if (err instanceof ServiceError && err.status === 404) notFound();
    throw err;
  }
}
