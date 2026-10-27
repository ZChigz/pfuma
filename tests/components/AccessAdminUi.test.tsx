import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

let pathname = '/finance/reports';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/ui/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { AccessProvider } from '@/components/access/AccessProvider';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { RoleEditorClient } from '@/components/system/RoleEditorClient';
import { permissionCatalogue } from '@/lib/access/catalogue';
import { PERMISSIONS } from '@/lib/access-core';

const fetchMock = vi.fn();
beforeEach(() => {
  pathname = '/finance/reports';
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { id: 'r1' } }) });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(cleanup);

describe('the access-denied page', () => {
  it('says what is missing in plain words, lists the roles, and offers the way back', () => {
    render(<AccessProvider permissions={{}} roles={['Teacher', 'Class Teacher']}><AccessDenied permission="finance.reports.view" /></AccessProvider>);
    expect(screen.getByText(/You do not have access to this page/)).toBeTruthy();
    expect(screen.getByText(/which your roles do not include/).textContent).toContain(PERMISSIONS['finance.reports.view'].charAt(0).toLowerCase());
    expect(screen.getByText('Teacher, Class Teacher')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to dashboard' }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('button', { name: 'Request access' })).toBeTruthy();
  });

  it('works out the permission from the page when none is given', () => {
    render(<AccessProvider permissions={{}}><AccessDenied /></AccessProvider>);
    expect(screen.getByText(/which your roles do not include/)).toBeTruthy();
  });

  it('sends a request with the permission, the page and the reason', async () => {
    render(<AccessProvider permissions={{}}><AccessDenied permission="finance.reports.view" /></AccessProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Request access' }));
    const send = screen.getByRole('button', { name: 'Send request' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Why do you need it?'), { target: { value: 'Term report' } });
    fireEvent.click(send);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/system/access-requests');
    expect(JSON.parse(init.body)).toEqual({ permissionKey: 'finance.reports.view', page: '/finance/reports', reason: 'Term report' });
    await waitFor(() => expect(screen.getByText(/Request sent/)).toBeTruthy());
  });

  it('asks which permission when the page is not one the menu knows', () => {
    pathname = '/somewhere/unknown';
    render(<AccessProvider permissions={{}}><AccessDenied /></AccessProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Request access' }));
    expect(screen.getByLabelText(/What do you need to do/)).toBeTruthy();
  });
});

describe('the role grid', () => {
  const catalogue = permissionCatalogue();
  const grants = { 'exams.marks.enter': 'ASSIGNED', 'exams.marks.submit': 'ASSIGNED' };
  const props = { roleKey: 'MENTOR', name: 'Mentor', description: 'Mentors', catalogue, holders: 0, hasEverything: false } as const;

  it('shows a system role read-only: only what it grants, no boxes, no save', () => {
    render(<RoleEditorClient {...props} isSystem grants={grants} canEdit canAdd />);
    expect(screen.getByText(PERMISSIONS['exams.marks.enter'])).toBeTruthy();
    expect(screen.queryByText(PERMISSIONS['finance.payments.void'])).toBeNull();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Save role' })).toBeNull();
    expect(screen.getByText(/cannot be changed, but you can copy it/)).toBeTruthy();
  });

  it('lets someone who manages users take permissions out of a custom role, but not add any', async () => {
    render(<RoleEditorClient {...props} isSystem={false} grants={grants} canEdit canAdd={false} />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.queryByLabelText(PERMISSIONS['finance.payments.void'])).toBeNull();
    const save = screen.getByRole('button', { name: 'Save role' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(PERMISSIONS['exams.marks.submit']));
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/system/roles/MENTOR');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body).grants).toEqual([{ key: 'exams.marks.enter', scope: 'ASSIGNED' }]);
  });

  it('only offers the same scope or a narrower one to someone who cannot widen', () => {
    render(<RoleEditorClient {...props} isSystem={false} grants={grants} canEdit canAdd={false} />);
    const options = Array.from((screen.getByLabelText(`How far: ${PERMISSIONS['exams.marks.enter']}`) as HTMLSelectElement).options).map((o) => o.value);
    expect(options).not.toContain('SCHOOL');
    expect(options).toContain('ASSIGNED');
    expect(options).toContain('SELF');
  });

  it('shows the Owner every permission to add, with whole school available', () => {
    render(<RoleEditorClient {...props} isSystem={false} grants={grants} canEdit canAdd />);
    expect(screen.getByLabelText(PERMISSIONS['finance.payments.void'])).toBeTruthy();
    const options = Array.from((screen.getByLabelText(`How far: ${PERMISSIONS['exams.marks.enter']}`) as HTMLSelectElement).options).map((o) => o.value);
    expect(options).toContain('SCHOOL');
  });
});
