import { getHrAccess as getAccess } from '@/lib/hr/access';
import { getPayrollSettings } from '@/lib/payroll/settings-service';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { FormAction } from '@/components/finance/FormAction';
import { Money } from '@/components/finance/format';
import { Notice, RowAction, Section, Td, Th } from '@/components/finance/shared';
import { HrNav } from '@/components/hr/HrNav';

export const metadata = { title: 'Tax tables and rates · Pfuma' };

const pct = (bps: number) => `${bps / 100}%`;

export default async function PayrollSettingsPage() {
  const { user, can } = await getAccess();
  if (!can('hr.payroll.settings') && !can('hr.payroll.view') && !can('hr.payroll.prepare')) return <AccessDenied />;
  const s = await getPayrollSettings(user);
  const edit = s.canEdit;
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Tax tables and statutory rates" description="Each has an effective-from date and is never edited: a change is added as a new one from its date. The school's accountant confirms the figures before the first run." breadcrumbs={[{ label: 'HR & Staff', href: '/hr' }, { label: 'Payroll', href: '/hr/payroll' }, { label: 'Tax tables and rates' }]} />
      <HrNav can={can} current="/hr/payroll" />
      <Notice tone="info">The starting figures are today&apos;s as reported (USD bands from the CountryTaxCalc 2026 guide, not verified against ZIMRA; ZiG middle bands are a placeholder scaled from the USD ones). They must be checked against ZIMRA&apos;s and NSSA&apos;s published tables, then confirmed.</Notice>
      {(['USD', 'ZIG'] as const).map((c) => (
        <Section key={c} title={`PAYE bands, ${c === 'USD' ? 'US dollars' : 'ZiG'} (monthly)`} action={edit && <FormAction label="Add a table" url="/api/hr/payroll/settings/tax-table" extra={{ currency: c }} done="Table added" intro="Add the new bands as one line: from-amount:rate, separated by commas. For example 0:0,100:20,300:25,3000:40 means 0% up to 100, 20% from 100, 25% from 300, 40% from 3000." fields={[{ name: 'effectiveFrom', label: 'Effective from', type: 'date', required: true }, { name: 'bandsText', label: 'Bands', required: true }]} />}>
          {s.tables[c].map((t) => (
            <div key={t.id} className="mb-3 rounded-xl border border-line p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><b className="text-sm">From {t.effectiveFrom}</b><span className="flex items-center gap-2"><Badge variant={t.confirmed ? 'success' : 'warning'} label={t.confirmed ? 'Confirmed' : 'Not confirmed'} />
                {edit && !t.confirmed && <RowAction label="Confirm" variant="primary" url="/api/hr/payroll/settings/confirm" body={{ kind: 'TAX_TABLE', id: t.id }} confirm="Confirm that this table is correct?" done="Confirmed" />}</span></div>
              <table className="w-full"><thead><tr><Th>Income from</Th><Th className="text-right">Rate</Th></tr></thead><tbody>{t.value.map((b) => (<tr key={b.fromCents} className="border-t border-line"><Td><Money cents={b.fromCents} currency={c} /></Td><Td className="text-right">{pct(b.rateBps)}</Td></tr>))}</tbody></table>
            </div>
          ))}
        </Section>
      ))}
      <Section title="Statutory rates" action={edit && <FormAction label="Add rates" url="/api/hr/payroll/settings/rates" done="Rates added" fields={[{ name: 'effectiveFrom', label: 'Effective from', type: 'date', required: true }, { name: 'aidsLevyBps', label: 'AIDS levy, % of PAYE × 100 (3% = 300)', type: 'number', required: true, initial: '300' }, { name: 'nssaEmployeeBps', label: 'NSSA employee × 100 (4.5% = 450)', type: 'number', required: true, initial: '450' }, { name: 'nssaEmployerBps', label: 'NSSA employer × 100', type: 'number', required: true, initial: '450' }, { name: 'nssaCeilingUsdCents', label: 'NSSA ceiling, US$ a month', type: 'cents' }, { name: 'nssaCeilingZigCents', label: 'NSSA ceiling, ZiG a month', type: 'cents' }, { name: 'nssaDeductibleBeforePaye', label: 'NSSA taken off before PAYE', type: 'bool' }, { name: 'zimdefBps', label: 'ZIMDEF × 100 (1% = 100)', type: 'number', required: true, initial: '100' }]} />}>
        {s.rates.map((r) => (
          <div key={r.id} className="mb-3 rounded-xl border border-line p-3 text-sm">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><b>From {r.effectiveFrom}</b><span className="flex items-center gap-2"><Badge variant={r.confirmed ? 'success' : 'warning'} label={r.confirmed ? 'Confirmed' : 'Not confirmed'} />
              {edit && !r.confirmed && <RowAction label="Confirm" variant="primary" url="/api/hr/payroll/settings/confirm" body={{ kind: 'RATES', id: r.id }} confirm="Confirm that these rates are correct?" done="Confirmed" />}</span></div>
            <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <div><dt className="text-muted">AIDS levy</dt><dd>{pct(r.value.aidsLevyBps)} of PAYE</dd></div><div><dt className="text-muted">NSSA employee / employer</dt><dd>{pct(r.value.nssaEmployeeBps)} / {pct(r.value.nssaEmployerBps)}</dd></div>
              <div><dt className="text-muted">NSSA ceiling</dt><dd>{r.value.nssaCeilingCents.USD != null ? <Money cents={r.value.nssaCeilingCents.USD} currency="USD" /> : 'none'} · {r.value.nssaCeilingCents.ZIG != null ? <Money cents={r.value.nssaCeilingCents.ZIG} currency="ZIG" /> : 'none in ZiG'}</dd></div>
              <div><dt className="text-muted">NSSA before PAYE</dt><dd>{r.value.nssaDeductibleBeforePaye ? 'Yes' : 'No'}</dd></div><div><dt className="text-muted">ZIMDEF</dt><dd>{pct(r.value.zimdefBps)} of the wage bill</dd></div>
            </dl>
          </div>
        ))}
      </Section>
      <Section title="Payroll options" action={edit && <FormAction label="Change" url="/api/hr/payroll/settings/options" done="Saved" fields={[{ name: 'payrollZigPerUsd', label: 'Payroll rate: ZiG per US$1 × 100 (27.50 = 2750), for staff paid by a split rule', type: 'number', initial: s.payrollZigPerUsd ? String(s.payrollZigPerUsd) : '' }, { name: 'netChangeFlagPct', label: 'Flag a net pay that moves more than (%)', type: 'number', initial: String(s.netChangeFlagPct) }, { name: 'payeDueDay', label: 'PAYE and AIDS levy due on day', type: 'number', initial: String(s.payeDueDay) }, { name: 'nssaDueDay', label: 'NSSA due on day', type: 'number', initial: String(s.nssaDueDay) }, { name: 'zimdefDueDay', label: 'ZIMDEF due on day', type: 'number', initial: String(s.zimdefDueDay) }, { name: 'reason', label: 'Reason', required: true }]} />}>
        <p className="text-sm text-ink">Payroll rate: {s.payrollZigPerUsd ? `ZiG ${(s.payrollZigPerUsd / 100).toFixed(2)} per US$1` : 'not set'} · flag net pay moving more than {s.netChangeFlagPct}% · statutory amounts due on day {s.payeDueDay} (PAYE), {s.nssaDueDay} (NSSA), {s.zimdefDueDay} (ZIMDEF) of the next month.</p>
      </Section>
    </div>
  );
}
