import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AccessProvider, Can, useCan, useScopes } from '@/components/access/AccessProvider';

function Probe({ k }: { k: string }) {
  return <span data-testid="probe">{String(useCan(k))}|{useScopes(k).join(',')}</span>;
}

describe('the permissions in the browser', () => {
  const permissions = { 'finance.payments.record': ['RECORDED_BY_ME' as const], 'system.dashboard.view': ['SCHOOL' as const] };

  it('useCan says whether a key is held, and useScopes at which scope', () => {
    const { rerender } = render(<AccessProvider permissions={permissions}><Probe k="finance.payments.record" /></AccessProvider>);
    expect(screen.getByTestId('probe').textContent).toBe('true|RECORDED_BY_ME');
    rerender(<AccessProvider permissions={permissions}><Probe k="finance.payments.void" /></AccessProvider>);
    expect(screen.getByTestId('probe').textContent).toBe('false|');
  });

  it('<Can> shows its children only to someone who holds the permission, or one of anyOf, and hides rather than disables', () => {
    render(
      <AccessProvider permissions={permissions}>
        <Can permission="system.dashboard.view"><b>dashboard</b></Can>
        <Can permission="finance.payments.void"><b>void</b></Can>
        <Can anyOf={['hr.pay.view', 'finance.payments.record']}><b>either</b></Can>
        <Can permission="hr.pay.view" fallback={<i>nothing here</i>}><b>pay</b></Can>
      </AccessProvider>,
    );
    expect(screen.queryByText('dashboard')).not.toBeNull();
    expect(screen.queryByText('void')).toBeNull();
    expect(screen.queryByText('either')).not.toBeNull();
    expect(screen.queryByText('pay')).toBeNull();
    expect(screen.queryByText('nothing here')).not.toBeNull();
  });

  it('holds nothing without a provider', () => {
    render(<Probe k="system.dashboard.view" />);
    expect(screen.getByTestId('probe').textContent).toBe('false|');
  });
});
