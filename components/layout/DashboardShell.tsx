import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import type { ReactNode } from 'react';

export async function DashboardShell({ children }: { children: ReactNode }) {
  const session = await auth();
  const school = session?.user?.schoolId
    ? await prisma.school.findUnique({
        where: { id: session.user.schoolId },
        select: { name: true, currentTerm: true },
      })
    : null;

  return (
    <div className="min-h-screen bg-frame md:h-screen md:p-5">
      <div className="flex min-h-screen gap-3 bg-white p-3 md:h-full md:min-h-0 md:rounded-[28px] md:shadow-[0_24px_60px_-24px_rgba(20,48,31,0.35)]">
        <Sidebar currentTerm={school?.currentTerm ?? undefined} />
        <div className="flex min-w-0 flex-1 flex-col rounded-2xl bg-canvas p-4 md:overflow-hidden md:p-5">
          <TopBar
            schoolName={school?.name ?? ''}
            currentTerm={school?.currentTerm ?? undefined}
            role={session?.user?.role}
          />
          <main className="min-h-0 flex-1 md:overflow-y-auto md:pr-1">{children}</main>
        </div>
      </div>
    </div>
  );
}
