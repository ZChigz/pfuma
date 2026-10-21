import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAccess } from '@/lib/access';
import { ServiceError } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { listDocuments } from '@/lib/students/documents';
import { studentDiscipline, syncSuspensions } from '@/lib/students/discipline';
import { openLeaving } from '@/lib/students/leavers';
import { viewMedical } from '@/lib/students/medical';
import { profileActivity, profileEnrolment, profileGuardians, profileHeader, profileOverview } from '@/lib/students/profile';
import { studentAccess, visibleStudentTabs } from '@/lib/students/rules';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { cn } from '@/lib/utils';
import { studentTabContent } from '@/components/students/tab-registry';
import '@/lib/finance/student-tab';
import { HeaderClient } from '@/components/students/profile/HeaderClient';
import { ActivityTab, EnrolmentTab, OverviewTab } from '@/components/students/profile/ReadTabs';
import { GuardiansTab } from '@/components/students/profile/GuardiansTab';
import { DocumentsTab } from '@/components/students/profile/DocumentsTab';
import { DisciplineTab } from '@/components/students/profile/DisciplineTab';
import { MedicalTab } from '@/components/students/profile/MedicalTab';
import { LeavingPanel } from '@/components/students/profile/LeavingPanel';

export const metadata = { title: 'Student · Pfuma' };

export default async function StudentProfilePage({ params, searchParams }: { params: { id: string }; searchParams: { tab?: string } }) {
  const { user, can } = await getAccess();
  if (!can('students.profiles.view')) return <AccessDenied />;
  const access = studentAccess(user);
  const tabs = visibleStudentTabs(user);
  const tab = tabs.find((t) => t.key === searchParams.tab)?.key ?? 'overview';
  const db = getScopedDb(user.schoolId, user.id);

  // A suspension that has ended returns the student to Active before the page is drawn.
  if (!user.readOnly) { try { await syncSuspensions(user.schoolId, user.id); } catch { /* the daily schedule will do it */ } }

  let header;
  try { header = await profileHeader(user, params.id); } catch (e) { if (e instanceof ServiceError && e.status === 404) notFound(); throw e; }
  const [classes, leaving] = await Promise.all([
    db.schoolClass.findMany({ where: { active: true, level: { active: true } }, orderBy: [{ level: { order: 'asc' } }, { stream: 'asc' }], select: { id: true, name: true } }),
    openLeaving(user, params.id),
  ]);
  const student = { id: header.id, fullName: header.fullName, className: header.className, admissionNumber: header.admissionNumber };

  let body: React.ReactNode;
  switch (tab) {
    case 'overview': body = <OverviewTab o={await profileOverview(user, params.id)} />; break;
    case 'guardians': body = <GuardiansTab studentId={params.id} guardians={await profileGuardians(user, params.id)} canEdit={access.editGuardians} canSeeIds={access.idNumbers} />; break;
    case 'enrolment': body = <EnrolmentTab e={await profileEnrolment(user, params.id)} />; break;
    case 'documents': { const d = await listDocuments(user, params.id); body = <DocumentsTab studentId={params.id} documents={d.documents} checklist={d.checklist} canUpload={access.uploadDocuments} canGenerate={access.generateDocuments} />; break; }
    case 'discipline': body = <DisciplineTab student={student} incidents={await studentDiscipline(user, params.id)} canRecord={access.recordIncident && header.actions.recordIncident} canApprove={access.approveDiscipline} canRecordMeeting={access.recordIncident} />; break;
    case 'medical': body = <MedicalTab studentId={params.id} m={await viewMedical(user, params.id)} canEdit={access.editMedical} />; break;
    case 'activity': { const a = await profileActivity(user, params.id); body = <ActivityTab total={a.total} entries={a.entries} />; break; }
    default: {
      const content = studentTabContent(tab);
      body = content ? await content({ studentId: params.id, user }) : <p className="rounded-2xl bg-white p-6 text-sm text-muted">This tab belongs to another module.</p>;
    }
  }

  return (
    <div className="flex flex-col gap-4 pb-8">
      <nav aria-label="Breadcrumb" className="text-xs text-muted"><Link href="/students" className="hover:underline">Students</Link> / <span aria-current="page">{header.fullName}</span></nav>
      <HeaderClient header={header} classes={classes} />
      {leaving && <LeavingPanel leaving={leaving as never} canManage={access.startLeaving} canApprove={access.approveLeaving} />}
      <nav aria-label="Student sections" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-1 border-b border-line">
          {tabs.map((t) => (
            <li key={t.key}>
              <Link href={`/students/${params.id}?tab=${t.key}`} aria-current={t.key === tab ? 'page' : undefined} scroll={false}
                className={cn('inline-flex min-h-[44px] items-center border-b-2 px-4 text-sm font-semibold', t.key === tab ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-ink')}>
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div>{body}</div>
    </div>
  );
}
