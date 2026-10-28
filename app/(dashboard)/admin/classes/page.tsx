import { auth } from '@/lib/auth';
import { guardPage } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { AddClassModal } from '@/components/admin/AddClassModal';
import { ensureLevels, getOpenTerm } from '@/lib/academic/terms';
import type { SessionUser } from '@/types';

export default async function AdminClassesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  await guardPage(user, 'academics.classes.manage', '/accounting');

  const [openTerm, levels, school] = await Promise.all([
    getOpenTerm(user.schoolId, db),
    // Form 1–6 may be missing for a new school or after a data wipe. Only switched-on forms take classes.
    ensureLevels(user.schoolId, db).then((all) => all.filter((l) => l.active).map((l) => ({ id: l.id, name: l.name }))),
    db.school.findUnique({ where: { id: user.schoolId }, select: { maxClassSize: true } }),
  ]);
  const [classes, teachers] = await Promise.all([
    db.schoolClass.findMany({
      where: { schoolId: user.schoolId },
      include: {
        level: { select: { name: true } },
        classTeacher: { select: { id: true, fullName: true } },
        // Students in the class this term (from Enrollment).
        _count: { select: { enrollments: { where: { termId: openTerm?.id ?? '', status: 'ACTIVE' } } } },
      },
      orderBy: [{ level: { order: 'asc' } }, { stream: 'asc' }],
    }),
    db.user.findMany({
      where: { schoolId: user.schoolId, role: 'TEACHER', active: true },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">Classes</h1>
          <p className="mt-1 text-sm text-muted">School class register{openTerm ? ` — students in ${openTerm.name}` : ''}</p>
        </div>
        <AddClassModal teachers={teachers} levels={levels} defaultCapacity={school?.maxClassSize ?? 45} />
      </div>

      <div className="overflow-x-auto rounded-2xl bg-white">
        <table className="w-full text-left text-sm text-ink">
          <thead className="border-b border-line bg-white">
            <tr>
              {['Class Name', 'Level', 'Stream', 'Class Teacher', 'Students', 'Active'].map((h, i) => (
                <th key={i} className="px-4 py-3.5 text-xs font-medium text-subtle">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-white">
            {classes.map((c) => (
              <tr key={c.id} className="cursor-pointer hover:bg-rowhover">
                <td className="px-4 py-3 font-medium">
                  <Link href={`/admin/classes/${c.id}`} className="text-primary hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className="px-4 py-3">{c.level.name}</td>
                <td className="px-4 py-3">{c.stream || '—'}</td>
                <td className="px-4 py-3">{c.classTeacher?.fullName ?? '—'}</td>
                <td className={`px-4 py-3 tabular-nums ${c._count.enrollments > c.capacity ? 'font-semibold text-danger' : ''}`}>{c._count.enrollments} / {c.capacity}</td>
                <td className="px-4 py-3">
                  <Badge label={c.active ? 'Active' : 'Inactive'} variant={c.active ? 'success' : 'danger'} />
                </td>
              </tr>
            ))}
            {classes.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted">
                  No classes yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
