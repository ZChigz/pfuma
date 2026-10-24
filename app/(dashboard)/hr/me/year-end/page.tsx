import { getHrAccess as getAccess } from '@/lib/hr/access';
import { yearEndSummary } from '@/lib/payroll/payslip';
import { ServiceError } from '@/lib/api';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Money } from '@/components/finance/format';
import { Section, Td, Th } from '@/components/finance/shared';
import { PrintButton } from '@/components/hr/PrintButton';

export const metadata = { title: 'Year-end summary · Pfuma' };

export default async function YearEnd({ searchParams }: { searchParams: { year?: string } }) {
  const { user, can } = await getAccess();
  if (!can('hr.self.payslips')) return <AccessDenied />;
  let s;
  try { s = await yearEndSummary(user, searchParams.year ? Number(searchParams.year) : undefined); } catch (e) { if (e instanceof ServiceError) return <AccessDenied message={e.message} />; throw e; }
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title={`Pay and tax summary for ${s.year}`} description={`${s.employee} · ${s.employeeNo}${s.taxNo ? ` · tax number ${s.taxNo}` : ''}`} actions={<PrintButton />} />
      <Section title="What you earned and what was withheld" hint="From the payslips of the payrolls that were paid in the year. Each currency is shown on its own.">
        {s.currencies.length === 0 ? <p className="text-sm text-muted">No payslips in {s.year}.</p> : (
          <table className="w-full"><thead><tr><Th>Currency</Th><Th className="text-right">Months</Th><Th className="text-right">Gross</Th><Th className="text-right">PAYE</Th><Th className="text-right">AIDS levy</Th><Th className="text-right">NSSA</Th><Th className="text-right">Net</Th></tr></thead><tbody>
            {s.currencies.map((c) => (<tr key={c.currency} className="border-t border-line"><Td>{c.currency}</Td><Td className="text-right">{c.months}</Td><Td className="text-right"><Money cents={c.grossCents} currency={c.currency} /></Td><Td className="text-right"><Money cents={c.payeCents} currency={c.currency} /></Td><Td className="text-right"><Money cents={c.aidsLevyCents} currency={c.currency} /></Td><Td className="text-right"><Money cents={c.nssaCents} currency={c.currency} /></Td><Td className="text-right"><Money cents={c.netCents} currency={c.currency} /></Td></tr>))}
          </tbody></table>
        )}
      </Section>
    </div>
  );
}
