import { redirect } from 'next/navigation';
import { sendToFinance } from '@/lib/finance/legacy-redirect';

export default async function BursarPaymentsPage() {
  await sendToFinance('/finance/payments');
  redirect('/bursar/students');
}
