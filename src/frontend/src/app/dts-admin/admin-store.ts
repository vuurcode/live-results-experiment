import { signal } from '@angular/core';
import { DtsNetworkError, dtsAdminRequest, dtsAdminSend, parseJson, randomId } from '../dts/dts-api';
import { applyOp } from '../dts/dts.logic';
import type { DtsOp, DtsState } from '../dts/dts.models';
import { MemoryKv, openKv, type DtsKv } from '../dts/dts-storage';

/** A list as the admin index names it. */
export interface AdminSession {
  id: string;
  created: string;
  races: { id: string; title: string; closed?: boolean; entries: number; signed: number }[];
  /** Absent for a list made before the server kept it, until a device syncs it. */
  signKey?: string;
}

/** A change that waits to be sent: the request, and what it means so the pages can show the result before the server confirms it. */
export type Change =
  | { kind: 'ops'; session: string; ops: DtsOp[] }
  | { kind: 'cutoff'; session: string; race: string; minutes: number | null }
  | { kind: 'closed'; session: string; race: string; closed: boolean }
  | { kind: 'device-remove'; session: string; device: string }
  | { kind: 'session-remove'; session: string };

const OUTBOX = 'admin:out:';
const SESSIONS = 'admin:sessions';
const stateKey = (id: string) => `admin:state:${id}`;

function request(c: Change): { method: string; path: string; json?: unknown } {
  const base = `/${c.session}`;
  switch (c.kind) {
    case 'ops': return { method: 'POST', path: `${base}/operations`, json: { ops: c.ops } };
    case 'cutoff': return { method: 'PUT', path: `${base}/cutoff`, json: { race: c.race, minutes: c.minutes } };
    case 'closed': return { method: 'PUT', path: `${base}/races/${encodeURIComponent(c.race)}`, json: { closed: c.closed } };
    case 'device-remove': return { method: 'DELETE', path: `${base}/devices/${encodeURIComponent(c.device)}` };
    case 'session-remove': return { method: 'DELETE', path: base };
  }
}

/** The state with a waiting change shown as done. The server stays the truth: the next read replaces all of this. */
export function applyChange(st: DtsState, c: Change): DtsState {
  switch (c.kind) {
    case 'ops': return c.ops.reduce(applyOp, st);
    case 'cutoff':
      return c.minutes === null ? st : { ...st, races: st.races.map((r) => (r.id === c.race ? { ...r, cutoffMinutes: c.minutes! } : r)) };
    case 'closed':
      return { ...st, races: st.races.map((r) => (r.id === c.race ? { ...r, closed: c.closed } : r)) };
    case 'device-remove':
      return { ...st, devices: st.devices.filter((d) => d.id !== c.device) };
    case 'session-remove':
      return st;
  }
}

/**
 * The admin pages' copy of the data on this device, and the changes made while the connection was bad. Reads go to the server and
 * keep the answer; when the server cannot be reached the last answer is shown, with the waiting changes applied. Changes are
 * written to the device first and sent in order; every one is safe to send twice, so a refresh or a second tab does no harm.
 */
export class AdminStore {
  /** The number of changes that wait to be sent. */
  readonly pending = signal(0);
  /** Changes the server refused for good; they are dropped. */
  readonly rejected = signal(0);
  /** False after a request failed to reach the server, true after one got through. */
  readonly online = signal(typeof navigator === 'undefined' || navigator.onLine !== false);

  private kvPromise: Promise<DtsKv> | null = null;
  private flushing: Promise<void> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;

  constructor(kv?: DtsKv) {
    if (kv) this.kvPromise = Promise.resolve(kv);
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => void this.flush());
      window.addEventListener('offline', () => this.online.set(false));
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void this.flush();
      });
    }
    void this.flush();
  }

  private kv(): Promise<DtsKv> {
    return (this.kvPromise ??= openKv().catch(() => new MemoryKv()));
  }

  private async outbox(): Promise<{ key: string; change: Change }[]> {
    const kv = await this.kv();
    const keys = (await kv.keys(OUTBOX)).sort();
    const rows = await Promise.all(keys.map(async (key) => ({ key, change: await kv.get<Change>(key) })));
    return rows.filter((r): r is { key: string; change: Change } => !!r.change);
  }

  private async changesOf(session: string): Promise<Change[]> {
    return (await this.outbox()).map((r) => r.change).filter((c) => c.session === session);
  }

  // ---- reads ----

  /** Every list on the server; the copy from this device when the server cannot be reached. */
  async sessions(): Promise<{ items: AdminSession[]; stale: boolean } | null> {
    const kv = await this.kv();
    // read before the request: a change that is sent while the answer is on its way is still applied to it
    const waiting = await this.outbox();
    let items: AdminSession[] | null = null;
    try {
      const res = await dtsAdminRequest('');
      if (res.status === 200) {
        items = parseJson<{ sessions: AdminSession[] | null }>(res).sessions ?? [];
        this.online.set(true);
        await kv.set(SESSIONS, items);
      }
    } catch (e) {
      if (e instanceof DtsNetworkError) this.online.set(false);
    }
    const fresh = !!items;
    items ??= (await kv.get<AdminSession[]>(SESSIONS)) ?? null;
    if (!items) return null;
    const removed = new Set(waiting.filter((r) => r.change.kind === 'session-remove').map((r) => r.change.session));
    if (fresh) void this.prefetch(items.map((s) => s.id));
    return { items: items.filter((s) => !removed.has(s.id)), stale: !fresh };
  }

  /** The sign key of a list, from the copy of the list index. */
  async signKey(id: string): Promise<string> {
    const items = (await (await this.kv()).get<AdminSession[]>(SESSIONS)) ?? [];
    return items.find((s) => s.id === id)?.signKey ?? '';
  }

  /** One list; 'gone' when the server says it does not exist (any copy is dropped), null when there is no answer and no copy. */
  async state(id: string): Promise<{ state: DtsState; stale: boolean } | 'gone' | null> {
    const kv = await this.kv();
    const waiting = await this.changesOf(id);
    let fresh: DtsState | null = null;
    try {
      const res = await dtsAdminRequest(`/${id}`);
      this.online.set(true);
      if (res.status === 404) {
        await kv.remove(stateKey(id));
        return 'gone';
      }
      if (res.status === 200) {
        fresh = parseJson<DtsState>(res);
        await kv.set(stateKey(id), fresh);
      }
    } catch (e) {
      if (e instanceof DtsNetworkError) this.online.set(false);
    }
    const base = fresh ?? (await kv.get<DtsState>(stateKey(id)));
    if (!base) return null;
    return { state: waiting.reduce(applyChange, base), stale: !fresh };
  }

  /** Keeps a copy of every list so that all of them open without connection. */
  private async prefetch(ids: string[]): Promise<void> {
    const kv = await this.kv();
    for (const id of ids) {
      if (!this.online() || (await kv.get(stateKey(id)))) continue;
      try {
        const res = await dtsAdminRequest(`/${id}`);
        if (res.status === 200) await kv.set(stateKey(id), parseJson<DtsState>(res));
      } catch {
        return;
      }
    }
  }

  // ---- changes ----

  /** Writes the change to this device and starts sending it. Resolves when it is stored, not when the server has it. */
  async queue(change: Change): Promise<void> {
    const kv = await this.kv();
    await kv.set(`${OUTBOX}${String(Date.now()).padStart(15, '0')}-${randomId()}`, change);
    this.pending.update((n) => n + 1);
    void this.flush();
  }

  /** Sends what waits, oldest first, and stops at the first change the server cannot be reached for. */
  flush(): Promise<void> {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    return (this.flushing ??= this.run().finally(() => (this.flushing = null)));
  }

  private async run(): Promise<void> {
    const kv = await this.kv();
    // one tab sends at a time; the changes are safe to send twice, so a browser without locks only does a little double work
    const locks = navigator.locks;
    if (locks) await locks.request('dts-admin-outbox', { ifAvailable: true }, (lock) => (lock ? this.drain(kv) : undefined));
    else await this.drain(kv);
  }

  private async drain(kv: DtsKv): Promise<void> {
    let waiting = await this.outbox();
    this.pending.set(waiting.length);
    for (const { key, change } of waiting) {
      const req = request(change);
      let status = 0;
      try {
        const res = await dtsAdminSend(req.path, { method: req.method, json: req.json });
        status = res.status;
        this.online.set(true);
      } catch {
        this.online.set(false);
      }
      // no answer, a server error, or a login that lapsed: keep it and try again later
      if (status === 0 || status >= 500 || status === 401 || status === 403 || status === 408 || status === 429) {
        this.failures++;
        this.retry = setTimeout(() => void this.flush(), Math.min(60000, 3000 * 2 ** Math.min(this.failures, 5)));
        break;
      }
      // done, gone already (404), or refused for good (the other 4xx)
      if (status >= 400 && status !== 404) this.rejected.update((n) => n + 1);
      await kv.remove(key);
      this.failures = 0;
      waiting = waiting.filter((w) => w.key !== key);
      this.pending.set(waiting.length);
    }
    this.pending.set((await this.outbox()).length);
  }
}

let shared: AdminStore | null = null;
/** The one store of this page. */
export function adminStore(): AdminStore {
  return (shared ??= new AdminStore());
}
