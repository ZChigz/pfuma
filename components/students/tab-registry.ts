// Other modules (Fees, Results, Attendance, Library, Hostel) add their own tab to the student profile.
//
//   registerStudentTab({ key: 'fees', label: 'Fees', permission: 'finance.fees.view' });   // lib/students/rules.ts: the tab bar
//   registerStudentTabContent('fees', async ({ studentId, user }) => <FeesTab ... />);    // here: what the tab shows
//
// The profile page lists a registered tab only to people who hold its permission, and renders its content on the server.
import type { ReactNode } from 'react';
import type { AccessContext } from '@/lib/access';

export type StudentTabContent = (args: { studentId: string; user: AccessContext }) => Promise<ReactNode> | ReactNode;

const contents = new Map<string, StudentTabContent>();

export function registerStudentTabContent(key: string, content: StudentTabContent) {
  contents.set(key, content);
}

export const studentTabContent = (key: string) => contents.get(key);
