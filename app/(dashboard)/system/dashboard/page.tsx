import { redirect } from 'next/navigation';

// The old system dashboard was retired. Its "Set up your school" checklist now lives in the "Still to do" panel on /admin.
// Old links, bookmarks and notifications land on the person's home instead.
export default function RetiredSystemDashboard() {
  redirect('/');
}
