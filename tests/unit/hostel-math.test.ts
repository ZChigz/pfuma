import { describe, expect, it } from 'vitest';
import { planFill, type Candidate, type FreeRoom } from '@/lib/facilities/hostel-math';
import { memoryRollStore, queueRollCall, rollRef, syncRollCalls, waitingRolls, waitingRollText } from '@/lib/facilities/rollcall-offline';

const kid = (id: string, level: number, name = id): Candidate => ({ id, name, levelOrder: level, classId: `c${level}`, className: `Form ${level}` });
const room = (roomId: string, beds: number, floor: string | null = null): FreeRoom => ({ roomId, name: roomId, floor, free: Array.from({ length: beds }, (_, i) => `${roomId}-${i + 1}`) });

describe('filling a hostel', () => {
  it('keeps forms together: a form takes the rooms it started, then the next empty room', () => {
    const kids = [kid('a1', 1), kid('a2', 1), kid('a3', 1), kid('b1', 2), kid('b2', 2), kid('c1', 3)];
    const { placements, unplaced } = planFill(kids, [room('R1', 2), room('R2', 2), room('R3', 2)], true);
    expect(unplaced).toEqual([]);
    const roomOf = (id: string) => placements.find((p) => p.studentId === id)!.roomId;
    expect(new Set(['a1', 'a2'].map(roomOf)).size).toBe(1);
    expect(roomOf('a3')).toBe('R2');
    // Form 2 does not share the room Form 1 only half filled while an empty room remains.
    expect(roomOf('b1')).toBe('R3');
    expect(roomOf('b2')).toBe('R3');
    // Form 3 has no room of its own left, so it shares one rather than going without.
    expect(placements.find((p) => p.studentId === 'c1')).toBeTruthy();
  });

  it('without that, spreads the learners over the free beds in name order', () => {
    const { placements } = planFill([kid('Zed', 1), kid('Amy', 2), kid('Bob', 1)], [room('R1', 2), room('R2', 2)], false);
    expect(placements.map((p) => [p.studentId, p.bedId])).toEqual([['Amy', 'R1-1'], ['Bob', 'R1-2'], ['Zed', 'R2-1']]);
  });

  it('gives nobody a bed that does not exist, and says who is left', () => {
    const { placements, unplaced } = planFill([kid('a', 1), kid('b', 1), kid('c', 1)], [room('R1', 2)], true);
    expect(placements).toHaveLength(2);
    expect(unplaced).toEqual(['c']);
    expect(planFill([kid('a', 1)], [], true)).toEqual({ placements: [], unplaced: ['a'] });
    expect(new Set(placements.map((p) => p.bedId)).size).toBe(placements.length);
  });

  it('orders rooms by floor and then by number as a person reads them', () => {
    const { placements } = planFill([kid('a', 1)], [room('Room 10', 1, 'First'), room('Room 2', 1, 'First'), room('Room 1', 1, 'Second')], true);
    expect(placements[0]!.roomId).toBe('Room 2');
  });
});

describe('the roll call on the phone', () => {
  const entries = [{ studentId: 's1', status: 'ABSENT' as const }];
  const base = { hostelId: 'h1', date: '2026-10-27', session: 'LIGHTS_OUT' as const, entries, clientId: 'c-1', label: 'Boys hostel' };

  it('is kept on the phone until it is sent, and saving again replaces what is waiting', async () => {
    const store = memoryRollStore();
    await queueRollCall(store, base);
    await queueRollCall(store, { ...base, entries: [], clientId: 'c-2' });
    const w = await waitingRolls(store);
    expect(w).toHaveLength(1);
    expect(w[0]!.ref).toBe(rollRef('h1', '2026-10-27', 'LIGHTS_OUT'));
    expect(w[0]!.entries).toEqual([]);
    expect(waitingRollText(1)).toBe('1 roll call waiting to sync');
    expect(waitingRollText(3)).toBe('3 roll calls waiting to sync');
  });

  it('is sent when there is signal and removed from the queue once saved', async () => {
    const store = memoryRollStore();
    const item = await queueRollCall(store, base);
    const r = await syncRollCalls(store, async () => ({ status: 200, json: { data: { results: [{ ref: item.ref, ok: true, outcome: 'created' }] } } }));
    expect(r).toEqual({ saved: 1, refused: 0, waiting: 0, offline: false });
    expect(await waitingRolls(store)).toHaveLength(0);
  });

  it('with no signal everything stays in the queue, and nothing is thrown', async () => {
    const store = memoryRollStore();
    await queueRollCall(store, base);
    const down = await syncRollCalls(store, async () => { throw new Error('offline'); });
    expect(down).toMatchObject({ saved: 0, waiting: 1, offline: true });
    const busy = await syncRollCalls(store, async () => ({ status: 503, json: null }));
    expect(busy).toMatchObject({ waiting: 1, offline: true });
    expect(await waitingRolls(store)).toHaveLength(1);
  });

  it('a roll call the server refuses is kept as failed with its message, and not sent again', async () => {
    const store = memoryRollStore();
    const item = await queueRollCall(store, base);
    const r = await syncRollCalls(store, async () => ({ status: 200, json: { data: { results: [{ ref: item.ref, ok: false, status: 422, message: 'One of the learners does not sleep in this hostel' }] } } }));
    expect(r).toMatchObject({ refused: 1, waiting: 0 });
    expect((await store.all())[0]).toMatchObject({ state: 'FAILED', message: 'One of the learners does not sleep in this hostel' });
    expect(await waitingRolls(store)).toHaveLength(0);
  });

  it('a roll call changed on the phone while it was being sent stays queued', async () => {
    const store = memoryRollStore();
    const item = await queueRollCall(store, base, new Date('2026-10-27T20:00:00Z'));
    const r = await syncRollCalls(store, async () => {
      await queueRollCall(store, { ...base, entries: [] }, new Date('2026-10-27T20:01:00Z'));
      return { status: 200, json: { data: { results: [{ ref: item.ref, ok: true }] } } };
    });
    expect(r.saved).toBe(1);
    expect(r.waiting).toBe(1);
    expect(await waitingRolls(store)).toHaveLength(1);
  });
});
