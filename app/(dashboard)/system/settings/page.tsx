import Link from 'next/link';
import { getAccess, MODULES } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { getSchoolProfile } from '@/lib/system/settings';
import { getStructure } from '@/lib/system/structure';
import { getScales } from '@/lib/system/grading';
import { getModuleStates } from '@/lib/system/modules';
import { nextSequences } from '@/lib/students/server';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { AcademicTab, type YearRow } from '@/components/system/settings/AcademicTab';
import { FinanceTab } from '@/components/system/settings/FinanceTab';
import { GradingTab } from '@/components/system/settings/GradingTab';
import { NumberingTab } from '@/components/system/settings/NumberingTab';
import { ProfileTab } from '@/components/system/settings/ProfileTab';
import { StructureTab } from '@/components/system/settings/StructureTab';

export const metadata = { title: 'School Settings · Pfuma' };

const TABS = [
  { key: 'profile', label: 'School profile' },
  { key: 'years', label: 'Years and terms' },
  { key: 'structure', label: 'Forms, streams and classes' },
  { key: 'grading', label: 'Grading' },
  { key: 'finance', label: 'Finance basics' },
  { key: 'numbering', label: 'Numbering and modules' },
] as const;

const day = (d: Date) => d.toISOString().slice(0, 10);

export default async function SettingsPage({ searchParams }: { searchParams: { tab?: string | string[] } }) {
  const { user, can } = await getAccess();
  if (!can('system.settings.view')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const school = await getSchoolProfile(db, user.schoolId);
  if (!school) return <AccessDenied message="School not found." />;

  const wanted = Array.isArray(searchParams.tab) ? searchParams.tab[0] : searchParams.tab;
  const tab = TABS.find((t) => t.key === wanted)?.key ?? 'profile';
  const year = new Date().getUTCFullYear();

  let panel;
  if (tab === 'profile') {
    panel = <ProfileTab school={school} canUpdate={can('system.settings.edit')} />;
  } else if (tab === 'years') {
    const years = await db.academicYear.findMany({
      where: { schoolId: user.schoolId },
      include: { terms: { orderBy: { termNumber: 'asc' } } },
      orderBy: { year: 'desc' },
    });
    const rows: YearRow[] = years.map((y) => ({
      id: y.id,
      year: y.year,
      terms: y.terms.map((t) => ({ id: t.id, name: t.name, termNumber: t.termNumber, startDate: day(t.startDate), endDate: day(t.endDate), status: t.status })),
    }));
    panel = <AcademicTab years={rows} canCreate={can('system.settings.edit')} canUpdate={can('system.settings.edit')} canOpen={can('system.settings.edit')} canClose={can('system.settings.edit')} />;
  } else if (tab === 'structure') {
    panel = <StructureTab data={await getStructure(db, user.schoolId)} canUpdate={can('system.settings.edit')} />;
  } else if (tab === 'grading') {
    panel = <GradingTab scales={await getScales(db, user.schoolId)} canUpdate={can('system.settings.edit')} />;
  } else if (tab === 'finance') {
    panel = <FinanceTab school={school} year={year} canUpdate={can('system.settings.edit')} />;
  } else {
    const [sequences, modules, subscription] = await Promise.all([
      nextSequences(db as never, user.schoolId, [year]),
      getModuleStates(db),
      can('system.subscription.view') ? db.school.findUnique({ where: { id: user.schoolId }, select: { status: true, renewalDate: true, plan: { select: { name: true } } } }) : Promise.resolve(null),
    ]);
    panel = (
      <NumberingTab
        school={{ schoolCode: school.schoolCode, admissionFormat: school.admissionFormat }}
        year={year}
        nextSaved={sequences.get(year) ?? 1}
        plan={subscription ? { name: subscription.plan?.name ?? 'No plan', status: subscription.status, endsAt: subscription.renewalDate ? day(subscription.renewalDate) : null } : null}
        modules={MODULES.map((m) => ({ key: m.key, label: m.label, on: modules[m.key] }))}
        canUpdate={can('system.settings.edit')}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-6">
      <PageHeader
        title="School Settings"
        description="Everything here is read by the rest of Pfuma, and every change is logged"
        breadcrumbs={[{ label: 'Dashboard & System' }, { label: 'School Settings' }]}
      />

      <div role="tablist" aria-label="Settings" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {TABS.map((t, i) => (
          <Link
            key={t.key}
            role="tab"
            id={`tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls="settings-panel"
            href={`/system/settings?tab=${t.key}`}
            className={`flex min-h-[44px] flex-shrink-0 items-center gap-2 rounded-full px-4 text-sm font-medium ${tab === t.key ? 'bg-primary text-white' : 'bg-white text-ink hover:bg-tint'}`}
          >
            <span className="text-xs opacity-70">{i + 1}</span>{t.label}
          </Link>
        ))}
      </div>

      <div id="settings-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>{panel}</div>
    </div>
  );
}
