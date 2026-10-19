import { getAccess } from '@/lib/access';
import { getSettings } from '@/lib/academics/settings';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { AcademicsSettingsClient } from '@/components/academics/AcademicsSettingsClient';

export const metadata = { title: 'Academics settings · Pfuma' };

export default async function AcademicsSettingsPage() {
  const { user, can } = await getAccess();
  if (!can('academics.classes.view')) return <AccessDenied />;
  const s = await getSettings(user);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Academics settings" description="Registers, alerts, subjects per student and teaching load." breadcrumbs={[{ label: 'Academics' }, { label: 'Settings' }]} />
      <AcademicsSettingsClient
        settings={{
          afternoonRegister: s.afternoonRegister, perLessonAttendance: s.perLessonAttendance, lessonPlans: s.lessonPlans, minSubjectsOLevel: s.minSubjectsOLevel, maxSubjectsOLevel: s.maxSubjectsOLevel,
          minSubjectsALevel: s.minSubjectsALevel, maxSubjectsALevel: s.maxSubjectsALevel, maxPeriodsPerWeek: s.maxPeriodsPerWeek, absentSmsAlert: s.absentSmsAlert, chronicAbsenceAlert: s.chronicAbsenceAlert,
          consecutiveAbsentDays: s.consecutiveAbsentDays, attendanceThresholdPct: s.attendanceThresholdPct,
        }}
        canEdit={can('system.settings.edit')}
      />
    </div>
  );
}
