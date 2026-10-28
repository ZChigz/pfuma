// The offline side of the hostel roll call, for the phone. A roll call is saved on the phone first (IndexedDB) and sent when there is signal, like
// the class register. Sending it twice is safe: the server keeps one roll call per hostel, day and session, and the queue item carries its own id.

export type RollMark = 'PRESENT' | 'ABSENT' | 'LATE';
export interface QueuedRollCall {
  /** One per hostel, day and session: saving again replaces what is waiting. */
  ref: string;
  hostelId: string;
  date: string;
  session: 'MORNING' | 'EVENING' | 'LIGHTS_OUT';
  entries: { studentId: string; status: RollMark; note?: string }[];
  clientId: string;
  label: string;
  state: 'PENDING' | 'FAILED';
  message?: string;
  savedAt: string;
}

export interface RollStore {
  put(r: QueuedRollCall): Promise<void>;
  get(ref: string): Promise<QueuedRollCall | undefined>;
  del(ref: string): Promise<void>;
  all(): Promise<QueuedRollCall[]>;
  putSheet(key: string, value: unknown): Promise<void>;
  getSheet<T = unknown>(key: string): Promise<T | undefined>;
  clear(): Promise<void>;
}

export function memoryRollStore(): RollStore {
  const queue = new Map<string, QueuedRollCall>();
  const sheets = new Map<string, unknown>();
  return {
    async put(r) { queue.set(r.ref, structuredClone(r)); },
    async get(ref) { const r = queue.get(ref); return r ? structuredClone(r) : undefined; },
    async del(ref) { queue.delete(ref); },
    async all() { return Array.from(queue.values()).map((r) => structuredClone(r)); },
    async putSheet(key, value) { sheets.set(key, structuredClone(value)); },
    async getSheet<T>(key: string) { const v = sheets.get(key); return v === undefined ? undefined : (structuredClone(v) as T); },
    async clear() { queue.clear(); sheets.clear(); },
  };
}

const DB_NAME = 'pfuma-hostel';

/** IndexedDB, opened when first used; memory when the browser refuses. */
export function idbRollStore(): RollStore {
  let opened: Promise<IDBDatabase> | null = null;
  const open = () => (opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('queue', { keyPath: 'ref' }); req.result.createObjectStore('sheets'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
  const run = async <T>(store: 'queue' | 'sheets', mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    return new Promise<T>((resolve, reject) => { const r = f(db.transaction(store, mode).objectStore(store)); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  };
  const fallback = memoryRollStore();
  const safe = async <T>(f: () => Promise<T>, g: () => Promise<T>): Promise<T> => { try { return await f(); } catch { return g(); } };
  return {
    put: (r) => safe(async () => { await run('queue', 'readwrite', (s) => s.put(r)); }, () => fallback.put(r)),
    get: (ref) => safe(() => run<QueuedRollCall | undefined>('queue', 'readonly', (s) => s.get(ref)), () => fallback.get(ref)),
    del: (ref) => safe(async () => { await run('queue', 'readwrite', (s) => s.delete(ref)); }, () => fallback.del(ref)),
    all: () => safe(() => run<QueuedRollCall[]>('queue', 'readonly', (s) => s.getAll()), () => fallback.all()),
    putSheet: (k, v) => safe(async () => { await run('sheets', 'readwrite', (s) => s.put(v, k)); }, () => fallback.putSheet(k, v)),
    getSheet: <T,>(k: string) => safe(() => run<T | undefined>('sheets', 'readonly', (s) => s.get(k)), () => fallback.getSheet<T>(k)),
    clear: () => safe(async () => { await run('queue', 'readwrite', (s) => s.clear()); await run('sheets', 'readwrite', (s) => s.clear()); }, () => fallback.clear()),
  };
}

export const rollRef = (hostelId: string, date: string, session: string) => `roll|${hostelId}|${date}|${session}`;
export const waitingRolls = async (store: RollStore) => (await store.all()).filter((r) => r.state === 'PENDING');

export async function queueRollCall(store: RollStore, r: Omit<QueuedRollCall, 'ref' | 'state' | 'savedAt' | 'message'>, now = new Date()): Promise<QueuedRollCall> {
  const item: QueuedRollCall = { ...r, ref: rollRef(r.hostelId, r.date, r.session), state: 'PENDING', savedAt: now.toISOString() };
  await store.put(item);
  return item;
}

export interface RollPostResult { status: number; json: { data?: { results?: { ref: string | null; ok: boolean; outcome?: string; message?: string; status?: number }[] } } | null }
export interface RollSync { saved: number; refused: number; waiting: number; offline: boolean }

/** Sends what is waiting. Never throws: no signal just leaves everything in the queue. */
export async function syncRollCalls(store: RollStore, post: (body: { rollCalls: unknown[] }) => Promise<RollPostResult>): Promise<RollSync> {
  const out: RollSync = { saved: 0, refused: 0, waiting: 0, offline: false };
  const items = await waitingRolls(store);
  for (let i = 0; i < items.length; i += 20) {
    const batch = items.slice(i, i + 20);
    let res: RollPostResult;
    try {
      res = await post({ rollCalls: batch.map((r) => ({ ref: r.ref, hostelId: r.hostelId, date: r.date, session: r.session, entries: r.entries, clientId: r.clientId })) });
    } catch {
      out.offline = true; out.waiting += items.length - i; return out;
    }
    const results = res.json?.data?.results;
    if (res.status !== 200 || !results) {
      out.offline = res.status === 0 || res.status >= 500 || res.status === 401 || res.status === 429; out.waiting += items.length - i; return out;
    }
    for (const item of batch) {
      const r = results.find((x) => x.ref === item.ref);
      if (!r) { out.waiting++; continue; }
      if (r.ok) {
        const now = await store.get(item.ref);
        if (now && now.savedAt === item.savedAt) await store.del(item.ref); else out.waiting++;
        out.saved++;
      } else if (r.status && r.status >= 400 && r.status < 500 && r.status !== 429) {
        await store.put({ ...item, state: 'FAILED', message: r.message ?? 'The server did not accept this roll call.' });
        out.refused++;
      } else out.waiting++;
    }
  }
  return out;
}

export const waitingRollText = (n: number) => (n === 1 ? '1 roll call waiting to sync' : `${n} roll calls waiting to sync`);
