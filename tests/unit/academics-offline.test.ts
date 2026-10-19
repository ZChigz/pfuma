// @vitest-environment node
// The offline queue of the register: saved on the phone first, sent when the signal returns, safe to send twice,
// refusals shown rather than retried for ever, and the count shown on the badge.
import { describe, expect, it } from 'vitest';
import { deviceId, failed, memoryStore, queueRegister, registerRef, syncQueue, waiting, waitingText, type NewRegister, type PostResult } from '@/lib/academics/offline';

const reg = (o: Partial<NewRegister> = {}): NewRegister => ({
  kind: 'DAILY', classId: 'c1', date: '2026-10-14', session: 'AM', entries: [{ studentId: 's1', status: 'ABSENT' }], changedAt: '2026-10-14T06:00:00.000Z', deviceId: 'dev-1', label: 'Form 1 North', ...o,
});
const ok = (refs: string[], extra: Record<string, unknown> = {}): PostResult => ({ status: 200, json: { data: { results: refs.map((ref) => ({ ref, ok: true, outcome: 'created', ...extra })) } } });

describe('the queue', () => {
  it('keeps one waiting register per class, day and session: saving again replaces it', async () => {
    const store = memoryStore();
    await queueRegister(store, reg());
    await queueRegister(store, reg({ entries: [{ studentId: 's1', status: 'PRESENT' }], changedAt: '2026-10-14T06:05:00.000Z' }));
    await queueRegister(store, reg({ session: 'PM' }));
    await queueRegister(store, reg({ classId: 'c2' }));
    await queueRegister(store, reg({ date: '2026-10-15' }));
    const items = await waiting(store);
    expect(items).toHaveLength(4);
    expect(items.find((i) => i.ref === registerRef('DAILY', 'c1', '2026-10-14', 'AM'))!.entries[0]!.status).toBe('PRESENT');
  });

  it('names a lesson register by its lesson and day', async () => {
    const store = memoryStore();
    const q = await queueRegister(store, reg({ kind: 'LESSON', slotId: 'slot1', classId: undefined, session: undefined }));
    expect(q.ref).toBe('lesson|slot1|2026-10-14');
  });

  it('says how many are waiting', () => {
    expect(waitingText(1)).toBe('1 register waiting to sync');
    expect(waitingText(3)).toBe('3 registers waiting to sync');
  });

  it('remembers this phone between visits', () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    const first = deviceId(storage);
    expect(first).toMatch(/^dev-/);
    expect(deviceId(storage)).toBe(first);
  });
});

describe('sending what is waiting', () => {
  it('sends everything in one go, removes what was saved and sends nothing the second time', async () => {
    const store = memoryStore();
    for (const c of ['c1', 'c2', 'c3']) await queueRegister(store, reg({ classId: c }));
    const bodies: { registers: { ref: string; classId: string; changedAt: string; deviceId: string }[] }[] = [];
    const post = async (body: { registers: unknown[] }) => { bodies.push(body as never); return ok((body.registers as { ref: string }[]).map((r) => r.ref)); };
    const s = await syncQueue(store, post);
    expect(s).toEqual({ saved: 3, refused: 0, waiting: 0, offline: false, keptNewer: 0 });
    expect(bodies[0]!.registers).toHaveLength(3);
    expect(bodies[0]!.registers[0]).toMatchObject({ classId: 'c1', deviceId: 'dev-1', changedAt: '2026-10-14T06:00:00.000Z' });
    expect(await waiting(store)).toHaveLength(0);
    expect(await syncQueue(store, post)).toMatchObject({ saved: 0 });
    expect(bodies).toHaveLength(1);
  });

  it('keeps everything when there is no signal, and says so', async () => {
    const store = memoryStore();
    await queueRegister(store, reg());
    await queueRegister(store, reg({ classId: 'c2' }));
    const s = await syncQueue(store, async () => { throw new TypeError('Failed to fetch'); });
    expect(s).toMatchObject({ saved: 0, waiting: 2, offline: true });
    expect(await waiting(store)).toHaveLength(2);
  });

  it('keeps everything when the server is busy or the person has been signed out', async () => {
    const store = memoryStore();
    await queueRegister(store, reg());
    for (const status of [500, 502, 401, 429]) {
      const s = await syncQueue(store, async () => ({ status, json: null }));
      expect(s).toMatchObject({ saved: 0, waiting: 1, offline: true });
    }
    expect(await waiting(store)).toHaveLength(1);
  });

  it('shows a refused register instead of retrying it for ever', async () => {
    const store = memoryStore();
    const q = await queueRegister(store, reg());
    const s = await syncQueue(store, async () => ({ status: 200, json: { data: { results: [{ ref: q.ref, ok: false, status: 409, message: 'There is no school on this day (weekend).' }] } } }));
    expect(s).toMatchObject({ saved: 0, refused: 1, waiting: 0 });
    expect(await waiting(store)).toHaveLength(0);
    const f = await failed(store);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ state: 'FAILED', message: 'There is no school on this day (weekend).' });
    // The teacher fixes it and saves again: it goes back in the queue.
    await queueRegister(store, reg({ changedAt: '2026-10-14T07:00:00.000Z' }));
    expect(await waiting(store)).toHaveLength(1);
    expect(await failed(store)).toHaveLength(0);
  });

  it('keeps one waiting when it fails for a reason that may pass (server error for that register)', async () => {
    const store = memoryStore();
    const a = await queueRegister(store, reg());
    const b = await queueRegister(store, reg({ classId: 'c2' }));
    const s = await syncQueue(store, async () => ({ status: 200, json: { data: { results: [{ ref: a.ref, ok: true, outcome: 'created' }, { ref: b.ref, ok: false, status: 500, message: 'Try again' }] } } }));
    expect(s).toMatchObject({ saved: 1, waiting: 1, refused: 0 });
    expect((await waiting(store)).map((x) => x.ref)).toEqual([b.ref]);
  });

  it('counts registers where the server already had a newer version', async () => {
    const store = memoryStore();
    const q = await queueRegister(store, reg());
    const s = await syncQueue(store, async () => ({ status: 200, json: { data: { results: [{ ref: q.ref, ok: true, outcome: 'kept_newer' }] } } }));
    expect(s).toMatchObject({ saved: 1, keptNewer: 1 });
    expect(await waiting(store)).toHaveLength(0);
  });

  it('does not lose a register that the phone changed again while it was being sent', async () => {
    const store = memoryStore();
    const q = await queueRegister(store, reg());
    const s = await syncQueue(store, async (body) => {
      await queueRegister(store, reg({ entries: [{ studentId: 's1', status: 'PRESENT' }], changedAt: '2026-10-14T06:10:00.000Z' }));
      return ok((body.registers as { ref: string }[]).map((r) => r.ref));
    });
    expect(s.saved).toBe(1);
    const left = await waiting(store);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ ref: q.ref, changedAt: '2026-10-14T06:10:00.000Z' });
  });

  it('sends a big backlog in batches of 20', async () => {
    const store = memoryStore();
    for (let i = 0; i < 45; i++) await queueRegister(store, reg({ classId: `c${i}` }));
    const sizes: number[] = [];
    const s = await syncQueue(store, async (body) => { sizes.push(body.registers.length); return ok((body.registers as { ref: string }[]).map((r) => r.ref)); });
    expect(sizes).toEqual([20, 20, 5]);
    expect(s.saved).toBe(45);
  });

  it('stops at the first batch the signal drops on and keeps the rest', async () => {
    const store = memoryStore();
    for (let i = 0; i < 30; i++) await queueRegister(store, reg({ classId: `c${i}` }));
    let calls = 0;
    const s = await syncQueue(store, async (body) => {
      calls++;
      if (calls === 2) throw new TypeError('Failed to fetch');
      return ok((body.registers as { ref: string }[]).map((r) => r.ref));
    });
    expect(s).toMatchObject({ saved: 20, waiting: 10, offline: true });
    expect(await waiting(store)).toHaveLength(10);
  });

  it('can forget everything on a shared phone', async () => {
    const store = memoryStore();
    await queueRegister(store, reg());
    await store.putSheet('k', { a: 1 });
    await store.clear();
    expect(await waiting(store)).toHaveLength(0);
    expect(await store.getSheet('k')).toBeUndefined();
  });
});
