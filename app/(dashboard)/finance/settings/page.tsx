import { getAccess } from '@/lib/access';
import { getControls, listFunds } from '@/lib/finance/setup';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { FormAction } from '@/components/finance/FormAction';
import { Notice, RowAction, Section, Td, Th } from '@/components/finance/shared';
import { formatMoney } from '@/lib/finance/money';

export const metadata = { title: 'Funds and controls · Pfuma' };

const KINDS = [['TUITION', 'Tuition'], ['SDC_LEVY', 'SDC levy'], ['BOARDING', 'Boarding'], ['GENERAL', 'General'], ['OTHER', 'Other']] as const;

export default async function FinanceSettingsPage() {
  const { user, can } = await getAccess();
  if (!can('finance.funds.manage') && !can('finance.settings.manage')) return <AccessDenied />;
  const [funds, controls] = await Promise.all([listFunds(user), getControls(user)]);
  const manageFunds = can('finance.funds.manage');
  const manageControls = can('finance.settings.manage');
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Funds and money controls" description="Tuition, SDC levies and boarding fees belong to different funds. A payment settles only charges of its own fund." breadcrumbs={[{ label: 'Finance', href: '/finance' }, { label: 'Funds and controls' }]} />
      <Section title="Funds" hint="A fund is never deleted. Switch one off when it is no longer used; what it holds stays in the reports."
        action={manageFunds ? <FormAction label="Add a fund" variant="primary" size="md" url="/api/finance/funds" done="Fund added" fields={[{ name: 'name', label: 'Name', required: true, maxLength: 40 }, { name: 'code', label: 'Short code', required: true, maxLength: 20, hint: 'Capital letters, such as LIBRARY' }, { name: 'kind', label: 'Kind', type: 'select', initial: 'OTHER', options: KINDS.map(([v, l]) => ({ value: v, label: l })) }]} /> : undefined}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem]">
            <thead><tr><Th>Fund</Th><Th>Code</Th><Th>Status</Th><Th /></tr></thead>
            <tbody>
              {funds.map((f) => (
                <tr key={f.id} className="border-t border-line">
                  <Td className="font-semibold">{f.name}</Td><Td>{f.code}</Td><Td>{f.active ? 'In use' : 'Switched off'}</Td>
                  <Td>{manageFunds && <div className="flex justify-end gap-2">
                    <FormAction label="Rename" variant="ghost" method="PATCH" url={`/api/finance/funds/${f.id}`} done="Saved" fields={[{ name: 'name', label: 'Name', required: true, initial: f.name, maxLength: 40 }]} />
                    <RowAction label={f.active ? 'Switch off' : 'Switch on'} variant="ghost" method="PATCH" url={`/api/finance/funds/${f.id}`} body={{ active: !f.active }} done="Saved" />
                  </div>}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title="Who can handle money" hint="The person who records a payment can never verify it, and nobody who raised or approved spending can pay it out. This holds for the Owner and Administrators too.">
        <p className="text-sm text-ink">{controls.recorders} {controls.recorders === 1 ? 'person' : 'people'} can record payments; {controls.verifiers} {controls.verifiers === 1 ? 'person' : 'people'} can verify them through a role (the Owner and Administrators can as well).</p>
        {controls.verifiers === 0 && <div className="mt-3"><Notice>Nobody except the Owner and Administrators can verify payments. That is fine while the school is being set up; the cash-up report will say so each time. Give the Bursar or the Head the permission to verify payments in System, Roles.</Notice></div>}
      </Section>
      <Section title="Money controls"
        action={manageControls ? <FormAction label="Change the limit" variant="secondary" size="md" method="PUT" url="/api/finance/controls" done="Saved" intro="The most the bursar may record as a direct expense without a request. Larger amounts need an expense request that someone else approves."
          fields={[{ name: 'directLimitUsd', label: 'Limit in US dollars', type: 'money', hint: 'Leave empty to keep it as it is' }, { name: 'directLimitZig', label: 'Limit in ZiG', type: 'money', hint: 'Leave empty to keep it as it is' }]} /> : undefined}>
        <dl className="grid grid-cols-[14rem_1fr] gap-y-2 text-sm">
          <dt className="text-muted">Direct expense limit (US dollars)</dt><dd className="text-ink">{controls.directLimitUsdCents === null ? 'No limit' : formatMoney(controls.directLimitUsdCents, 'USD')}</dd>
          <dt className="text-muted">Direct expense limit (ZiG)</dt><dd className="text-ink">{controls.directLimitZigCents === null ? 'No limit' : formatMoney(controls.directLimitZigCents, 'ZIG')}</dd>
          <dt className="text-muted">Reference for non-cash payments</dt><dd className="flex items-center gap-3 text-ink">{controls.requireReference ? 'Required' : 'Not required'}{manageControls && <RowAction label={controls.requireReference ? 'Do not require' : 'Require'} variant="ghost" method="PUT" url="/api/finance/controls" body={{ requireReference: !controls.requireReference }} done="Saved" />}</dd>
        </dl>
        {manageControls && (controls.directLimitUsdCents !== null || controls.directLimitZigCents !== null) && (
          <div className="mt-3 flex gap-2">
            {controls.directLimitUsdCents !== null && <RowAction label="Remove the US dollar limit" variant="ghost" method="PUT" url="/api/finance/controls" body={{ directLimitUsd: null }} done="Saved" />}
            {controls.directLimitZigCents !== null && <RowAction label="Remove the ZiG limit" variant="ghost" method="PUT" url="/api/finance/controls" body={{ directLimitZig: null }} done="Saved" />}
          </div>
        )}
      </Section>
      {manageControls && (
        <Section title="Limits and rules" hint="Empty means no limit. Amounts are in whole dollars and cents.">
          <div className="flex flex-wrap gap-2">
            <FormAction label="Spending limits" variant="secondary" size="md" method="PUT" url="/api/finance/controls" done="Saved" intro="What needs a receipt, quotes or the Owner. Leave a box empty to keep its current value; to remove a limit use the buttons below."
              fields={[
                { name: 'receiptRequiredAboveUsd', label: 'Receipt needed above (US$)', type: 'money', initial: controls.receiptRequiredAboveUsdCents === null ? '' : (controls.receiptRequiredAboveUsdCents / 100).toFixed(2) },
                { name: 'receiptRequiredAboveZig', label: 'Receipt needed above (ZiG)', type: 'money', initial: controls.receiptRequiredAboveZigCents === null ? '' : (controls.receiptRequiredAboveZigCents / 100).toFixed(2) },
                { name: 'quotesAboveUsd', label: 'Quotes needed above (US$)', type: 'money', initial: controls.quotesAboveUsdCents === null ? '' : (controls.quotesAboveUsdCents / 100).toFixed(2) },
                { name: 'quotesAboveZig', label: 'Quotes needed above (ZiG)', type: 'money', initial: controls.quotesAboveZigCents === null ? '' : (controls.quotesAboveZigCents / 100).toFixed(2) },
                { name: 'quotesRequired', label: 'How many quotes', type: 'number', initial: String(controls.quotesRequired) },
                { name: 'headLimitUsd', label: 'Most the Head approves alone (US$)', type: 'money', initial: controls.headLimitUsdCents === null ? '' : (controls.headLimitUsdCents / 100).toFixed(2), hint: 'Above this a second person must approve' },
                { name: 'headLimitZig', label: 'Most the Head approves alone (ZiG)', type: 'money', initial: controls.headLimitZigCents === null ? '' : (controls.headLimitZigCents / 100).toFixed(2) },
                { name: 'overrunPercent', label: 'Payment may exceed the approved amount by (%)', type: 'number', initial: String(controls.overrunPercent), hint: 'Above this an approver must agree' },
              ]} />
            <FormAction label="Payment rules" variant="secondary" size="md" method="PUT" url="/api/finance/controls" done="Saved"
              fields={[
                { name: 'proofAboveUsd', label: 'Proof of payment needed above (US$)', type: 'money', initial: controls.proofAboveUsdCents === null ? '' : (controls.proofAboveUsdCents / 100).toFixed(2), hint: 'Bank and mobile-money payments' },
                { name: 'proofAboveZig', label: 'Proof of payment needed above (ZiG)', type: 'money', initial: controls.proofAboveZigCents === null ? '' : (controls.proofAboveZigCents / 100).toFixed(2) },
                { name: 'allocationMode', label: 'When a payment names no charge', type: 'select', required: true, initial: controls.allocationMode, options: [{ value: 'OLDEST_FUND', label: 'Settle the oldest charge first' }, { value: 'PROPORTIONAL', label: 'Share it over the funds in proportion' }] },
                { name: 'staleRateDays', label: 'Warn when the exchange rate is older than (days)', type: 'number', initial: String(controls.staleRateDays) },
                { name: 'cashToleranceCents', label: 'Cash-up difference allowed without a reason (cents)', type: 'number', initial: String(controls.cashToleranceCents) },
                { name: 'reminderLeadDays', label: 'Remind guardians of an instalment (days before)', type: 'number', initial: String(controls.reminderLeadDays) },
              ]} />
            <FormAction label="Online payments (Paynow)" variant="secondary" size="md" method="PUT" url="/api/finance/controls" done="Saved" intro="From the school’s Paynow account. The key is stored securely and never shown again; leave it empty to keep the one saved."
              fields={[
                { name: 'paynowId', label: 'Paynow integration id', initial: controls.paynowId ?? '', maxLength: 40 },
                { name: 'paynowKey', label: controls.paynowKeySet ? 'Integration key (saved; type to replace)' : 'Integration key', maxLength: 120 },
              ]} />
            <FormAction label="Reminder text" variant="secondary" size="md" method="PUT" url="/api/finance/controls" done="Saved" intro="Use {guardian}, {student} and {amount}."
              fields={[{ name: 'arrearsSmsTemplate', label: 'Message', type: 'textarea', required: true, initial: controls.arrearsSmsTemplate, maxLength: 300 }]} />
          </div>
          <dl className="mt-4 grid grid-cols-[18rem_1fr] gap-y-2 text-sm">
            {([
              ['applyCreditAtBilling', 'Use credit on account when billing', controls.applyCreditAtBilling], ['autoBillOnAdmission', 'Bill a learner admitted after the term was billed', controls.autoBillOnAdmission],
              ['prorateAdmission', 'Charge a late admission by the weeks left', controls.prorateAdmission], ['paynowEnabled', 'Online payments with Paynow', controls.paynowEnabled],
            ] as const).map(([key, label, on]) => (
              <div key={key} className="contents"><dt className="text-muted">{label}</dt><dd className="flex items-center gap-3 text-ink">{on ? 'On' : 'Off'}<RowAction label={on ? 'Switch off' : 'Switch on'} variant="ghost" method="PUT" url="/api/finance/controls" body={{ [key]: !on }} done="Saved" /></dd></div>
            ))}
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            {controls.headLimitUsdCents !== null && <RowAction label="Remove the Head’s US dollar limit" variant="ghost" method="PUT" url="/api/finance/controls" body={{ headLimitUsd: null }} done="Saved" />}
            {controls.headLimitZigCents !== null && <RowAction label="Remove the Head’s ZiG limit" variant="ghost" method="PUT" url="/api/finance/controls" body={{ headLimitZig: null }} done="Saved" />}
            {controls.receiptRequiredAboveUsdCents !== null && <RowAction label="Remove the receipt rule (US$)" variant="ghost" method="PUT" url="/api/finance/controls" body={{ receiptRequiredAboveUsd: null }} done="Saved" />}
            {controls.quotesAboveUsdCents !== null && <RowAction label="Remove the quotes rule (US$)" variant="ghost" method="PUT" url="/api/finance/controls" body={{ quotesAboveUsd: null }} done="Saved" />}
          </div>
        </Section>
      )}
    </div>
  );
}
