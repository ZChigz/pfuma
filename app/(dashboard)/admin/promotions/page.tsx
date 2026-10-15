import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { redirect } from 'next/navigation';
import { canManageEnrollment } from '@/lib/permissions';
import { PromotionsClient } from '@/components/admin/PromotionsClient';
import type { SessionUser } from '@/types';

export default async function PromotionsPage({ searchParams }: { searchParams: { termId?: string } }) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);
  try { await canManageEnrollment(user.role); } catch { redirect('/'); }

  // Promotion happens from the last term (Term 3) of a year.
  const finalTerms = await db.academicTerm.findMany({
    where: { schoolId: user.schoolId, termNumber: 3, status: { in: ['OPEN', 'CLOSED'] } },
    include: { academicYear: { select: { year: true } } },
    orderBy: { startDate: 'desc' },
  });
  const source = finalTerms.find((t) => t.id === searchParams.termId) ?? finalTerms[0];

  const nextYearTerm1 = source
    ? await db.academicTerm.findFirst({
        where: { schoolId: user.schoolId, termNumber: 1, academicYear: { year: source.academicYear.year + 1 } },
      })
    : null;

  const enrollments = source
    ? await db.enrollment.findMany({
        where: { termId: source.id },
        include: {
          student: { select: { id: true, fullName: true, admissionNumber: true, status: true } },
          class: { select: { id: true, name: true, level: { select: { order: true, name: true } } } },
        },
        orderBy: [{ class: { level: { order: 'asc' } } }, { class: { stream: 'asc' } }, { student: { fullName: 'asc' } }],
      })
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">End-of-year promotions</h1>
        <p className="mt-1 text-sm text-muted">
          Decide, for every student in Term 3, whether they move up a level, repeat, graduate (Form 4 or Form 6) or leave.
          Term 1 of the next year cannot open until every student has a decision.
        </p>
      </div>

      {!source ? (
        <p className="rounded-2xl bg-white px-4 py-12 text-center text-sm text-muted">
          No Term 3 has been opened yet. Promotions become available once Term 3 is open.
        </p>
      ) : (
        <PromotionsClient
          sourceTerm={{ id: source.id, name: source.name }}
          sourceTerms={finalTerms.map((t) => ({ id: t.id, name: t.name }))}
          targetTermName={nextYearTerm1?.name ?? null}
          nextYear={source.academicYear.year + 1}
          rows={enrollments.map((e) => ({
            studentId: e.student.id,
            fullName: e.student.fullName,
            admissionNumber: e.student.admissionNumber,
            classId: e.class.id,
            className: e.class.name,
            levelOrder: e.class.level.order,
            decision: e.status,
            studentStatus: e.student.status,
          }))}
        />
      )}
    </div>
  );
}
