import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The phone register: everyone starts present, the teacher taps only the exceptions, "Mark all present" and "Save register" stay in
// reach, and with no signal the register is kept on the phone and counted as waiting to sync.
const memory = vi.hoisted(() => ({ store: null as null | import('@/lib/academics/offline').Store }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
const refresh = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock('@/components/ui/Toast', () => ({ toast, useToast: () => toast }));
vi.mock('@/lib/academics/offline', async (orig) => {
  const real = await orig<typeof import('@/lib/academics/offline')>();
  memory.store = real.memoryStore();
  return { ...real, idbStore: () => memory.store! };
});

import { RegisterClient, type Sheet } from '@/components/academics/RegisterClient';
import { waiting } from '@/lib/academics/offline';

const student = (n: number, o: Partial<Sheet['students'][number]> = {}): Sheet['students'][number] => ({
  id: `s${n}`, fullName: `Pupil Number${n}`, admissionNumber: `A${n}`, photoUrl: null, gender: n % 2 ? 'M' : 'F', status: 'PRESENT', reason: null, arrivalTime: null, locked: false, ...o,
});
const sheet = (o: Partial<Sheet> = {}): Sheet => ({
  kind: 'DAILY', classId: 'c1', className: 'Form 2 East', slotId: null, lesson: null, date: '2026-10-14', dateLabel: 'Wed, 14 Oct', session: 'AM', sessions: ['AM'],
  term: { id: 't1', name: 'Term 3 2026', status: 'OPEN' }, schoolDay: true, noSchoolReason: null, editMode: 'FREE', editMessage: null, canMark: true, register: null,
  students: [student(1), student(2), student(3), student(4, { status: 'SUSPENDED', locked: true })], ...o,
});

const posts: { registers: { ref: string; classId: string; entries: { studentId: string; status: string; arrivalTime?: string; reason?: string }[]; deviceId: string; changedAt: string; correctionReason?: string }[] }[] = [];

beforeEach(async () => {
  posts.length = 0;
  await memory.store!.clear();
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    posts.push(body);
    return new Response(JSON.stringify({ success: true, data: { results: body.registers.map((r: { ref: string }) => ({ ref: r.ref, ok: true, outcome: 'created' })) } }), { status: 200 });
  }));
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

const row = (name: string) => screen.getByRole('button', { name: new RegExp(name) });

describe('marking the register on a phone', () => {
  it('starts everyone Present and shows the counts', () => {
    render(<RegisterClient sheet={sheet()} />);
    expect(screen.getAllByText('Present').length).toBeGreaterThan(0);
    const counts = screen.getByText('Absent').closest('div')!;
    expect(within(counts).getByText('0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark all present' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save register' })).toBeInTheDocument();
  });

  it('sends only the exceptions: tap a student, choose Absent; another Late with a time; another Excused with a reason', async () => {
    const user = userEvent.setup();
    render(<RegisterClient sheet={sheet()} />);
    await user.click(row('Pupil Number1'));
    await user.click(screen.getByRole('button', { name: 'Absent', pressed: false }));
    await user.click(row('Pupil Number2'));
    await user.click(screen.getByRole('button', { name: 'Late', pressed: false }));
    const time = screen.getByLabelText(/Arrived at/);
    await user.clear(time);
    await user.type(time, '08:15');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await user.click(row('Pupil Number3'));
    await user.click(screen.getByRole('button', { name: 'Excused', pressed: false }));
    await user.click(screen.getByRole('button', { name: 'Family' }));
    await user.click(screen.getByRole('button', { name: 'Save register' }));

    await waitFor(() => expect(posts).toHaveLength(1));
    const sent = posts[0]!.registers[0]!;
    expect(sent.classId).toBe('c1');
    expect(sent.entries).toEqual([
      { studentId: 's1', status: 'ABSENT', arrivalTime: null, reason: null },
      { studentId: 's2', status: 'LATE', arrivalTime: '08:15', reason: null },
      { studentId: 's3', status: 'EXCUSED', arrivalTime: null, reason: 'FAMILY' },
    ]);
    expect(sent.deviceId).toMatch(/^dev-/);
    expect(new Date(sent.changedAt).getTime()).toBeGreaterThan(0);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Register saved'));
    expect(await waiting(memory.store!)).toHaveLength(0);
  });

  it('shows a student who is suspended as filled in, and does not let it be changed', async () => {
    const user = userEvent.setup();
    render(<RegisterClient sheet={sheet()} />);
    const locked = row('Pupil Number4');
    expect(locked).toBeDisabled();
    expect(within(locked).getByText('Suspended')).toBeInTheDocument();
    await user.click(locked);
    expect(screen.queryAllByRole('button', { name: 'Absent' })).toHaveLength(0);
  });

  it('puts everyone back to Present with "Mark all present"', async () => {
    const user = userEvent.setup();
    render(<RegisterClient sheet={sheet()} />);
    await user.click(row('Pupil Number1'));
    await user.click(screen.getByRole('button', { name: 'Absent', pressed: false }));
    expect(within(screen.getByText('Absent', { selector: 'p' }).closest('div')!).getByText('1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mark all present' }));
    expect(within(screen.getByText('Absent', { selector: 'p' }).closest('div')!).getByText('0')).toBeInTheDocument();
  });

  it('keeps the register on the phone with no signal and counts it as waiting to sync', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    render(<RegisterClient sheet={sheet()} />);
    await user.click(row('Pupil Number2'));
    await user.click(screen.getByRole('button', { name: 'Absent', pressed: false }));
    await user.click(screen.getByRole('button', { name: 'Save register' }));
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith(expect.stringMatching(/Saved on this phone/)));
    expect(await screen.findByRole('button', { name: /1 register waiting to sync/ })).toBeInTheDocument();
    const queued = await waiting(memory.store!);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.entries).toEqual([{ studentId: 's2', status: 'ABSENT', arrivalTime: null, reason: null }]);
  });

  it('sends what was saved offline when the signal returns', async () => {
    const user = userEvent.setup();
    const flaky = vi.fn(async (_u: string, init?: RequestInit) => {
      if (!navigator.onLine) throw new TypeError('Failed to fetch');
      const body = JSON.parse(String(init?.body));
      posts.push(body);
      return new Response(JSON.stringify({ success: true, data: { results: body.registers.map((r: { ref: string }) => ({ ref: r.ref, ok: true, outcome: 'created' })) } }), { status: 200 });
    });
    vi.stubGlobal('fetch', flaky);
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    render(<RegisterClient sheet={sheet()} />);
    await user.click(row('Pupil Number1'));
    await user.click(screen.getByRole('button', { name: 'Absent', pressed: false }));
    await user.click(screen.getByRole('button', { name: 'Save register' }));
    expect(await screen.findByRole('button', { name: /1 register waiting to sync/ })).toBeInTheDocument();
    expect(posts).toHaveLength(0);

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    window.dispatchEvent(new Event('online'));
    await waitFor(() => expect(posts).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('button', { name: /waiting to sync/ })).not.toBeInTheDocument());
    expect(await waiting(memory.store!)).toHaveLength(0);
  });

  it('asks for a reason when the register is from an earlier day', async () => {
    const user = userEvent.setup();
    render(<RegisterClient sheet={sheet({ editMode: 'REASON', editMessage: 'This register is from an earlier day. Give a reason for the change; it is logged.' })} />);
    expect(screen.getByText(/earlier day/)).toBeInTheDocument();
    await user.click(row('Pupil Number1'));
    await user.click(screen.getByRole('button', { name: 'Absent', pressed: false }));
    await user.click(screen.getByRole('button', { name: 'Save register' }));
    expect(toast.error).toHaveBeenCalledWith('Give a reason for changing this register.');
    expect(posts).toHaveLength(0);
    await user.type(screen.getByLabelText(/Reason for the change/), 'Forgot to mark yesterday');
    await user.click(screen.getByRole('button', { name: 'Save register' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.registers[0]!.correctionReason).toBe('Forgot to mark yesterday');
  });

  it('cannot be changed when the person may only look, or on a day without school', () => {
    const { rerender } = render(<RegisterClient sheet={sheet({ canMark: false })} />);
    expect(screen.queryByRole('button', { name: 'Save register' })).not.toBeInTheDocument();
    expect(screen.getByText(/look at this register but not change it/)).toBeInTheDocument();
    rerender(<RegisterClient sheet={sheet({ schoolDay: false, noSchoolReason: 'There is no school on this day (weekend).', students: [] })} />);
    expect(screen.getByText(/weekend/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark all present' })).not.toBeInTheDocument();
  });

  it('shows a register the server refused, with the reason', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ success: true, data: { results: body.registers.map((r: { ref: string }) => ({ ref: r.ref, ok: false, status: 409, message: 'Term 3 2026 is closed, so it cannot be changed' })) } }), { status: 200 });
    }));
    render(<RegisterClient sheet={sheet()} />);
    await user.click(row('Pupil Number1'));
    await user.click(screen.getByRole('button', { name: 'Absent', pressed: false }));
    await user.click(screen.getByRole('button', { name: 'Save register' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(await screen.findByText(/This register was not accepted/)).toBeInTheDocument();
    expect(screen.getByText(/is closed, so it cannot be changed/)).toBeInTheDocument();
  });
});
