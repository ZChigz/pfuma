// Class lists for a term come from Enrollment, never from Student.currentClassId,
// so past terms keep the class students were actually in.
import type { Prisma } from '@prisma/client';
import { getScopedDb, type Db } from '@/lib/scoped-db';


// Students in the class for the term. Students who left during the term keep
// their marks and results but drop off the roster.
export async function classRoster(classId: string, termId: string, db: Db) {
  const rows = await db.enrollment.findMany({
    where: { classId, termId, status: { in: ['ACTIVE', 'PROMOTED', 'REPEATED', 'GRADUATED'] } },
    select: { student: { select: { id: true, fullName: true, admissionNumber: true } } },
    orderBy: { student: { fullName: 'asc' } },
  });
  return rows.map((r) => r.student);
}

export async function classRosterIds(classId: string, termId: string, db: Db) {
  return (await classRoster(classId, termId, db)).map((s) => s.id);
}

// The class a student was in for a term (for report cards).
export async function enrollmentFor(studentId: string, termId: string, db: Db) {
  return db.enrollment.findUnique({
    where: { studentId_termId: { studentId, termId } },
    include: { class: { select: { id: true, name: true, level: { select: { name: true } } } } },
  });
}
