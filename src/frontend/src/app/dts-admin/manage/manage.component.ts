import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { installInstantTooltips } from '../../dts/dts-tooltip';
import { DtsText } from '../../dts/dts-text';
import { buildPdf, type PdfLogLine } from '../../dts/dts-pdf';
import { dtsAdminRequest, fileNameOf, parseJson, previewBlob, saveBlob } from '../../dts/dts-api';
import { DtsNotices } from '../../dts/dts-notices';
import { adminStore } from '../admin-store';
import { AdminSyncStatus } from '../sync-status';
import { qrEncode, qrPath } from '../../dts/qr';
import { byCap, clock, minutesToCutoff, raceProblems, watermarkOf } from '../../dts/dts.logic';
import { warningSentence } from '../../dts/dts-warning-text';
import type { DtsAction, DtsDevice, DtsEntry, DtsNote, DtsRace, DtsState, DtsWarning } from '../../dts/dts.models';
import type { DtsKey } from '../../dts/dts.strings';

/** The kinds of log action that are about a note. */
const NOTE_KINDS = ['note-add', 'racer-note', 'note-resolve'];

/** The admin's page for one list (/dts-admin/list?s=<id>), or one competitor of it (&c=<entry>): monitoring, notes, the cutoff per race, closing, and the way to add or edit a competitor. */
@Component({
  selector: 'app-dts-manage',
  standalone: true,
  imports: [AdminSyncStatus],
  templateUrl: './manage.component.html',
  styleUrls: ['./manage.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DtsManageComponent implements OnInit {
  private readonly destroy = inject(DestroyRef);
  private readonly store = adminStore();
  protected readonly text = new DtsText();
  private readonly tabSync = effect(() => {
    document.title = `${this.text.t('manageTitle')} · ${this.text.t('appName')}`;
  });
  protected readonly t = this.text.t;

  protected readonly state = signal<DtsState | null>(null);
  /** Ids of the numbers whose state a signer just changed; they pulse for a moment so the change catches the eye. */
  protected readonly fresh = signal<ReadonlySet<string>>(new Set());
  private seenStates: Map<string, string> | null = null;
  private freshTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly flashChanges = effect(() => {
    const st = this.state();
    if (!st) return;
    const now = new Map<string, string>();
    const changed = new Set<string>();
    for (const r of st.races) {
      for (const e of r.entries) {
        const key = this.stateOf(e);
        now.set(e.id, key);
        if (this.seenStates && this.seenStates.get(e.id) !== key) changed.add(e.id);
      }
    }
    this.seenStates = now;
    if (!changed.size) return;
    this.fresh.set(changed);
    if (this.freshTimer) clearTimeout(this.freshTimer);
    this.freshTimer = setTimeout(() => this.fresh.set(new Set()), 1600);
  });
  protected readonly loadedAt = signal<number | null>(null);
  protected readonly denied = signal(false);
  /** The competitor whose details page is open: /dts-admin/list?s=<id>&c=<entry>. */
  protected readonly competitorId = new URLSearchParams(location.search).get('c') ?? '';
  protected readonly competitor = computed(() => {
    for (const race of this.state()?.races ?? []) {
      const entry = race.entries.find((e) => e.id === this.competitorId);
      if (entry) return { entry, race };
    }
    return null;
  });
  protected readonly competitorActions = computed(() => (this.state()?.latestActions ?? []).filter((a) => a.entry === this.competitorId));
  protected readonly competitorNotes = computed(() => (this.state()?.notes ?? []).filter((n) => n.entry === this.competitorId));
  protected readonly stale = signal(false);
  protected readonly nowMs = signal(Date.now());
  protected readonly message = signal('');
  protected readonly cutoffDraft = signal<Record<string, string>>({});

  /** Every note, open and resolved, about a competitor of the race. */
  protected notesOf(r: DtsRace): DtsNote[] {
    const ids = new Set(r.entries.map((e) => e.id));
    return (this.state()?.notes ?? []).filter((n) => ids.has(n.entry));
  }

  private id = '';
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    installInstantTooltips();
    const id = new URLSearchParams(location.search).get('s') ?? '';
    if (!/^[0-9a-f]{32}$/.test(id)) {
      this.denied.set(true);
      return;
    }
    this.id = id;
    this.dismissed.set(new DtsNotices(`manage:${id}`));
    void this.loadSignKey();
    const tick = setInterval(() => this.nowMs.set(Date.now()), 15000);
    const visible = () => {
      if (document.visibilityState === 'visible') void this.refresh();
    };
    document.addEventListener('visibilitychange', visible);
    this.destroy.onDestroy(() => {
      clearInterval(tick);
      if (this.timer) clearTimeout(this.timer);
      document.removeEventListener('visibilitychange', visible);
    });
    void this.refresh();
  }

  protected back(): void {
    location.assign('/dts-admin/');
  }

  /** The address of the list, or of one competitor of it (admin). */
  protected competitorHref(id = ''): string {
    return `/dts-admin/list?s=${this.id}${id ? `&c=${encodeURIComponent(id)}` : ''}`;
  }

  /** The hover text of a number: its details, then the open notes about it. */
  protected tipOf(e: DtsEntry): string {
    const notes = (this.state()?.notes ?? []).filter((n) => n.entry === e.id && !n.resolved).map((n) => `! ${n.text}`);
    return [this.detailLines(e), ...notes].join('\n');
  }

  /** The race title cut around its start time ("17.30 uur") and the category after it, so that both can be emphasised. */
  protected titleParts(title: string): { before: string; time: string; sep: string; category: string } {
    const m = /\d{1,2}\.\d{2} uur/.exec(title);
    const before = m ? title.slice(0, m.index) : title;
    const after = m ? title.slice(m.index + m[0].length) : '';
    const sep = /^\s*-\s*/.exec(after)?.[0] ?? '';
    return { before, time: m?.[0] ?? '', sep, category: after.slice(sep.length) };
  }

  /** The details of a competitor in lines, for the tooltip of a number: the sign state first, changed values as old → new. */
  protected detailLines(e: DtsEntry): string {
    const none = this.t('noneSet');
    const change = (was: string | undefined, now: string): string => (e.orig && (was ?? '') !== now ? `${was || none} → ${now || none}` : now || none);
    return [
      this.signLine(e),
      change(e.orig?.cap, e.cap),
      e.name,
      `${this.t('tipTransponder')}: ${change(e.orig?.t1, e.t1 ?? '')}`,
      `${this.t('tipTransponder')}: ${change(e.orig?.t2, e.t2 ?? '')}`,
    ].join('\n');
  }

  /** The sign state for the first tooltip line, with a remark when it was signed with changes or a note is open. */
  private signLine(e: DtsEntry): string {
    const extra = [e.signed && e.changed ? this.t('tipWithChanges') : '', this.noted().has(e.id) ? this.t('tipWithNote') : ''].filter(Boolean);
    return `${e.signed ? this.t('tipSigned') : this.t('tipNotSigned')}${extra.length ? ` (${extra.join(', ')})` : ''}`;
  }

  /** The key to sign with, for the admin's add-a-competitor links (the admin list carries it). */
  private readonly signKey = signal('');

  private async loadSignKey(): Promise<void> {
    // no add links without the key
    this.signKey.set(await this.store.signKey(this.id));
  }

  /** The add-a-competitor page for a race. */
  protected addHref(r: DtsRace): string {
    return `/dts-admin/add?s=${this.id}&race=${encodeURIComponent(r.id)}`;
  }

  /** The edit page of a competitor. */
  protected editHref(entry: string): string {
    return `/dts-admin/edit?s=${this.id}&c=${encodeURIComponent(entry)}`;
  }

  private read(path: string, timeoutMs?: number) {
    return dtsAdminRequest(path, timeoutMs);
  }

  private async refresh(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    const got = await this.store.state(this.id);
    if (got === 'gone') {
      this.denied.set(true);
      return;
    }
    if (got) {
      this.state.set(got.state);
      this.loadedAt.set(Date.now());
      this.stale.set(got.stale);
      this.failures = got.stale ? this.failures + 1 : 0;
      const drafts = { ...this.cutoffDraft() };
      for (const r of got.state.races) if (!(r.id in drafts)) drafts[r.id] = String(r.cutoffMinutes);
      this.cutoffDraft.set(drafts);
    } else {
      this.failures++;
      this.stale.set(true);
    }
    const wait = document.visibilityState === 'visible' ? Math.min(30000, 5000 * 2 ** Math.min(this.failures, 3)) : 30000;
    this.timer = setTimeout(() => void this.refresh(), wait);
  }

  /** Sentences for races that look wrong: empty, or starting far from now. */
  protected problems(r: DtsRace): { key: string; text: string }[] {
    return raceProblems(this.nowMs(), r)
      .map((p) => ({ key: `${r.id}:${p.kind}`, text: this.t(p.kind === 'empty' ? 'raceEmpty' : p.kind === 'past' ? 'racePast' : 'raceFuture', { race: r.title, days: p.days, date: r.start.slice(0, 10) + ' ' + r.start.slice(11, 16) }) }))
      ;
  }

  /** The signing list of one race as a PDF with the changed numbers and transponders struck through, followed by the log of that race. */
  protected async downloadPdf(race: DtsRace): Promise<void> {
    // the tab opens at the click, since a browser may refuse one that opens after the request
    const tab = window.open('', '_blank');
    const res = await this.read(`/${this.id}?log=all`, 30000).catch(() => null);
    if (res?.status !== 200) {
      tab?.close();
      this.message.set(this.t('downloadFail'));
      return;
    }
    const st = parseJson<DtsState>(res);
    const devices = new Map(st.devices.map((d) => [d.id, d.name] as const));
    const races = st.races.filter((r) => r.id === race.id);
    const names = new Map(races.flatMap((r) => r.entries.map((e) => [e.id, e] as const)));
    const dated = (r: DtsRace) => `${r.start.slice(8, 10)}-${r.start.slice(5, 7)}-${r.start.slice(0, 4)}`;
    const now = new Date();
    const category = this.titleParts(race.title).category || race.code;
    const part = (text: string) => text.replace(/[^A-Za-z0-9]+/g, '');
    const fileName = `Tekenlijst_${race.start.slice(0, 10).replaceAll('-', '')}_${part(race.name)}_${part(category)}`;
    const pdf = buildPdf({
      title: fileName,
      heading: this.t('pdfHeading'),
      signedCount: (n) => this.t('pdfSigned', { n }),
      unsignedCount: (n) => this.t('pdfUnsigned', { n }),
      page: (n, of) => this.t('pdfPage', { n, of }),
      generated: `${now.toLocaleDateString('nl-NL')} ${clock(now.toISOString())}`,
      logHeading: this.t('pdfLog'),
      addedLabel: this.t('pdfNew'),
      races: races.map((r) => ({
        left: [dated(r), r.name, r.code],
        title: r.title,
        cells: byCap(r.entries).map((e) => ({
          cap: e.cap, capWas: e.orig && e.orig.cap !== e.cap ? e.orig.cap : undefined,
          t1: e.t1, t1Was: e.orig && e.orig.t1 && e.orig.t1 !== e.t1 ? e.orig.t1 : undefined,
          t2: e.t2, t2Was: e.orig && e.orig.t2 && e.orig.t2 !== e.t2 ? e.orig.t2 : undefined,
          name: e.name, licence: e.licence || e.newLicence, signed: e.signed, added: e.added,
          changed: e.orig ? { cap: e.orig.cap !== e.cap, t1: (e.orig.t1 ?? '') !== (e.t1 ?? ''), t2: (e.orig.t2 ?? '') !== (e.t2 ?? '') } : undefined,
        })),
      })),
      log: [...st.latestActions].filter((a) => a.entry && names.has(a.entry)).reverse().map((a) => ({
        time: clock(a.at),
        cap: names.get(a.entry ?? '')?.cap ?? '',
        name: names.get(a.entry ?? '')?.name ?? '',
        action: this.actionText(a),
        bold: NOTE_KINDS.includes(a.kind) ? 'all' : ['cap', 'transponder1', 'transponder2', 'add-racer'].includes(a.kind) ? a.new || undefined : undefined,
        tone: this.toneOf(a),
        entry: a.entry,
        who: a.by === 'sysadmin' ? a.by : (a.device && devices.get(a.device)) || '-',
      })),
    });
    if (!previewBlob(tab, pdf as BlobPart, 'application/pdf')) {
      saveBlob(`${fileName}.pdf`, pdf as BlobPart, 'application/pdf');
    }
    this.message.set('');
  }

  protected async downloadSource(): Promise<void> {
    const res = await this.read(`/${this.id}/source`, 30000).catch(() => null);
    if (res?.status === 200) {
      saveBlob(fileNameOf(res, 'DTS_original.xml'), res.text);
      this.message.set('');
    } else this.message.set(this.t('downloadFail'));
  }

  /** The notices dismissed on this device for the session. */
  protected dismissed = signal(new DtsNotices(''));

  /** The states the numbers are filtered on; none selected shows every number. */
  protected readonly filter = signal<ReadonlySet<'note' | 'changed' | 'signed' | 'open'>>(new Set());

  protected readonly emptyFilter: ReadonlySet<'note' | 'changed' | 'signed' | 'open'> = new Set();

  protected toggleFilter(state: 'note' | 'changed' | 'signed' | 'open'): void {
    this.filter.update((f) => {
      const next = new Set(f);
      if (!next.delete(state)) next.add(state);
      return next;
    });
  }

  protected shown(r: DtsRace): DtsEntry[] {
    const f = this.filter();
    const list = f.size === 0 ? r.entries : r.entries.filter((e) => f.has(this.stateOf(e)));
    return byCap(list);
  }

  protected total(r: DtsRace): number {
    return r.signed + r.unsigned;
  }
  /** The look of a number: a note wins over a change, a change over a plain signature. */
  protected stateOf(e: DtsEntry): 'note' | 'changed' | 'signed' | 'open' {
    if (this.noted().has(e.id)) return 'note';
    if (e.signed) return e.changed ? 'changed' : 'signed';
    return 'open';
  }
  protected markOf(e: DtsEntry): string {
    return watermarkOf(this.stateOf(e), e.signed);
  }
  protected stateLabel(e: DtsEntry): string {
    const s = this.stateOf(e);
    const late = e.signed && (e.minutesLate ?? 0) > 0 ? `, ${this.t('signedLate', { min: e.minutesLate ?? 0 })}` : '';
    return `${e.cap}: ${this.t(s === 'note' ? 'legendNote' : s === 'changed' ? 'legendChanged' : s === 'signed' ? 'legendSigned' : 'legendOpen')}${late}`;
  }
  protected readonly noted = computed(() => new Set((this.state()?.notes ?? []).filter((n) => !n.resolved).map((n) => n.entry)));
  /** The races in the order they start; races starting at the same time keep their file order. */
  protected byStart(races: DtsRace[]): DtsRace[] {
    return [...races].sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || 0);
  }

  protected clockOf = clock;

  protected cutoffLeft(r: DtsRace): number {
    return minutesToCutoff(this.nowMs(), r);
  }

  protected setDraft(race: string, event: Event): void {
    this.cutoffDraft.update((d) => ({ ...d, [race]: (event.target as HTMLInputElement).value }));
  }

  protected draftValid(race: string): boolean {
    const n = Number(this.cutoffDraft()[race]);
    return Number.isInteger(n) && n >= 0 && n <= 240;
  }

  protected draftTime(r: DtsRace): string {
    const n = Number(this.cutoffDraft()[r.id]);
    if (!this.draftValid(r.id)) return '';
    const start = new Date(r.cutoffAt).getTime() + r.cutoffMinutes * 60000;
    return clock(new Date(start - n * 60000).toISOString());
  }

  protected async setClosed(r: DtsRace): Promise<void> {
    const choice = new Map(this.foldChoice());
    choice.delete(r.id);
    this.foldChoice.set(choice);
    await this.store.queue({ kind: 'closed', session: this.id, race: r.id, closed: !r.closed });
    await this.refresh();
  }

  protected async saveCutoff(r: DtsRace, reset = false): Promise<void> {
    await this.store.queue({ kind: 'cutoff', session: this.id, race: r.id, minutes: reset ? null : Number(this.cutoffDraft()[r.id]) });
    this.message.set(this.t('cutoffSaved'));
    if (reset) this.cutoffDraft.update((d) => ({ ...d, [r.id]: '' }));
    await this.refresh();
  }

  /** The name of a signing device; a device that was never named (its name is its id) gets a number. */
  protected deviceLabel(d: { name: string }, index: number): string {
    return /^[0-9a-f]{16,}$/i.test(d.name) ? this.t('deviceUnnamed', { n: index + 1 }) : d.name;
  }

  protected hasAdded(r: DtsRace): boolean {
    return r.entries.some((e) => e.added || e.id !== `${e.licence ?? ''}@${r.id}`);
  }

  /** Downloads the full DTS file, the Tekenlijst file for "Tekenlijst verwerken" in MDS, or the text file with the added racers for the Deelname import of MDS. */
  protected async download(race?: string, format?: 'tekenlijst' | 'mdsnew'): Promise<void> {
    const query = [race ? `race=${encodeURIComponent(race)}` : '', format ? `format=${format}` : ''].filter(Boolean).join('&');
    const res = await this.read(`/${this.id}/export${query ? `?${query}` : ''}`, 30000).catch(() => null);
    if (res?.status === 200) {
      const fallback = format === 'tekenlijst' ? 'DTS_tekenlijst.xml' : format === 'mdsnew' ? 'DTS_nieuw.txt' : 'DTS_updated.xml';
      saveBlob(fileNameOf(res, fallback), res.text, format === 'mdsnew' ? 'text/plain' : 'application/xml');
      this.message.set('');
    } else this.message.set(this.t(res?.status === 422 && format === 'mdsnew' ? 'mdsNewRefused' : 'downloadFail'));
  }

  // ---- notes ----

  protected entryOf(id: string): string {
    for (const r of this.state()?.races ?? []) {
      const e = r.entries.find((x) => x.id === id);
      if (e) return e.name ? `${e.cap} ${e.name}` : e.cap;
    }
    return '';
  }

  /** A competitor as number and name, for the list of latest actions. */
  /** The race that a log line is about ("race 13"), or undefined for a line about a competitor. */
  protected raceOfEntry(entry?: string): DtsRace | undefined {
    const id = entry?.startsWith('race ') ? entry.slice(5) : '';
    return id ? this.state()?.races.find((r) => r.id === id) : undefined;
  }

  protected competitorOf(id: string): string {
    for (const r of this.state()?.races ?? []) {
      const e = r.entries.find((x) => x.id === id);
      if (e) return `${e.cap} ${e.name}`;
    }
    return '';
  }

  /** The warnings that involve a racer of the race. */
  protected warningsOf(r: DtsRace): DtsWarning[] {
    return (this.state()?.warnings ?? []).filter((w) => w.race === r.id || r.entries.some((e) => w.entries.includes(e.id)));
  }

  /** The sentence for a warning on a race card: a transponder shared with another race names the racers there. */
  protected warningText(w: DtsWarning, r: DtsRace): string {
    const races = this.state()?.races ?? [];
    const elsewhere = races.filter((x) => x.id !== r.id);
    const named = w.level === 'light' && elsewhere.some((x) => x.entries.some((e) => w.entries.includes(e.id)));
    return warningSentence(w, '', named ? elsewhere : races, this.t);
  }

  protected by(n: DtsNote): string {
    return this.t(n.by === 'manage' ? 'noteByManage' : 'noteBySign');
  }

  /** How long ago the last change was: fresh under 5 minutes, aging under 15, old after that; none when nothing changed yet. */
  protected changeAge(): 'fresh' | 'aging' | 'old' | '' {
    const c = this.state()?.changed;
    if (!c) return '';
    const minutes = (this.nowMs() - new Date(c).getTime()) / 60000;
    return minutes < 5 ? 'fresh' : minutes < 15 ? 'aging' : 'old';
  }

  protected changedText(): string {
    const c = this.state()?.changed;
    return c ? this.t('manageLastUpdate', { when: this.ago(c) }) : this.t('manageNoUpdate');
  }

  /** How long ago a moment was: just now, minutes, hours or days. */
  protected ago(iso: string): string {
    const minutes = Math.max(0, Math.floor((this.nowMs() - new Date(iso).getTime()) / 60000));
    if (minutes < 1) return this.t('agoNow');
    if (minutes < 60) return this.t('agoMin', { n: minutes });
    if (minutes < 1440) return this.t('agoHour', { n: Math.floor(minutes / 60) });
    return this.t('agoDay', { n: Math.floor(minutes / 1440) });
  }

  /** The link a signer opens, or nothing while the key is unknown. */
  protected signLink(): string {
    const key = this.signKey();
    return key ? `${location.origin}/dts/sign#${this.id}.${key}` : '';
  }

  private readonly qrCache = new Map<string, { size: number; path: string } | null>();
  protected qr(link: string): { size: number; path: string } | null {
    if (!this.qrCache.has(link)) {
      const code = qrEncode(link);
      this.qrCache.set(link, code ? { size: code.size + 8, path: qrPath(code) } : null);
    }
    return this.qrCache.get(link) ?? null;
  }

  protected printQr(): void {
    window.print();
  }

  protected readonly copied = signal('');
  /** Whether the panel with the sign link and its QR code is shown. */
  protected readonly linkOpen = signal(false);

  /** What the user chose per race; a race without a choice is folded while it is closed. */
  private readonly foldChoice = signal<ReadonlyMap<string, boolean>>(new Map());

  protected isCollapsed(r: DtsRace): boolean {
    return this.foldChoice().get(r.id) ?? !!r.closed;
  }

  protected toggleCollapsed(r: DtsRace): void {
    this.foldChoice.set(new Map(this.foldChoice()).set(r.id, !this.isCollapsed(r)));
  }
  protected async copy(link: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(link);
      this.copied.set(link);
    } catch {
      this.copied.set('');
    }
  }

  protected async removeDevice(d: DtsDevice): Promise<void> {
    if (!confirm(this.t('deviceRemoveConfirm', { name: d.name }))) return;
    await this.store.queue({ kind: 'device-remove', session: this.id, device: d.id });
    await this.refresh();
  }

  protected changedTitle(): string {
    const c = this.state()?.changed;
    return c ? clock(c) : '';
  }

  /** Who made an action: the system administrator by name, otherwise the signing device; a dash when no name is known (or the device was removed). */
  protected whoOf(a: DtsAction): string {
    if (a.by === 'sysadmin') return a.by;
    return (a.device && this.state()?.devices.find((d) => d.id === a.device)?.name) || '-';
  }

  /** The colour class of a log line in the PDF. */
  private toneOf(a: DtsAction): PdfLogLine['tone'] {
    if (NOTE_KINDS.includes(a.kind)) return 'note';
    if (a.kind === 'add-racer') return 'added';
    if (a.kind === 'reopen' || (a.kind === 'sign' && a.new !== '1')) return 'undone';
    return undefined;
  }

  protected actionText(a: DtsAction): string {
    const v = (s?: string) => s || '–';
    switch (a.kind) {
      case 'sign': return this.t(a.new === '1' ? 'actSign' : 'actUnsign');
      case 'cap': return this.t('actCap', { old: v(a.old), new: v(a.new) });
      case 'transponder1': return this.t('actT1', { old: v(a.old), new: v(a.new) });
      case 'transponder2': return this.t('actT2', { old: v(a.old), new: v(a.new) });
      case 'race': return this.t('actRace');
      case 'add-racer': return this.t('actAdd', { new: v(a.new) });
      case 'racer-note': return this.t('actRacerNote', { text: a.text ?? '' });
      case 'note-add': return this.t('actNoteAdd', { text: a.text ?? '' });
      case 'note-resolve': return this.t('actNoteResolve', { text: a.text ?? '' });
      case 'cutoff': return this.t('actCutoff', { new: v(a.new) });
      case 'close': return this.t('actClose');
      case 'reopen': return this.t('actReopen');
      default: return a.kind;
    }
  }

  protected deviceClockSeconds(offsetMs: number): number {
    return Math.round(Math.abs(offsetMs) / 1000);
  }
  protected readonly noKey: DtsKey = 'noKey';
}
