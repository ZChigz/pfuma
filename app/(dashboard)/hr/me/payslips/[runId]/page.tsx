import { getHrAccess as getAccess } from '@/lib/hr/access';
import { getPayslip } from '@/lib/payroll/payslip';
import { ServiceError } from '@/lib/api';
import QRCode from 'qrcode';
import { headers } from 'next/headers';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { Money } from '@/components/finance/format';
import { PrintButton } from '@/components/hr/PrintButton';

export const metadata = { title: 'Payslip · Pfuma' };

export default async function PayslipPage({ params, searchParams }: { params: { runId: string }; searchParams: { employee?: string } }) {
  const { user } = await getAccess();
  let p;
  try { p = await getPayslip(user, params.runId, searchParams.employee); } catch (e) { if (e instanceof ServiceError && e.status < 500) return <AccessDenied message={e.status === 404 ? e.message : undefined} />; throw e; }
  const host = headers().get('host');
  const proto = host?.startsWith('localhost') ? 'http' : 'https';
  const qr = await QRCode.toDataURL(`${proto}://${host}${p.verifyPath}`, { margin: 1, width: 200 });
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3 pb-8">
      <div className="flex justify-end print:hidden"><PrintButton label="Print or save as PDF" /></div>
      <article className="rounded-2xl bg-white p-5 text-sm text-ink sm:p-8 print:rounded-none print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3">
          <div className="flex items-center gap-3">{p.school.logoUrl && /* eslint-disable-next-line @next/next/no-img-element */ <img src={p.school.logoUrl} alt="" className="h-12 w-12 object-contain" />}<div><h1 className="text-lg font-bold">{p.school.name}</h1><p className="text-muted">Payslip for {p.month}</p></div></div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <div className="text-center"><img src={qr} alt="Verification QR code" className="h-20 w-20" /><p className="text-[10px] text-muted">{p.verificationCode}</p></div>
        </header>
        <dl className="grid grid-cols-2 gap-2 py-3 sm:grid-cols-3">
          <div><dt className="text-muted">Employee</dt><dd className="font-semibold">{p.employee.name}</dd></div><div><dt className="text-muted">Number</dt><dd>{p.employee.employeeNo}</dd></div><div><dt className="text-muted">Job title</dt><dd>{p.employee.jobTitle}</dd></div>
          <div><dt className="text-muted">Department</dt><dd>{p.employee.department ?? '—'}</dd></div><div><dt className="text-muted">NSSA number</dt><dd>{p.employee.nssaNo ?? '—'}</dd></div><div><dt className="text-muted">Tax number</dt><dd>{p.employee.taxNo ?? '—'}</dd></div>
          <div><dt className="text-muted">Paid by</dt><dd>{p.employee.paymentMethod ?? '—'}</dd></div>
        </dl>
        {p.currencies.map((c) => (
          <section key={c.currency} className="mt-3 border-t border-line pt-3">
            <h2 className="mb-2 font-semibold">{c.currency === 'USD' ? 'US dollars' : 'ZiG'}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <table className="w-full"><caption className="mb-1 text-left text-xs font-semibold uppercase text-muted">Earnings</caption><tbody>{c.earnings.map((e, i) => (<tr key={i}><td className="py-0.5">{e.label}</td><td className="py-0.5 text-right"><Money cents={e.amountCents} currency={c.currency} /></td></tr>))}<tr className="border-t border-line font-semibold"><td>Gross</td><td className="text-right"><Money cents={c.grossCents} currency={c.currency} /></td></tr></tbody></table>
              <table className="w-full"><caption className="mb-1 text-left text-xs font-semibold uppercase text-muted">Deductions</caption><tbody>{c.deductions.map((d, i) => (<tr key={i}><td className="py-0.5">{d.label}</td><td className="py-0.5 text-right"><Money cents={d.amountCents} currency={c.currency} /></td></tr>))}<tr className="border-t border-line font-semibold"><td>Total deductions</td><td className="text-right"><Money cents={c.totalDeductionsCents} currency={c.currency} /></td></tr></tbody></table>
            </div>
            <p className="mt-2 text-base font-bold">Net pay: <Money cents={c.netCents} currency={c.currency} /></p>
            <p className="text-xs text-muted">Year to date: gross <Money cents={c.ytd.grossCents} currency={c.currency} />, PAYE and AIDS levy <Money cents={c.ytd.payeCents} currency={c.currency} />, NSSA <Money cents={c.ytd.nssaCents} currency={c.currency} />.</p>
          </section>
        ))}
        {p.leaveBalance && <p className="mt-3 border-t border-line pt-3 text-xs text-muted">{p.leaveBalance.name} leave left at {p.leaveBalance.asAt}: {p.leaveBalance.remaining} days.</p>}
      </article>
    </div>
  );
}
