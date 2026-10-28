// The offline side of the register, for the browser. A register is saved on the phone first (IndexedDB) and sent when there is
// signal; "3 registers waiting to sync" is the number still in the queue. The server decides which of two versions wins
// (the later changedAt) and keeps both in the audit log, so sending a register twice is always safe.
//
// The storage is behind a small interface so the queue can be tested without a browser (memoryStore).

export type MarkStatus = 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED' | 'SUSPENDED' | 'EXEAT' | 'SICK_BAY';
export interface DraftEntry { studentId: string; status: MarkStatus; reason?: string | null; arrivalTime?: string | null }

export interface QueuedRegister {
  /** One per class, day and session (or lesson and day): saving again replaces what is waiting. */
  ref: string;
  kind: 'DAILY' | 'LESSON';
  classId?: string;
  slotId?: string;
  date: string;
  session?: 'AM' | 'PM';
  entries: DraftEntry[];
  /** When the marks were last changed on this phone. The later change wins on the server. */
  changedAt: string;
  deviceId: string;
  correctionReason?: string;
  label: string;
  state: 'PENDING' | 'FAILED';
  message?: string;
  savedAt: string;
}

export interface Store {
  putQueued(r: QueuedRegister): Promise<void>;
  getQueued(ref: string): Promise<QueuedRegister | undefined>;
  deleteQueued(ref: string): Promise<void>;
  allQueued(): Promise<QueuedRegister[]>;
  putSheet(key: string, value: unknown): Promise<void>;
  getSheet<T = unknown>(key: string): Promise<T | undefined>;
  clear(): Promise<void>;
}

export function memoryStore(): Store {
  const queue = new Map<string, QueuedRegister>();
  const sheets = new Map<string, unknown>();
  return {
    async putQueued(r) { queue.set(r.ref, structuredClone(r)); },
    async getQueued(ref) { const r = queue.get(ref); return r ? structuredClone(r) : undefined; },
    async deleteQueued(ref) { queue.delete(ref); },
    async allQueued() { return Array.from(queue.values()).map((r) => structuredClone(r)); },
    async putSheet(key, value) { sheets.set(key, structuredClone(value)); },
    async getSheet<T>(key: string) { const v = sheets.get(key); return v === undefined ? undefined : (structuredClone(v) as T); },
    async clear() { queue.clear(); sheets.clear(); },
  };
}

const DB_NAME = 'pfuma-academics';

/** IndexedDB, opened when first used. Falls back to memory (nothing survives a reload) if the browser refuses. */
export function idbStore(): Store {
  let opened: Promise<IDBDatabase> | null = null;
  const open = () => (opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('queue', { keyPath: 'ref' });
      req.result.createObjectStore('sheets');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
  const run = async <T,>(store: 'queue' | 'sheets', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };
  return {
    async putQueued(r) { await run('queue', 'readwrite', (s) => s.put(r)); },
    async getQueued(ref) { return run<QueuedRegister | undefined>('queue', 'readonly', (s) => s.get(ref)); },
    async deleteQueued(ref) { await run('queue', 'readwrite', (s) => s.delete(ref)); },
    async allQueued() { return run<QueuedRegister[]>('queue', 'readonly', (s) => s.getAll()); },
    async putSheet(key, value) { await run('sheets', 'readwrite', (s) => s.put(value, key)); },
    async getSheet<T>(key: string) { return run<T | undefined>('sheets', 'readonly', (s) => s.get(key)); },
    async clear() { await run('queue', 'readwrite', (s) => s.clear()); await run('sheets', 'readwrite', (s) => s.clear()); },
  };
}

/** A name for this phone, kept between visits, so the server can tell two devices apart. */
export function deviceId(storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): string {
  try {
    const have = storage?.getItem('pfuma-device');
    if (have) return have;
    const id = `dev-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    storage?.setItem('pfuma-device', id);
    return id;
  } catch {
    return `dev-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export const registerRef = (kind: 'DAILY' | 'LESSON', id: string, date: string, session?: string) => (kind === 'DAILY' ? `daily|${id}|${date}|${session ?? 'AM'}` : `lesson|${id}|${date}`);
export const sheetKey = registerRef;

export type NewRegister = Omit<QueuedRegister, 'ref' | 'state' | 'savedAt' | 'message'>;

/** Puts the register in the queue (replacing any earlier one for the same class and day) and returns it. */
export async function queueRegister(store: Store, r: NewRegister, now = new Date()): Promise<QueuedRegister> {
  const ref = registerRef(r.kind, (r.kind === 'DAILY' ? r.classId : r.slotId) ?? '', r.date, r.session);
  const item: QueuedRegister = { ...r, ref, state: 'PENDING', savedAt: now.toISOString() };
  await store.putQueued(item);
  return item;
}

export const waiting = async (store: Store) => (await store.allQueued()).filter((r) => r.state === 'PENDING');
export const failed = async (store: Store) => (await store.allQueued()).filter((r) => r.state === 'FAILED');

export interface PostResult { status: number; json: { data?: { results?: { ref: string | null; ok: boolean; outcome?: string; message?: string; status?: number }[] }; message?: string } | null }
export interface SyncSummary {
  /** Sent and saved (including "a newer version was already there"). */
  saved: number;
  /** Refused by the server for a reason that will not change by trying again (shown to the teacher). */
  refused: number;
  /** Still waiting: there was no signal, or the server was busy. */
  waiting: number;
  offline: boolean;
  /** Registers the server kept a newer version of. */
  keptNewer: number;
}

const BATCH = 20;

const payloadOf = (r: QueuedRegister) => ({
  ref: r.ref,
  ...(r.kind === 'DAILY' ? { classId: r.classId, session: r.session } : { slotId: r.slotId }),
  date: r.date, entries: r.entries, changedAt: r.changedAt, deviceId: r.deviceId, correctionReason: r.correctionReason,
});

/** Sends what is waiting. Never throws: no signal just leaves everything in the queue. */
export async function syncQueue(store: Store, post: (body: { registers: unknown[] }) => Promise<PostResult>): Promise<SyncSummary> {
  const out: SyncSummary = { saved: 0, refused: 0, waiting: 0, offline: false, keptNewer: 0 };
  const items = await waiting(store);
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    let res: PostResult;
    try {
      res = await post({ registers: batch.map(payloadOf) });
    } catch {
      out.offline = true;
      out.waiting += items.length - i;
      return out;
    }
    const results = res.json?.data?.results;
    if (res.status !== 200 || !results) {
      // Signed out, rate limited or the server is down: try again later, change nothing.
      out.offline = res.status === 0 || res.status >= 500 || res.status === 401 || res.status === 429;
      out.waiting += items.length - i;
      return out;
    }
    for (const item of batch) {
      const r = results.find((x) => x.ref === item.ref);
      if (!r) { out.waiting++; continue; }
      if (r.ok) {
        // If the phone changed it again while this was in flight, the newer version stays queued.
        const now = await store.getQueued(item.ref);
        if (now && now.changedAt === item.changedAt) await store.deleteQueued(item.ref);
        else out.waiting++;
        out.saved++;
        if (r.outcome === 'kept_newer') out.keptNewer++;
      } else if (r.status && r.status >= 400 && r.status < 500 && r.status !== 429) {
        await store.putQueued({ ...item, state: 'FAILED', message: r.message ?? 'The server did not accept this register.' });
        out.refused++;
      } else {
        out.waiting++;
      }
    }
  }
  return out;
}

/** "3 registers waiting to sync" */
export function waitingText(n: number): string {
  return n === 1 ? '1 register waiting to sync' : `${n} registers waiting to sync`;
}

/** A device-local HH:MM for the arrival time of a late student. */
export function nowHm(d = new Date()): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** How many registers on this phone are still waiting to be sent (0 where IndexedDB is not available). */
export async function pendingCount(): Promise<number> {
  try { return (await waiting(idbStore())).length; } catch { return 0; }
}

/** Forgets the saved registers and the cached pages on this phone (used when someone logs out of a shared phone). */
export async function clearOfflineData(): Promise<void> {
  try { await idbStore().clear(); } catch { /* nothing saved */ }
  try { if (typeof caches !== 'undefined') await caches.delete('pfuma-register-v1'); } catch { /* no cache */ }
}
