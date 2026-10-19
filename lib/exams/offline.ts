// The offline side of mark entry, for the browser. Every cell a teacher types is written to IndexedDB on the device first, then sent;
// on a bad connection nothing is lost and "Offline, saved on this device" shows until the signal returns. The server decides which
// of two versions of a cell wins (the later changedAt), so sending the same cells twice is always safe.
//
// The storage is behind a small interface so the queue can be tested without a browser (memoryStore).
import type { TypedCode } from '@/lib/exams/cell';

export interface PendingCell {
  studentId: string;
  assessmentId: string;
  stageId: string | null;
  value: number | null;
  code: TypedCode | null;
  /** When the teacher typed it on this device. */
  changedAt: string;
}

export interface QueuedBatch {
  /** One batch per mark sheet: new cells replace older ones for the same cell. */
  ref: string;
  assignmentId: string;
  cells: Record<string, PendingCell>;
  /** Why the marks are being changed (needed once the sheet has been submitted before). */
  reason: string | null;
  savedAt: string;
  state: 'PENDING' | 'FAILED';
  message?: string;
}

export interface MarkStore {
  get(ref: string): Promise<QueuedBatch | undefined>;
  put(batch: QueuedBatch): Promise<void>;
  delete(ref: string): Promise<void>;
  all(): Promise<QueuedBatch[]>;
  putGrid(key: string, value: unknown): Promise<void>;
  getGrid<T = unknown>(key: string): Promise<T | undefined>;
}

export function memoryMarkStore(): MarkStore {
  const batches = new Map<string, QueuedBatch>();
  const grids = new Map<string, unknown>();
  return {
    async get(ref) { const b = batches.get(ref); return b ? structuredClone(b) : undefined; },
    async put(batch) { batches.set(batch.ref, structuredClone(batch)); },
    async delete(ref) { batches.delete(ref); },
    async all() { return Array.from(batches.values()).map((b) => structuredClone(b)); },
    async putGrid(key, value) { grids.set(key, structuredClone(value)); },
    async getGrid<T>(key: string) { const v = grids.get(key); return v === undefined ? undefined : (structuredClone(v) as T); },
  };
}

const DB_NAME = 'pfuma-exams';

/** IndexedDB, opened when first used. */
export function idbMarkStore(): MarkStore {
  let opened: Promise<IDBDatabase> | null = null;
  const open = () => (opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('batches', { keyPath: 'ref' });
      req.result.createObjectStore('grids');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
  const run = async <T,>(store: 'batches' | 'grids', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
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
    async get(ref) { return run<QueuedBatch | undefined>('batches', 'readonly', (s) => s.get(ref)); },
    async put(batch) { await run('batches', 'readwrite', (s) => s.put(batch)); },
    async delete(ref) { await run('batches', 'readwrite', (s) => s.delete(ref)); },
    async all() { return run<QueuedBatch[]>('batches', 'readonly', (s) => s.getAll()); },
    async putGrid(key, value) { await run('grids', 'readwrite', (s) => s.put(value, key)); },
    async getGrid<T>(key: string) { return run<T | undefined>('grids', 'readonly', (s) => s.get(key)); },
  };
}

export const cellId = (c: Pick<PendingCell, 'studentId' | 'assessmentId' | 'stageId'>) => `${c.studentId}|${c.assessmentId}|${c.stageId ?? ''}`;

/** Adds cells to the sheet's waiting batch. A cell typed again replaces the older version; the reason is kept with the batch. */
export async function enqueue(store: MarkStore, assignmentId: string, cells: PendingCell[], reason: string | null, now = new Date()): Promise<QueuedBatch> {
  const existing = await store.get(assignmentId);
  const merged: Record<string, PendingCell> = { ...(existing?.cells ?? {}) };
  for (const c of cells) {
    const key = cellId(c);
    const prev = merged[key];
    if (!prev || prev.changedAt <= c.changedAt) merged[key] = c;
  }
  const batch: QueuedBatch = { ref: assignmentId, assignmentId, cells: merged, reason: reason ?? existing?.reason ?? null, savedAt: now.toISOString(), state: 'PENDING' };
  await store.put(batch);
  return batch;
}

export async function setReason(store: MarkStore, assignmentId: string, reason: string): Promise<void> {
  const b = await store.get(assignmentId);
  if (b) await store.put({ ...b, reason });
}

export function waitingCount(batches: QueuedBatch[]): number {
  return batches.reduce((n, b) => n + Object.keys(b.cells).length, 0);
}

export interface Outcome { key: string; status: 'saved' | 'unchanged' | 'rejected' | 'stale'; message?: string; value?: number | null; code?: string | null }
export interface SyncResponse { status: number; json: { success?: boolean; message?: string; data?: { ref: string; ok: boolean; message?: string; result?: { outcomes: Outcome[]; warnings: { key: string; message: string }[]; sheet: { status: string; entered: number; expected: number } } }[] } | null }

export interface FlushResult {
  /** Nothing could be sent: there is no connection (or the server asked to slow down). */
  offline: boolean;
  /** Cells the server took (saved or already the same). */
  sent: number;
  /** What happened to cells the server refused or found stale, by sheet. */
  outcomes: Map<string, Outcome[]>;
  warnings: Map<string, { key: string; message: string }[]>;
  /** Sheets whose whole batch was refused (locked, no reason, signed out ...), with the reason. */
  failed: Map<string, string>;
  sheets: Map<string, { status: string; entered: number; expected: number }>;
}

/**
 * Sends every waiting batch. Cells the server took are removed from the queue (unless the teacher typed them again meanwhile);
 * refused or stale cells are removed too and reported, so they are shown once and never retried forever. A batch the server
 * refuses as a whole stays on the device, marked FAILED, so no work is lost.
 */
export async function flush(store: MarkStore, post: (batches: unknown[]) => Promise<SyncResponse>, opts: { skipRef?: (b: QueuedBatch) => boolean } = {}): Promise<FlushResult> {
  const result: FlushResult = { offline: false, sent: 0, outcomes: new Map(), warnings: new Map(), failed: new Map(), sheets: new Map() };
  const waiting = (await store.all()).filter((b) => Object.keys(b.cells).length > 0 && !opts.skipRef?.(b));
  if (waiting.length === 0) return result;
  let res: SyncResponse;
  try {
    res = await post(waiting.map((b) => ({ ref: b.ref, assignmentId: b.assignmentId, reason: b.reason, source: 'grid', cells: Object.values(b.cells) })));
  } catch {
    result.offline = true;
    return result;
  }
  if (res.status === 0 || res.status === 429 || res.status >= 500) { result.offline = true; return result; }
  if (res.status !== 200 || !res.json?.data) {
    for (const b of waiting) {
      const message = res.json?.message ?? 'The marks were not accepted.';
      await store.put({ ...b, state: 'FAILED', message });
      result.failed.set(b.ref, message);
    }
    return result;
  }
  for (const item of res.json.data) {
    const sent = waiting.find((b) => b.ref === item.ref);
    if (!sent) continue;
    if (!item.ok || !item.result) {
      const message = item.message ?? 'The marks were not accepted.';
      // The sheet may have been locked: keep the work on the device, with the reason.
      const current = (await store.get(sent.ref)) ?? sent;
      await store.put({ ...current, state: 'FAILED', message });
      result.failed.set(sent.ref, message);
      continue;
    }
    const current = (await store.get(sent.ref)) ?? sent;
    const remaining: Record<string, PendingCell> = {};
    for (const [key, cell] of Object.entries(current.cells)) {
      const was = sent.cells[key];
      if (!was || was.changedAt !== cell.changedAt) remaining[key] = cell; // typed again while sending
    }
    if (Object.keys(remaining).length === 0) await store.delete(sent.ref);
    else await store.put({ ...current, cells: remaining, state: 'PENDING', message: undefined });
    result.sent += item.result.outcomes.filter((o) => o.status === 'saved' || o.status === 'unchanged').length;
    result.outcomes.set(sent.ref, item.result.outcomes.filter((o) => o.status === 'rejected' || o.status === 'stale'));
    result.warnings.set(sent.ref, item.result.warnings);
    result.sheets.set(sent.ref, item.result.sheet);
  }
  return result;
}

/** The text of the save indicator. */
export type SaveState = 'saved' | 'saving' | 'offline' | 'error' | 'unsaved';
export const SAVE_TEXT: Record<SaveState, string> = {
  saved: 'Saved',
  saving: 'Saving...',
  offline: 'Offline, saved on this device',
  error: 'Not saved: see the message',
  unsaved: 'Saving soon...',
};

export function deviceId(): string {
  try {
    const k = 'pfuma-device';
    let id = localStorage.getItem(k);
    if (!id) { id = Math.random().toString(36).slice(2, 12); localStorage.setItem(k, id); }
    return id;
  } catch {
    return 'unknown';
  }
}
