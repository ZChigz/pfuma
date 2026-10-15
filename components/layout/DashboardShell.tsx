import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { buildNav } from '@/lib/nav';
import { getViewTerm } from '@/lib/system/view-term';
import { Sidebar } from './Sidebar';
import { TopBar, type JumpItem } from './TopBar';
import { ROLE_LABELS, ROLE_NAV } from './nav-config';
import type { ReactNode } from 'react';

// One shell for every page: sidebar for modules, top bar for school, term and user.
// Everything it shows is filtered through can().
export async function DashboardShell({ children }: { children: ReactNode }) {
  const { user, can } = await getAccess();
  const db = getScopedDb(user.schoolId, user.id);

  const canSeeNotifications = can('account.notifications.view');
  const [school, view, unread] = await Promise.all([
    db.school.findUnique({ where: { id: user.schoolId }, select: { name: true, logoUrl: true } }),
    getViewTerm(user.schoolId, db),
    canSeeNotifications ? db.notification.count({ where: { userId: user.id, readAt: null } }) : Promise.resolve(0),
  ]);

  const groups = buildNav(user);
  const workspace = ROLE_NAV[user.role] ?? null;
  const jumpItems: JumpItem[] = [
    ...groups.flatMap((g) => g.items.filter((i) => i.href).map((i) => ({ label: i.label, href: i.href as string, icon: i.icon }))),
    ...(workspace?.sections.flatMap((s) => s.items) ?? []),
  ];

  return (
    <div className="min-h-screen bg-frame md:h-screen md:p-5">
      <div className="flex min-h-screen gap-3 bg-white p-3 md:h-full md:min-h-0 md:rounded-[28px] md:shadow-[0_24px_60px_-24px_rgba(20,48,31,0.35)]">
        <Sidebar groups={groups} workspace={workspace} openTermName={view.openTerm?.name} />
        <div className="flex min-w-0 flex-1 flex-col rounded-2xl bg-canvas p-4 md:overflow-hidden md:p-5">
          <TopBar
            schoolName={school?.name ?? ''}
            logoUrl={school?.logoUrl ?? null}
            terms={view.terms.map((t) => ({ id: t.id, name: t.name, status: t.status }))}
            viewTermId={view.term?.id ?? null}
            unread={unread}
            fullName={user.fullName}
            roleLabel={ROLE_LABELS[user.role]}
            jumpItems={jumpItems}
            canSwitchTerm={can('account.term.view')}
            canSeeNotifications={canSeeNotifications}
            canViewProfile={can('account.profile.view')}
            canChangePassword={can('account.password.change')}
          />
          <main className="min-h-0 flex-1 md:overflow-y-auto md:pr-1">{children}</main>
        </div>
      </div>
    </div>
  );
}
