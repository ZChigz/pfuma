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
    <div className="min-h-screen bg-[#f5f5f4]">
      <Sidebar />
      <TopBar
        schoolName={school?.name ?? ''}
        currentTerm={school?.currentTerm ?? undefined}
        role={session?.user?.role}
      />
      {/* Content: offset right of sidebar (16 on mobile, 64 on md+) and below TopBar */}
      <main className="ml-16 min-h-screen overflow-y-auto bg-[#f5f5f4] p-6 pt-[80px] md:ml-64">
        {children}
      </main>
    </div>
  );
}
