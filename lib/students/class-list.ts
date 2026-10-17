// Printed class lists and printed student profiles. Both are audited (PRINT_STUDENT), and both show only what the person
// may see: a class list only the students they can reach, a profile only the sections their permissions allow.
import { ServiceError } from '@/lib/api';
import type { AccessUser } from '@/lib/access-core';
import { logAudit } from '@/lib/audit';
import { getScopedDb } from '@/lib/scoped-db';
import { loadLetterhead, type SchoolLetterhead } from '@/lib/students/documents';
import { profileEnrolment, profileGuardians, profileHeader, profileOverview, type ProfileEnrolment, type ProfileGuardian, type ProfileHeader, type ProfileOverview } from '@/lib/students/profile';
import { classListSections } from '@/lib/students/rules';
import { studentAccess } from '@/lib/students/rules';
import { studentScope } from '@/lib/students/scope';

export interface ClassListPage {
  className: string;
  classTeacher: string | null;
  termName: string;
  sections: { title: string | null; students: { n: number; admissionNumber: string; fullName: string }[] }[];
  total: number;
  boys: number;
  girls: number;
}

export interface ClassListData { school: SchoolLetterhead; printedOn: string; pages: ClassListPage[] }

/**
 * One page per class: the school header, the class teacher, and numbered names in alphabetical order by surname, with boys
 * and girls listed separately or together. Students who have left (from the day after their last day) are not on it.
 */
export async function classLists(user: AccessUser, classIds: string[], opts: { termId?: string; separate: boolean }): Promise<ClassListData> {
  const ids = Array.from(new Set(classIds));
  if (ids.length === 0) throw new ServiceError('Choose at least one class', 422);
  if (ids.length > 60) throw new ServiceError('Choose 60 classes or fewer at a time', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = opts.termId
      ? await tx.academicTerm.findFirst({ where: { id: opts.termId, schoolId: user.schoolId } })
      : await tx.academicTerm.findFirst({ where: { schoolId: user.schoolId, status: 'OPEN' } });
    if (!term) throw new ServiceError(opts.termId ? 'Term not found' : 'No term is open', opts.termId ? 404 : 409);
    const classes = await tx.schoolClass.findMany({ where: { id: { in: ids }, schoolId: user.schoolId }, include: { classTeacher: { select: { fullName: true } } } });
    if (classes.length !== ids.length) throw new ServiceError('Class not found', 404);
    classes.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    const enrollments = await tx.enrollment.findMany({
      where: {
        termId: term.id, classId: { in: ids }, status: 'ACTIVE',
        student: { AND: [studentScope(user, term.status === 'OPEN' ? term.id : null), { status: { in: ['ACTIVE', 'SUSPENDED'] } }] },
      },
      select: { classId: true, student: { select: { admissionNumber: true, firstName: true, surname: true, fullName: true, gender: true } } },
    });
    const pages: ClassListPage[] = classes.map((c) => {
      const students = enrollments.filter((e) => e.classId === c.id).map((e) => ({ ...e.student }));
      let n = 0;
      const sections = classListSections(students, opts.separate).map((s) => {
        n = 0; // boys and girls are each numbered from 1; a single list runs 1 to the end
        return { title: s.title, students: s.students.map((x) => ({ n: ++n, admissionNumber: x.admissionNumber, fullName: `${x.surname.toUpperCase()}, ${x.firstName}` })) };
      });
      return {
        className: c.name, classTeacher: c.classTeacher?.fullName ?? null, termName: term.name, sections, total: students.length,
        boys: students.filter((s) => s.gender === 'M').length, girls: students.filter((s) => s.gender === 'F').length,
      };
    });
    await logAudit(
      {
        schoolId: user.schoolId, actorId: user.id, action: 'PRINT_STUDENT', entityType: 'SchoolClass', entityId: ids[0]!,
        detail: `Class list printed: ${pages.map((p) => `${p.className} (${p.total})`).join(', ')}`, after: { classes: ids, students: pages.reduce((s, p) => s + p.total, 0), separate: opts.separate },
      },
      tx,
    );
    return { school: await loadLetterhead(tx, user.schoolId), printedOn: new Date().toISOString().slice(0, 10), pages };
  });
}

export interface ProfilePrintData {
  school: SchoolLetterhead;
  printedOn: string;
  header: ProfileHeader;
  overview: ProfileOverview;
  guardians: ProfileGuardian[] | null;
  enrolment: ProfileEnrolment | null;
}

/** The A4 profile for files and transfers: Overview, Guardians and Enrolment, each only if the person may see it. */
export async function profileForPrint(user: AccessUser, studentId: string): Promise<ProfilePrintData> {
  const access = studentAccess(user);
  const header = await profileHeader(user, studentId);
  const [overview, guardians, enrolment, school] = await Promise.all([
    profileOverview(user, studentId),
    access.guardians ? profileGuardians(user, studentId) : Promise.resolve(null),
    access.enrolment ? profileEnrolment(user, studentId) : Promise.resolve(null),
    getScopedDb(user.schoolId, user.id).$tx((tx) => loadLetterhead(tx, user.schoolId)),
  ]);
  await getScopedDb(user.schoolId, user.id).$tx((tx) =>
    logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'PRINT_STUDENT', entityType: 'Student', entityId: studentId, detail: `${header.fullName}: profile printed`, after: { sections: ['overview', guardians ? 'guardians' : null, enrolment ? 'enrolment' : null].filter(Boolean) } }, tx),
  );
  return { school, printedOn: new Date().toISOString().slice(0, 10), header, overview, guardians, enrolment };
}
