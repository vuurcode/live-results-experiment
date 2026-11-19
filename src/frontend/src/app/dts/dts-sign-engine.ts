import { Injectable, computed, signal } from '@angular/core';
import { DtsNetworkError, dtsRequest, fileNameOf, parseJson, randomId, saveBlob, sha256Hex } from './dts-api';
import { askPersistence, openKv, type DtsKv, type DtsLocal, type DtsSessionMeta } from './dts-storage';
import { applyOp, clockOffset, syncDelay, warningsFor } from './dts.logic';
import type { DtsAction, DtsCreated, DtsNoteEvent, DtsOp, DtsOpKind, DtsState, DtsSyncAnswer } from './dts.models';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'denied' | 'deleted';

/** What the user changes on a racer, one field per operation. */
export type FieldChange =
  | { kind: 'sign'; on: boolean }
  | { kind: 'cap' | 'transponder1' | 'transponder2' | 'race'; value: string };

const FIELD_OPS: DtsOpKind[] = ['cap', 'transponder1', 'transponder2', 'race'];

export interface DtsNotice {
  id: string;
  entry: string;
  kind: DtsOpKind;
  who: string;
  value: string;
}

/**
 * The sign page's data. Every change is applied on the device first and put in an outbox; the sync sends the outbox and
 * pulls what the other devices did, in one call. Nothing is ever dropped because a request failed.
 */
@Injectable({ providedIn: 'root' })
export class DtsSignEngine {
  private kv: DtsKv | null = null;
  private local: DtsLocal | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  /** Ids of operations dropped for a closed race or because the host refused them: the merge with another tab's stored copy must not bring them back. */
  private readonly dropped = new Set<string>();
  /** How many items one sync may carry; it shrinks while the host refuses a batch and resets on success. */
  private batchCap = Infinity;
  private running = false;
  private stopped = true;

  readonly ready = signal(false);
  readonly status = signal<SyncStatus>('idle');
  readonly pending = signal(0);
  readonly durable = signal(true);
  /** The device's copy of the open session vanished while the page was open (site data cleared); it was written back from memory. */
  readonly storageCleared = signal(false);
  private written = false;
  readonly state = signal<DtsState | null>(null);
  readonly actions = signal<DtsAction[]>([]);
  /** Changes another device made to a racer's cap number, transponder or race, to tell the signer who has it open. */
  readonly notices = signal<DtsNotice[]>([]);
  readonly deviceName = signal('');
  /** Whether the signer has said who they are on this session; a joined device is asked once. */
  readonly nameAsked = signal(true);
  /** The name this device used last, offered when a new session asks for one. */
  readonly suggestedName = signal('');
  readonly lastSync = signal<number | null>(null);
  readonly offset = signal(0);
  readonly sessionId = signal('');
  readonly manageKey = signal<string | undefined>(undefined);
  readonly joined = computed(() => this.state() !== null);

  get signKey(): string {
    return this.local?.signKey ?? '';
  }

  private async store(): Promise<DtsKv> {
    if (!this.kv) {
      this.kv = await openKv();
      this.durable.set(this.kv.durable);
    }
    return this.kv;
  }

  /** The sessions this device has a copy of, the most recently used first. */
  async knownSessions(): Promise<DtsSessionMeta[]> {
    const kv = await this.store();
    const metas = await Promise.all((await kv.keys('m:')).map((k) => kv.get<DtsSessionMeta>(k)));
    return metas.filter((m): m is DtsSessionMeta => !!m).sort((x, y) => y.usedAt - x.usedAt);
  }

  /** Removes a session's copy from this device only; the host keeps it for the other devices. */
  async forget(id: string): Promise<void> {
    const kv = await this.store();
    await kv.remove(`s:${id}`);
    await kv.remove(`m:${id}`);
  }

  /** The host deleted the session on purpose: nothing of it may stay on this device, in storage or on screen. */
  private async wipe(l: DtsLocal): Promise<void> {
    this.local = null;
    await this.forget(l.id);
    this.state.set(null);
    this.actions.set([]);
    this.notices.set([]);
    this.pending.set(0);
    this.manageKey.set(undefined);
    this.status.set('deleted');
  }

  /** Reopens a session from this device's own copy: the given one, or else the one used last. False when there is none. */
  async resume(id?: string): Promise<boolean> {
    const kv = await this.store();
    const ids = id ? [id] : (await this.knownSessions()).map((m) => m.id);
    for (const x of ids) {
      const local = await kv.get<DtsLocal>(`s:${x}`);
      if (local && (await this.open(local.id, local.signKey)) === 'ok') return true;
    }
    return false;
  }

  /** Opens a session from the link: from the device's own copy, or by joining with the key alone. */
  async open(id: string, key: string): Promise<'ok' | 'denied' | 'offline'> {
    const kv = await this.store();
    let local = await kv.get<DtsLocal>(`s:${id}`);
    if (local && local.signKey !== key) local = undefined;
    if (!local) {
      try {
        const res = await dtsRequest(`/${id}/source`, { key });
        if (res.status === 404) return 'denied';
        if (res.status !== 200) return 'offline';
        const device = (await kv.get<{ id: string; name: string }>('device')) ?? { id: randomId(), name: '' };
        await kv.set('device', device);
        local = this.blank(id, key, res.text, res.headers.get('X-Dts-Manage-Hash') ?? '', { ...device, name: '' });
        local.nameAsked = false;
        this.suggestedName.set(device.name);
      } catch {
        return 'offline';
      }
    }
    await this.adopt(local);
    void askPersistence();
    this.start();
    return 'ok';
  }

  /** Uploads a file and opens the session it makes. */
  async create(xml: string): Promise<DtsCreated | 'rate' | 'invalid' | 'offline' | 'full'> {
    let res;
    try {
      res = await dtsRequest('', { method: 'POST', body: xml, timeoutMs: 60000 });
    } catch {
      return 'offline';
    }
    if (res.status === 429) return 'rate';
    if (res.status === 503) return 'full';
    if (res.status !== 201) return 'invalid';
    const created = parseJson<DtsCreated>(res);
    const kv = await this.store();
    const device = (await kv.get<{ id: string; name: string }>('device')) ?? { id: randomId(), name: '' };
    await kv.set('device', device);
    const local = this.blank(created.id, created.signKey, xml, await sha256Hex(created.manageKey), device);
    local.manageKey = created.manageKey;
    await this.adopt(local);
    await this.syncNow();
    this.start();
    return created;
  }

  private blank(id: string, signKey: string, xml: string, manageHash: string, device: { id: string; name: string }): DtsLocal {
    return {
      id, signKey, manageHash, xml, deviceId: device.id, deviceName: device.name, ops: {}, actions: {}, noteEvents: {},
      pendingOps: [], pendingActions: [], pendingNotes: [], cursor: { ops: 0, actions: 0, notes: 0 }, offsetMs: 0, state: null,
    };
  }

  private async adopt(local: DtsLocal): Promise<void> {
    this.local = local;
    this.sessionId.set(local.id);
    this.manageKey.set(local.manageKey);
    this.deviceName.set(local.deviceName);
    this.nameAsked.set(local.nameAsked !== false);
    await this.save();
    this.publish();
    this.ready.set(true);
  }

  /**
   * Writes the session copy. Another tab may have this session open too and writes the same record, so what it stored since
   * this tab last read is merged in first: the operations, actions and notes only ever grow, and the outbox and cursor
   * take the union and the furthest point (a repeated send is harmless, the host skips what it has).
   */
  private async save(): Promise<void> {
    const l = this.local;
    if (!l) return;
    const kv = await this.store();
    const other = await kv.get<DtsLocal>(`s:${l.id}`);
    if (!other && this.written && kv.durable) this.storageCleared.set(true);
    if (other && other.signKey === l.signKey) {
      // only entries this tab did not know before count as pending from the other tab; the ones it knows and has dropped from its outbox were acknowledged
      const fresh = (theirs: string[], mine: Record<string, unknown>) => theirs.filter((id) => !(id in mine));
      const newOps = fresh(other.pendingOps, l.ops).filter((id) => !this.dropped.has(id));
      const newActions = fresh(other.pendingActions, l.actions);
      const newNotes = fresh(other.pendingNotes, l.noteEvents);
      Object.assign(l.ops, { ...Object.fromEntries(Object.entries(other.ops).filter(([id]) => !this.dropped.has(id))), ...l.ops });
      Object.assign(l.actions, { ...other.actions, ...l.actions });
      Object.assign(l.noteEvents, { ...other.noteEvents, ...l.noteEvents });
      l.pendingOps.push(...newOps);
      l.pendingActions.push(...newActions);
      l.pendingNotes.push(...newNotes);
      l.cursor = { ops: Math.max(l.cursor.ops, other.cursor.ops), actions: Math.max(l.cursor.actions, other.cursor.actions), notes: Math.max(l.cursor.notes, other.cursor.notes) };
      if (!l.manageKey && other.manageKey) l.manageKey = other.manageKey;
    }
    await kv.set(`s:${l.id}`, l);
    this.written = true;
    const meta: DtsSessionMeta = { id: l.id, usedAt: Date.now(), label: l.state?.races.map((r) => r.title).join('\n') ?? '' };
    await kv.set(`m:${l.id}`, meta);
  }

  /** The state with the operations still in the outbox applied, as the screen should show it. */
  private publish(): void {
    const l = this.local;
    if (!l) return;
    let st = l.state;
    if (st) for (const id of l.pendingOps) st = applyOp(st, l.ops[id]);
    this.state.set(st);
    this.pending.set(l.pendingOps.length + l.pendingActions.length + l.pendingNotes.length);
    this.actions.set(Object.values(l.actions).sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id)));
    this.lastSync.set(l.lastSync ?? null);
    this.offset.set(l.offsetMs);
  }

  private now(): { at: string; deviceAt: string } {
    const t = Date.now();
    return { at: new Date(t + (this.local?.offsetMs ?? 0)).toISOString(), deviceAt: new Date(t).toISOString() };
  }

  async setDeviceName(name: string): Promise<void> {
    if (!this.local) return;
    this.local.deviceName = name.trim().slice(0, 40);
    this.deviceName.set(this.local.deviceName);
    this.local.nameAsked = true;
    this.nameAsked.set(true);
    await (await this.store()).set('device', { id: this.local.deviceId, name: this.local.deviceName });
    await this.save();
    void this.syncNow();
  }

  private log(a: Omit<DtsAction, 'id' | 'at' | 'device'>): void {
    const l = this.local!;
    const act: DtsAction = { ...a, id: randomId(), at: this.now().at, device: l.deviceId };
    l.actions[act.id] = act;
    l.pendingActions.push(act.id);
  }

  /** Applies one field change on the device, logs it, and queues it. Returns the operation id. */
  async change(entryId: string, change: FieldChange): Promise<string> {
    const l = this.local!;
    const before = this.state()?.races.flatMap((r) => r.entries).find((e) => e.id === entryId);
    const kind: DtsOpKind = change.kind;
    const value = change.kind === 'sign' ? (change.on ? '1' : '0') : change.value;
    const op: DtsOp = { id: randomId(), ...this.now(), kind, entry: entryId, value, device: l.deviceId };
    l.ops[op.id] = op;
    l.pendingOps.push(op.id);
    const oldValue = !before ? '' : kind === 'sign' ? (before.signed ? '1' : '0') : kind === 'cap' ? before.cap : kind === 'transponder1' ? (before.t1 ?? '') : kind === 'transponder2' ? (before.t2 ?? '') : '';
    this.log({ kind, entry: entryId, old: oldValue, new: value });
    await this.save();
    this.publish();
    void this.syncNow();
    return op.id;
  }

  async addRacer(fields: { who: string; licence?: string; race: string; cap: string; t1?: string; t2?: string; signed: boolean }): Promise<string> {
    const l = this.local!;
    const op: DtsOp = { id: randomId(), ...this.now(), kind: 'add-racer', device: l.deviceId, who: fields.who.trim(), licence: fields.licence || undefined, race: fields.race, cap: fields.cap, t1: fields.t1 || undefined, t2: fields.t2 || undefined, signed: fields.signed };
    l.ops[op.id] = op;
    l.pendingOps.push(op.id);
    this.log({ kind: 'add-racer', entry: op.id, new: op.cap });
    await this.save();
    this.publish();
    void this.syncNow();
    return op.id;
  }

  dismissNotice(id: string): void {
    this.notices.update((all) => all.filter((n) => n.id !== id));
  }

  async addNote(entryId: string, text: string): Promise<void> {
    const ev: DtsNoteEvent = { id: randomId(), at: this.now().at, kind: 'add', entry: entryId, level: 'note', text: text.trim().slice(0, 200) };
    this.local!.noteEvents[ev.id] = ev;
    this.local!.pendingNotes.push(ev.id);
    this.log({ kind: 'note-add', entry: entryId, text: ev.text });
    await this.save();
    this.publish();
    void this.syncNow();
  }

  async resolveNote(noteId: string, entryId: string): Promise<void> {
    const ev: DtsNoteEvent = { id: randomId(), at: this.now().at, kind: 'resolve', noteId, entry: entryId };
    this.local!.noteEvents[ev.id] = ev;
    this.local!.pendingNotes.push(ev.id);
    const text = this.state()?.notes.find((n) => n.id === noteId)?.text;
    this.log({ kind: 'note-resolve', entry: entryId, text });
    await this.save();
    this.publish();
    void this.syncNow();
  }

  /** Warnings that involve a racer, from the state as the screen shows it. */
  warningsOf(entryId: string) {
    return warningsFor(this.state()?.warnings ?? [], entryId);
  }

  // ---- sync ----

  start(): void {
    this.stopped = false;
    this.schedule(0);
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('online', this.onOnline);
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('online', this.onOnline);
    window.removeEventListener('pageshow', this.onOnline);
    window.addEventListener('pageshow', this.onOnline);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('pageshow', this.onOnline);
  }

  private onVisible = (): void => {
    if (document.visibilityState === 'visible') {
      // also notices site data cleared while the page was in the background
      void this.save().catch(() => undefined);
      this.schedule(0);
    }
  };
  private onOnline = (): void => {
    this.failures = 0;
    this.schedule(0);
  };

  /** A sync was asked for while one was running; it runs right after. */
  private again = false;

  private schedule(ms: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.syncNow(), ms);
  }

  async syncNow(): Promise<void> {
    const l = this.local;
    if (!l) return;
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    this.status.set('syncing');
    try {
      await this.syncOnce(l, true);
      this.failures = 0;
      this.status.set('idle');
    } catch (e) {
      this.failures++;
      this.status.set(e instanceof DtsNetworkError ? 'offline' : this.status() === 'denied' || this.status() === 'deleted' ? this.status() : 'offline');
    } finally {
      this.running = false;
      const again = this.again;
      this.again = false;
      this.schedule(again ? 0 : syncDelay(this.failures, document.visibilityState === 'visible'));
    }
  }

  private async syncOnce(l: DtsLocal, mayRestore: boolean): Promise<void> {
    const queue = [
      ...l.pendingOps.map((id) => ['op', id] as const),
      ...l.pendingActions.map((id) => ['action', id] as const),
      ...l.pendingNotes.map((id) => ['note', id] as const),
    ].slice(0, this.batchCap);
    const idsOf = (kind: string) => queue.filter(([k]) => k === kind).map(([, id]) => id);
    const sentOps = idsOf('op'), sentActions = idsOf('action'), sentNotes = idsOf('note');
    const before = Date.now();
    const res = await dtsRequest(`/${l.id}/sync`, {
      method: 'POST', key: l.signKey,
      json: {
        device: l.deviceId, name: l.deviceName, clientTime: new Date(before).toISOString(), since: l.cursor,
        ops: sentOps.map((id) => l.ops[id]), actions: sentActions.map((id) => l.actions[id]), notes: sentNotes.map((id) => l.noteEvents[id]),
      },
    });
    if (res.status === 404 && mayRestore) {
      await this.restore(l);
      return this.syncOnce(l, false);
    }
    if (res.status === 404 || res.status === 403) {
      this.status.set('denied');
      throw new Error('denied');
    }
    if (res.status === 413 || res.status === 422) {
      // The host refuses the batch as a whole. Halve it until the offending item stands alone, then forget that item.
      if (queue.length > 1) this.batchCap = Math.ceil(queue.length / 2);
      else {
        for (const id of sentOps) {
          delete l.ops[id];
          this.dropped.add(id);
        }
        for (const id of sentActions) delete l.actions[id];
        for (const id of sentNotes) delete l.noteEvents[id];
        l.pendingOps = l.pendingOps.filter((id) => !sentOps.includes(id));
        l.pendingActions = l.pendingActions.filter((id) => !sentActions.includes(id));
        l.pendingNotes = l.pendingNotes.filter((id) => !sentNotes.includes(id));
        await this.save();
        this.publish();
      }
      this.again = true;
      throw new DtsNetworkError(`status ${res.status}`);
    }
    if (res.status !== 200) throw new DtsNetworkError(`status ${res.status}`);
    this.batchCap = Infinity;
    const a = parseJson<DtsSyncAnswer>(res);
    l.offsetMs = clockOffset(a.time, before, Date.now());
    const fresh = a.ops.filter((op) => !l.ops[op.id] && op.device !== l.deviceId && op.entry && FIELD_OPS.includes(op.kind));
    for (const op of a.ops) l.ops[op.id] = op;
    if (fresh.length) {
      const names = new Map((a.state.devices ?? []).map((d) => [d.id, d.name]));
      this.notices.update((all) => [
        ...fresh.map((op) => ({ id: op.id, entry: op.entry!, kind: op.kind, who: names.get(op.device ?? '') || '', value: op.value ?? '' })),
        ...all,
      ].slice(0, 20));
    }
    for (const act of a.actions) l.actions[act.id] = act;
    for (const ev of a.notes) l.noteEvents[ev.id] = ev;
    this.dropClosed(l, sentOps, a);
    l.pendingOps = l.pendingOps.filter((id) => !sentOps.includes(id));
    l.pendingActions = l.pendingActions.filter((id) => !sentActions.includes(id));
    l.pendingNotes = l.pendingNotes.filter((id) => !sentNotes.includes(id));
    if (l.pendingOps.length + l.pendingActions.length + l.pendingNotes.length > 0) this.again = true;
    l.cursor = a.cursor;
    l.state = a.state;
    l.lastSync = Date.now();
    await this.save();
    this.publish();
  }

  /** The host turned away what was sent for a race an admin closed; this device forgets those changes too. */
  private dropClosed(l: DtsLocal, sent: string[], a: DtsSyncAnswer): void {
    const closed = new Set(a.state.races.filter((r) => r.closed).map((r) => r.id));
    if (!closed.size) return;
    const raceOf = new Map(a.state.races.flatMap((r) => r.entries.map((e) => [e.id, r.id] as const)));
    const kept = new Set(a.ops.map((op) => op.id));
    for (const id of sent) {
      const op = l.ops[id];
      if (!op || kept.has(id)) continue;
      const races = [op.kind === 'add-racer' ? op.race : raceOf.get(op.entry ?? ''), op.kind === 'race' ? op.value : undefined];
      if (races.some((r) => r && closed.has(r))) {
        delete l.ops[id];
        this.dropped.add(id);
      }
    }
  }

  /** The host lost the session: recreate it from this device's copy. */
  private async restore(l: DtsLocal): Promise<void> {
    const res = await dtsRequest(`/${l.id}`, {
      method: 'PUT', key: l.signKey, timeoutMs: 60000,
      json: { xml: l.xml, manageHash: l.manageHash, ops: Object.values(l.ops), actions: Object.values(l.actions) },
    });
    if (res.status === 410) {
      await this.wipe(l);
      throw new Error('deleted');
    }
    if (res.status !== 204) throw new DtsNetworkError(`restore ${res.status}`);
    // The host starts again from nothing: it hands everything back on the next sync.
    l.cursor = { ops: 0, actions: 0, notes: 0 };
    l.pendingOps = Object.keys(l.ops);
    l.pendingActions = Object.keys(l.actions);
    l.pendingNotes = Object.keys(l.noteEvents);
  }

  /** Downloads the export, of one race or all. Online it asks the host, which writes the file. */
  async download(race?: string): Promise<'ok' | 'offline'> {
    const l = this.local;
    if (!l) return 'offline';
    // a background sync in flight finishes first, so two syncs never race on the cursor
    while (this.running) await new Promise((r) => setTimeout(r, 50));
    try {
      this.running = true;
      try {
        await this.syncOnce(l, true);
      } finally {
        this.running = false;
        if (this.again) {
          this.again = false;
          this.schedule(0);
        }
      }
      const res = await dtsRequest(`/${l.id}/export${race ? `?race=${encodeURIComponent(race)}` : ''}`, { key: l.signKey, timeoutMs: 30000 });
      if (res.status !== 200) return 'offline';
      saveBlob(fileNameOf(res, 'DTS_updated.xml'), res.text);
      return 'ok';
    } catch {
      return 'offline';
    }
  }

  /** The link to share with another phone. */
  link(): string {
    return `${location.origin}/dts/sign#${this.local?.id}.${this.local?.signKey}`;
  }
  manageLink(): string | null {
    const l = this.local;
    return l?.manageKey ? `${location.origin}/dts/manage#${l.id}.${l.manageKey}` : null;
  }
}
