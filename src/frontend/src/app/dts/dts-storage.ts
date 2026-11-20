import type { DtsAction, DtsCursor, DtsNoteEvent, DtsOp, DtsState } from './dts.models';

/** Everything the sign page keeps on the device for one session. */
export interface DtsLocal {
  id: string;
  signKey: string;
  /** Kept so a restore of this copy keeps the session's manage hash; it opens no endpoint. */
  manageHash: string;
  xml: string;
  deviceId: string;
  deviceName: string;
  /** False while a device that joined by scanning has not yet been asked who is signing; absent means asked. */
  nameAsked?: boolean;
  /** Every operation known on this device, own and pulled, by id. */
  ops: Record<string, DtsOp>;
  actions: Record<string, DtsAction>;
  noteEvents: Record<string, DtsNoteEvent>;
  /** Ids not yet acknowledged by the host. */
  pendingOps: string[];
  pendingActions: string[];
  pendingNotes: string[];
  cursor: DtsCursor;
  /** Server time minus this device's clock, in ms. */
  offsetMs: number;
  state: DtsState | null;
  lastSync?: number;
}

/** What the session switcher shows about a session this device has a copy of. One small record per session, so tabs never overwrite each other's list. */
export interface DtsSessionMeta {
  id: string;
  /** Epoch ms of the last time this device used the session. */
  usedAt: number;
  /** The race codes, once the state is known. */
  label: string;
}

/** Key-value storage: IndexedDB where it works, memory otherwise (private windows, blocked site data). */
export interface DtsKv {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  /** The keys that start with the prefix. */
  keys(prefix: string): Promise<string[]>;
  /** Whether it survives a reload. */
  readonly durable: boolean;
}

export class MemoryKv implements DtsKv {
  readonly durable = false;
  private data = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    const v = this.data.get(key);
    return v === undefined ? undefined : (structuredClone(v) as T);
  }
  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, structuredClone(value));
  }
  async remove(key: string): Promise<void> {
    this.data.delete(key);
  }
  async keys(prefix: string): Promise<string[]> {
    return [...this.data.keys()].filter((k) => k.startsWith(prefix));
  }
}

class IdbKv implements DtsKv {
  readonly durable = true;
  constructor(private db: IDBDatabase) {}
  private run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const req = f(this.db.transaction('kv', mode).objectStore('kv'));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  get<T>(key: string): Promise<T | undefined> {
    return this.run('readonly', (s) => s.get(key)) as Promise<T | undefined>;
  }
  async set(key: string, value: unknown): Promise<void> {
    await this.run('readwrite', (s) => s.put(value, key));
  }
  async remove(key: string): Promise<void> {
    await this.run('readwrite', (s) => s.delete(key));
  }
  async keys(prefix: string): Promise<string[]> {
    const all = await this.run('readonly', (s) => s.getAllKeys());
    return all.filter((k): k is string => typeof k === 'string' && k.startsWith(prefix));
  }
}

export async function openKv(): Promise<DtsKv> {
  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('dts-sign', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('blocked'));
    });
    const kv = new IdbKv(db);
    await kv.set('probe', 1);
    return kv;
  } catch {
    return new MemoryKv();
  }
}

/** Asks the browser not to evict the data. False when it refuses or cannot say. */
export async function askPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    return (await navigator.storage.persisted?.()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}
