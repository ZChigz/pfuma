// @vitest-environment node
// What a mark cell accepts, and the offline queue that keeps typed marks safe until they are sent.
import { describe, expect, it } from 'vitest';
import { cellText, parseCell, parsePaste } from '@/lib/exams/cell';
import { enqueue, flush, memoryMarkStore, waitingCount, type SyncResponse } from '@/lib/exams/offline';

describe('a mark cell', () => {
  it('accepts a number up to the maximum, with a comma or a point for decimals', () => {
    expect(parseCell('38', 50)).toEqual({ ok: true, cell: { value: 38, code: null } });
    expect(parseCell(' 12,5 ', 50)).toEqual({ ok: true, cell: { value: 12.5, code: null } });
    expect(parseCell('50', 50)).toMatchObject({ ok: true });
    expect(parseCell('0', 50)).toEqual({ ok: true, cell: { value: 0, code: null } });
  });
  it('accepts AB, EX and NS in any case, and empty to clear', () => {
    expect(parseCell('ab', 50)).toEqual({ ok: true, cell: { value: null, code: 'AB' } });
    expect(parseCell('Ex', 50)).toEqual({ ok: true, cell: { value: null, code: 'EX' } });
    expect(parseCell('NS', 50)).toEqual({ ok: true, cell: { value: null, code: 'NS' } });
    expect(parseCell('  ', 50)).toEqual({ ok: true, cell: { value: null, code: null } });
  });
  it('refuses a mark above the maximum, a negative number and text, with a message for the cell', () => {
    expect(parseCell('51', 50)).toEqual({ ok: false, message: 'Above the maximum of 50' });
    expect(parseCell('-3', 50)).toEqual({ ok: false, message: 'A mark cannot be negative' });
    expect(parseCell('abc', 50)).toEqual({ ok: false, message: 'Enter a number, or AB, EX or NS' });
    expect(parseCell('12.345', 50)).toEqual({ ok: false, message: 'Use at most two decimal places' });
    expect(parseCell('AB*', 50)).toMatchObject({ ok: false });
  });
  it('shows a stored mark in its cell', () => {
    expect(cellText({ value: 38, code: null })).toBe('38');
    expect(cellText({ value: null, code: 'NS' })).toBe('NS');
    expect(cellText({ value: null, code: 'AB_EXCUSED' })).toBe('AB*');
    expect(cellText(undefined)).toBe('');
  });
  it('splits a column pasted from Excel into rows and columns', () => {
    expect(parsePaste('10\r\n20\r\n30\r\n')).toEqual([['10'], ['20'], ['30']]);
    expect(parsePaste('1\t2\n3\t4')).toEqual([['1', '2'], ['3', '4']]);
  });
});

const cell = (studentId: string, value: number | null, changedAt: string) => ({ studentId, assessmentId: 'a1', stageId: null, value, code: null, changedAt });
const ok = (ref: string, keys: string[]): SyncResponse => ({
  status: 200,
  json: { success: true, data: [{ ref, ok: true, result: { outcomes: keys.map((key) => ({ key, status: 'saved' as const })), warnings: [], sheet: { status: 'IN_PROGRESS', entered: keys.length, expected: 45 } } }] },
});

describe('the offline queue', () => {
  it('keeps the latest version of a cell typed twice, and counts what is waiting', async () => {
    const store = memoryMarkStore();
    await enqueue(store, 'asg', [cell('s1', 10, '2026-10-01T08:00:00Z'), cell('s2', 20, '2026-10-01T08:00:01Z')], null);
    await enqueue(store, 'asg', [cell('s1', 15, '2026-10-01T08:00:05Z')], null);
    const [b] = await store.all();
    expect(waitingCount([b!])).toBe(2);
    expect(b!.cells['s1|a1|']!.value).toBe(15);
  });

  it('does not let an older version replace a newer one', async () => {
    const store = memoryMarkStore();
    await enqueue(store, 'asg', [cell('s1', 15, '2026-10-01T08:00:05Z')], null);
    await enqueue(store, 'asg', [cell('s1', 10, '2026-10-01T08:00:00Z')], null);
    expect((await store.get('asg'))!.cells['s1|a1|']!.value).toBe(15);
  });

  it('keeps everything on the device when there is no connection', async () => {
    const store = memoryMarkStore();
    await enqueue(store, 'asg', [cell('s1', 10, '2026-10-01T08:00:00Z')], null);
    const r = await flush(store, async () => { throw new TypeError('Failed to fetch'); });
    expect(r.offline).toBe(true);
    expect(waitingCount(await store.all())).toBe(1);
    // and when the server is down or asks to slow down
    expect((await flush(store, async () => ({ status: 503, json: null }))).offline).toBe(true);
    expect((await flush(store, async () => ({ status: 429, json: null }))).offline).toBe(true);
    expect(waitingCount(await store.all())).toBe(1);
  });

  it('sends what is waiting once, and clears it when the server took it', async () => {
    const store = memoryMarkStore();
    await enqueue(store, 'asg', [cell('s1', 10, '2026-10-01T08:00:00Z'), cell('s2', 12, '2026-10-01T08:00:00Z')], 'Re-marked');
    let sentBody: unknown[] = [];
    const r = await flush(store, async (batches) => { sentBody = batches; return ok('asg', ['s1|a1|', 's2|a1|']); });
    expect(r).toMatchObject({ offline: false, sent: 2 });
    expect(await store.all()).toEqual([]);
    expect(sentBody[0]).toMatchObject({ ref: 'asg', assignmentId: 'asg', reason: 'Re-marked', source: 'grid' });
    expect(((sentBody[0] as { cells: unknown[] }).cells)).toHaveLength(2);
    // nothing left: a second flush sends nothing
    let calls = 0;
    await flush(store, async () => { calls++; return ok('asg', []); });
    expect(calls).toBe(0);
  });

  it('keeps a cell typed again while the first version was being sent', async () => {
    const store = memoryMarkStore();
    await enqueue(store, 'asg', [cell('s1', 10, '2026-10-01T08:00:00Z')], null);
    await flush(store, async () => {
      await enqueue(store, 'asg', [cell('s1', 11, '2026-10-01T08:00:09Z')], null);
      return ok('asg', ['s1|a1|']);
    });
    const left = await store.get('asg');
    expect(left!.cells['s1|a1|']!.value).toBe(11);
  });

  it('reports refused and stale cells once and does not retry them', async () => {
    const store = memoryMarkStore();
    await enqueue(store, 'asg', [cell('s1', 99, '2026-10-01T08:00:00Z'), cell('s2', 5, '2026-10-01T08:00:00Z')], null);
    const r = await flush(store, async () => ({
      status: 200,
      json: { success: true, data: [{ ref: 'asg', ok: true, result: { outcomes: [{ key: 's1|a1|', status: 'rejected' as const, message: 'Above the maximum of 50' }, { key: 's2|a1|', status: 'stale' as const, message: 'newer', value: 7 }], warnings: [], sheet: { status: 'IN_PROGRESS', entered: 0, expected: 2 } } }] },
    }));
    expect(r.outcomes.get('asg')).toHaveLength(2);
    expect(await store.all()).toEqual([]);
  });

  it('keeps the work on the device, marked failed, when the whole sheet is refused (locked)', async () => {
    const store = memoryMarkStore();
    await enqueue(store, 'asg', [cell('s1', 10, '2026-10-01T08:00:00Z')], null);
    const r = await flush(store, async () => ({ status: 200, json: { success: true, data: [{ ref: 'asg', ok: false, message: 'This mark sheet is verified, so marks cannot be changed.' }] } }));
    expect(r.failed.get('asg')).toMatch(/verified/);
    const b = await store.get('asg');
    expect(b).toMatchObject({ state: 'FAILED', message: expect.stringMatching(/verified/) });
    expect(waitingCount([b!])).toBe(1);
  });

  it('keeps the work when the server refuses the request (signed out)', async () => {
    const store = memoryMarkStore();
    await enqueue(store, 'asg', [cell('s1', 10, '2026-10-01T08:00:00Z')], null);
    const r = await flush(store, async () => ({ status: 401, json: { success: false, message: 'Unauthorized' } }));
    expect(r.failed.get('asg')).toBe('Unauthorized');
    expect(waitingCount(await store.all())).toBe(1);
  });
});
