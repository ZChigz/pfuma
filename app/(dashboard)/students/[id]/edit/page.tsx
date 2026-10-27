import { notFound } from 'next/navigation';
import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { formatBirthCert, studentAccess } from '@/lib/students/rules';
import { studentScope } from '@/lib/students/scope';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { EditStudentForm } from '@/components/students/EditStudentForm';

export const metadata = { title: 'Edit student · Pfuma' };

export default async function EditStudentPage({ params }: { params: { id: string } }) {
  const { user, can } = await getAccess();
  if (!can('students.profiles.edit')) return <AccessDenied />;
  const access = studentAccess(user);
  const db = getScopedDb(user.schoolId, user.id);
  const open = await db.academicTerm.findFirst({ where: { status: 'OPEN' }, select: { id: true } });
  const [s, houses] = await Promise.all([
    db.student.findFirst({ where: { AND: [await studentScope(user, open?.id, 'students.profiles.edit'), { id: params.id }] } }),
    db.house.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);
  if (!s) notFound();
  return (
    <div className="flex max-w-3xl flex-col gap-4 pb-8">
      <PageHeader title={`Edit ${s.fullName}`} breadcrumbs={[{ label: 'Students', href: '/students' }, { label: s.fullName, href: `/students/${s.id}` }, { label: 'Edit' }]} />
      <EditStudentForm
        houses={houses}
        s={{
          id: s.id, firstName: s.firstName, surname: s.surname, preferredName: s.preferredName ?? '', gender: (s.gender ?? 'M') as 'M' | 'F', dateOfBirth: s.dateOfBirth?.toISOString().slice(0, 10) ?? '',
          birthCertificateNumber: access.idNumbers && s.birthCertificateNumber ? formatBirthCert(s.birthCertificateNumber) : '', canSeeCert: access.idNumbers,
          nationality: s.nationality ?? '', homeLanguage: s.homeLanguage ?? '', religion: s.religion ?? '', photoUrl: s.photoUrl ?? '', previousSchool: s.previousSchool ?? '', address: s.address ?? '',
          boarding: s.boarding, houseId: s.houseId ?? '', isBeam: s.isBeam, sponsorName: s.sponsorName ?? '', orphanStatus: s.orphanStatus, specialNeeds: s.specialNeeds,
          specialNeedsNote: access.medical ? s.specialNeedsNote ?? '' : '', canSeeNote: access.medical,
        }}
      />
    </div>
  );
}
