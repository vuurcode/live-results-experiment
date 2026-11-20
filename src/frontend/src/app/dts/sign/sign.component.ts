import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { DtsNotices } from '../dts-notices';
import { installInstantTooltips } from '../dts-tooltip';
import { DtsText } from '../dts-text';
import type { DtsSessionMeta } from '../dts-storage';
import { DtsSignEngine } from '../dts-sign-engine';
import { parseFragment } from '../dts-api';
import { qrEncode, qrPath } from '../qr';
import { homeScreenHint, installable } from '../dts-pwa';
import { applyOp, byCapOpenFirst, clock, findRacers, minutesToCutoff, normalizeCap, raceProblems, normalizeTransponder, splitName, typeCap, editTransponder, transponderKeyboard, validCap, validTransponder, warningsFor, watermarkOf } from '../dts.logic';
import { warningSentence } from '../dts-warning-text';
import type { DtsAction, DtsEntry, DtsRace, DtsWarning } from '../dts.models';
import type { DtsKey } from '../dts.strings';
import { keepScreenAwake } from '../../wake-lock';

type Screen = 'loading' | 'home' | 'rider' | 'edit' | 'add' | 'share' | 'failed' | 'denied' | 'missing' | 'name' | 'race' | 'landing';
type Field = 'cap' | 'transponder1' | 'transponder2' | 'race' | 'note';


/** The sign page: one racer at a time, large type, one question per screen. All changes land on the device first. */
@Component({
  selector: 'app-dts-sign',
  standalone: true,
  templateUrl: './sign.component.html',
  styleUrls: ['./sign.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DtsSignComponent implements OnInit {
  protected readonly engine = inject(DtsSignEngine);
  private readonly destroy = inject(DestroyRef);
  protected readonly text = new DtsText();
  private readonly tabSync = effect(() => {
    document.title = this.tabTitle();
  });
  protected readonly t = this.text.t;

  /** Every screen of an open session has its own address (`?s=…&view=…`), so the browser's back button, a reload and a bookmark work. */
  private readonly viewSync = effect(() => {
    const screen = this.screen();
    const race = this.raceId();
    const rider = this.riderId();
    const field = this.field();
    if (!this.viewReady) return;
    const q = new URLSearchParams(location.search);
    for (const k of ['view', 'race', 'rider', 'field']) q.delete(k);
    if (screen === 'race') { q.set('view', 'race'); q.set('race', race); }
    else if (screen === 'rider' || screen === 'edit') {
      q.set('view', screen);
      q.set('rider', rider);
      if (screen === 'edit') q.set('field', field);
    } else if (screen === 'add') {
      q.set('view', 'add');
      if (this.raceFixed()) q.set('race', this.draft().race);
    } else if (screen === 'share') q.set('view', 'share');
    else if (screen !== 'home') return;
    const url = `${location.pathname}?${q}${location.hash}`;
    if (url !== `${location.pathname}${location.search}${location.hash}`) history.pushState(null, '', url);
  });
  private viewReady = false;
  private readonly onPop = () => this.restoreView();

  /** Shows the screen the address names, when the session has it; else the start of the sign page. */
  private restoreView(): void {
    this.viewReady = false;
    const q = new URLSearchParams(location.search);
    const st = this.state();
    const view = q.get('view');
    const rider = q.get('rider') ?? '';
    const known = (id: string) => !!st?.races.some((r) => r.entries.some((e) => e.id === id));
    if (view === 'race' && st?.races.some((r) => r.id === q.get('race'))) {
      this.fromRace.set(false);
      this.raceId.set(q.get('race') ?? '');
      this.screen.set('race');
    } else if ((view === 'rider' || view === 'edit') && known(rider)) {
      const race = st?.races.find((r) => r.entries.some((e) => e.id === rider));
      this.fromRace.set(false);
      this.raceId.set(race?.id ?? '');
      this.openRider(rider);
      const f = q.get('field') as Field | null;
      if (view === 'edit' && f && ['cap', 'transponder1', 'transponder2', 'note'].includes(f)) this.edit(f);
    } else if (view === 'share') this.screen.set('share');
    else if (view === 'add') this.startAdd(st?.races.find((r) => r.id === q.get('race')));
    else if (this.screen() !== 'name' && this.screen() !== 'loading') {
      this.fromRace.set(false);
      this.screen.set('home');
    }
    queueMicrotask(() => (this.viewReady = true));
  }

  protected readonly screen = signal<Screen>('loading');
  /** The front page's explanation of how a signer gets in, shown after pressing the sign button. */
  protected readonly signHint = signal(false);

  /** The front page's sign button: continues the most recent list of this device, or explains how to get one. */
  protected signIn(): void {
    const latest = this.sessions()[0];
    if (latest) location.assign(`/dts/?s=${latest.id}`);
    else this.signHint.update((v) => !v);
  }
  protected readonly typed = signal('');
  protected readonly riderId = signal('');
  /** The race whose overview is open, or the one a rider was opened from (the rider's back button returns there). */
  protected readonly raceId = signal('');
  private readonly fromRace = signal(false);
  protected readonly field = signal<Field>('cap');
  protected readonly input = signal('');
  protected readonly noteDraft = signal('');
  protected readonly message = signal('');
  protected readonly copied = signal('');
  /** Entries by number, with the signed ones after the open ones. */
  protected readonly byCap = byCapOpenFirst;
  protected readonly nowMs = signal(Date.now());
  protected readonly nameDraft = signal('');

  // add-a-racer flow
  protected readonly draft = signal({
    who: '',
    licence: '',
    race: '',
    cap: '',
    t1: '',
    t2: '',
    signed: false,
  });

  protected readonly state = this.engine.state;

  protected readonly rider = computed<(DtsEntry & { raceId: string }) | null>(() => {
    const id = this.riderId();
    for (const r of this.state()?.races ?? []) {
      const e = r.entries.find((x) => x.id === id);
      if (e) return { ...e, raceId: r.id };
    }
    return null;
  });
  /** The races in start order, the closed ones below those still open. */
  protected readonly orderedRaces = computed(() => [...(this.state()?.races ?? [])].sort((a, b) => Number(!!a.closed) - Number(!!b.closed)));
  protected readonly riderRace = computed(() => this.state()?.races.find((r) => r.id === this.rider()?.raceId) ?? null);
  protected readonly matches = computed(() => findRacers(this.state()?.races ?? [], this.typed()));
  /** The device clock moved to the host's time, so the cutoff does not depend on a phone's wrong clock. */
  protected readonly corrected = computed(() => this.nowMs() + this.engine.offset());
  protected readonly riderWarnings = computed(() => {
    const r = this.rider();
    return r ? warningsFor(this.state()?.warnings ?? [], r.id) : [];
  });
  protected readonly riderNotes = computed(() => (this.state()?.notes ?? []).filter((n) => n.entry === this.riderId() && !n.resolved));
  protected readonly riderNotices = computed(() => this.engine.notices().filter((n) => n.entry === this.riderId()));
  protected noticeField = (kind: string): string =>
    this.t(({ cap: 'fieldCap', transponder1: 'fieldT1', transponder2: 'fieldT2', race: 'fieldRace' } as Record<string, DtsKey>)[kind] ?? 'fieldCap').toLowerCase();
  protected readonly riderActions = computed(() => this.engine.actions().filter((a) => a.entry === this.riderId() && a.kind !== 'sign').slice(0, 4));
  protected readonly logRows = computed(() => this.engine.actions().slice(0, 60));
  protected readonly preview = computed(() => this.editWarnings());
  protected readonly editError = computed<DtsKey | ''>(() => {
    const v = this.input();
    switch (this.field()) {
      case 'cap': return v && !validCap(normalizeCap(v)) ? 'badCap' : '';
      case 'transponder1':
      case 'transponder2': return v && !validTransponder(normalizeTransponder(v)) ? 'badTransponder' : '';
      default: return '';
    }
  });

  /** The add-to-home-screen advice shows once per device, after the first session exists. */
  protected homeHint = signal(false);

  protected dismissHomeHint(): void {
    this.homeHint.set(false);
    try {
      localStorage.setItem('dts-home-hint', '1');
    } catch {
      // not remembered: it shows again next time
    }
  }

  ngOnInit(): void {
    installInstantTooltips();
    installable();
    try {
      this.homeHint.set(homeScreenHint() && !localStorage.getItem('dts-home-hint'));
    } catch {
      this.homeHint.set(homeScreenHint());
    }
    const timer = setInterval(() => this.nowMs.set(Date.now()), 15000);
    addEventListener('popstate', this.onPop);
    this.destroy.onDestroy(() => removeEventListener('popstate', this.onPop));
    const release = keepScreenAwake(navigator as never, document, 30 * 60 * 1000);
    this.destroy.onDestroy(() => {
      clearInterval(timer);
      release();
      this.engine.stop();
    });
    const link = parseFragment(location.hash);
    const wanted = new URLSearchParams(location.search).get('s');
    const opened = (id: string) => {
      this.keepInUrl(id);
      if (this.engine.nameAsked()) {
        this.nameDraft.set(this.engine.deviceName());
        this.screen.set('home');
        this.restoreView();
      } else {
        this.nameDraft.set(this.engine.suggestedName());
        this.screen.set('name');
      }
      void this.loadSessions();
    };
    if (!link) {
      if (location.hash) {
        this.screen.set('denied');
        return;
      }
      // without ?s= the front page lets the person choose, also on a device that has lists
      if (!wanted) {
        this.screen.set('landing');
        void this.loadSessions();
        return;
      }
      this.screen.set('loading');
      void this.engine.resume(wanted).then((ok) => {
        if (ok) opened(this.engine.sessionId());
        // a ?s= this device has no copy of needs the full link
        else this.screen.set('missing');
        if (!ok) void this.loadSessions();
      });
      return;
    }
    void this.engine.open(link.id, link.key).then((r) => {
      if (r === 'ok') opened(link.id);
      else this.screen.set(r === 'denied' ? 'denied' : 'failed');
    });
  }

  /** The notices dismissed on this device for the open session. */
  protected readonly dismissed = computed(() => new DtsNotices(this.engine.sessionId()));

  /** Sentences for races that look wrong: empty, or starting far from now (the wrong file or date). */
  protected readonly problems = computed(() =>
    (this.state()?.races ?? []).flatMap((r) =>
      raceProblems(this.corrected(), r)
        .filter((p) => p.kind === 'empty')
        .map((p) => ({ key: `${r.id}:${p.kind}`, text: this.text.t(p.kind === 'empty' ? 'raceEmpty' : p.kind === 'past' ? 'racePast' : 'raceFuture', { race: r.title, days: p.days, date: r.start.slice(0, 10) + ' ' + r.start.slice(11, 16) }) }))
        .filter((p) => !this.dismissed().isHidden(p.key)),
    ),
  );

  /** The sessions this device has a copy of, to switch between. */
  protected sessions = signal<DtsSessionMeta[]>([]);

  /** Removes a list's copy from this device after asking; the server and the other devices keep theirs. */
  protected async forgetList(m: DtsSessionMeta): Promise<void> {
    if (!confirm(this.t('forgetListConfirm', { name: this.sessionParts(m).title }))) return;
    const current = m.id === this.engine.sessionId();
    if (current) this.engine.stop();
    await this.engine.forget(m.id);
    if (current) location.assign('/dts/');
    else await this.loadSessions();
  }

  private async loadSessions(): Promise<void> {
    this.sessions.set(await this.engine.knownSessions());
  }

  /** A list on this device as a heading (place and name), the races (time and category) and when it was used. */
  protected sessionParts(m: DtsSessionMeta): { title: string; races: string; when: string } {
    const when = new Date(m.usedAt).toLocaleString(this.text.lang(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const titles = m.label.split('\n').filter(Boolean);
    const split = titles.map((t) => t.split(' - '));
    if (split.length === 0 || split.some((p) => p.length < 3)) return { title: titles.join(', ') || m.id.slice(0, 6), races: '', when };
    return {
      title: split[0].slice(0, -2).join(' - '),
      races: split.map((p) => p.slice(-2).join(' ')).join(' · '),
      when,
    };
  }

  protected go(url: string): void {
    location.assign(url);
  }

  /** The address of a session on this device; the secret key is not in it. */
  protected sessionHref = (id: string): string => `?s=${id}`;

  /** Puts the session in the address (other parameters and the link's key stay), so a reload or a bookmark returns to it. */
  private keepInUrl(id: string): void {
    const q = new URLSearchParams(location.search);
    q.set('s', id);
    q.delete('new');
    history.replaceState(history.state, '', `${location.pathname}?${q}${location.hash}`);
  }

  protected signLink = (): string => this.engine.link();

  private qrFor = '';
  private qrCache: { size: number; path: string } | null = null;
  /** The sign link as a QR code for another phone; nothing when the link does not fit. */
  protected qr = (): { size: number; path: string } | null => {
    const link = this.signLink();
    if (link !== this.qrFor) {
      this.qrFor = link;
      const code = link ? qrEncode(link) : null;
      this.qrCache = code ? { size: code.size + 8, path: qrPath(code) } : null;
    }
    return this.qrCache;
  };
  protected printQr(): void {
    window.print();
  }

  protected async copy(which: 'sign'): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.signLink());
      this.copied.set(which);
    } catch {
      this.copied.set('');
    }
  }

  protected async shareLink(): Promise<void> {
    const url = this.signLink();
    if (navigator.share) {
      try {
        await navigator.share({ url });
        return;
      } catch {
        // cancelled: fall back to copy
      }
    }
    await this.copy('sign');
  }

  protected canShare = (): boolean => typeof navigator.share === 'function';

  // ---- home ----

  protected setTyped(event: Event): void {
    this.typed.set((event.target as HTMLInputElement).value);
  }

  protected openRider(id: string): void {
    this.riderId.set(id);
    this.typed.set('');
    this.message.set('');
    this.screen.set('rider');
  }

  protected openRace(id: string): void {
    this.raceId.set(id);
    this.fromRace.set(false);
    this.screen.set('race');
  }

  protected openRiderOfRace(id: string): void {
    this.openRider(id);
    this.fromRace.set(true);
  }

  /** Back from a rider: to the race overview it was opened from, else to the start of the sign page. */
  protected back(): void {
    if (this.fromRace()) this.screen.set('race');
    else this.home();
  }

  protected readonly race = computed(() => (this.state()?.races ?? []).find((r) => r.id === this.raceId()) ?? null);

  /** The look of a number: a note wins over a change, a change over a plain signature. */
  protected stateOf(e: DtsEntry): 'note' | 'changed' | 'signed' | 'open' {
    if (this.notedEntries().has(e.id)) return 'note';
    if (e.signed) return e.changed ? 'changed' : 'signed';
    return 'open';
  }

  protected markOf(e: DtsEntry): string {
    return watermarkOf(this.stateOf(e), e.signed);
  }
  protected stateLabel(e: DtsEntry): string {
    const s = this.stateOf(e);
    return `${e.cap}: ${this.t(s === 'note' ? 'legendNote' : s === 'changed' ? 'legendChanged' : s === 'signed' ? 'legendSigned' : 'legendOpen')}`;
  }

  private readonly notedEntries = computed(() => new Set((this.state()?.notes ?? []).filter((n) => !n.resolved).map((n) => n.entry)));

  /** The screens that have a way back; it sits in the header, top left. */
  protected readonly canGoBack = computed(() => ['race', 'rider', 'edit', 'add', 'share'].includes(this.screen()));

  protected goBack(): void {
    switch (this.screen()) {
      case 'rider': this.back(); break;
      case 'edit': this.screen.set('rider'); break;
      case 'add': this.home(); break;
      default: this.home();
    }
  }

  protected home(): void {
    this.fromRace.set(false);
    this.screen.set('home');
    this.typed.set('');
  }

  protected async saveName(): Promise<void> {
    await this.engine.setDeviceName(this.nameDraft());
  }

  protected async confirmName(): Promise<void> {
    if (!this.nameDraft().trim()) return;
    await this.saveName();
    this.screen.set('home');
    this.restoreView();
  }

  protected setNameDraft(event: Event): void {
    this.nameDraft.set((event.target as HTMLInputElement).value);
  }

  protected async download(race?: string): Promise<void> {
    const r = await this.engine.download(race);
    this.message.set(r === 'ok' ? '' : this.t('downloadFail'));
  }

  protected progress(race: DtsRace): string {
    const total = race.signed + race.unsigned;
    if (race.closed) return `${this.t('signedOf', { signed: race.signed, total })}, ${this.t('raceLockedShort')}`;
    const left = minutesToCutoff(this.corrected(), race);
    const when = left >= 0 ? this.t('closesIn', { min: left }) : this.t('closedAgo', { min: -left });
    return `${this.t('signedOf', { signed: race.signed, total })}, ${when}`;
  }

  // ---- rider ----

  protected async sign(on: boolean): Promise<void> {
    const r = this.rider();
    if (!r) return;
    await this.engine.change(r.id, { kind: 'sign', on });
  }

  protected setNoteDraft(event: Event): void {
    const el = event.target as HTMLTextAreaElement;
    this.noteDraft.set(el.value.replace(/\s+/g, ' ').trimStart().slice(0, 200));
    // browsers without field-sizing grow the box by hand
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  protected async addNoteInline(): Promise<void> {
    const r = this.rider();
    const text = this.noteDraft().trim();
    if (!r || !text) return;
    this.noteDraft.set('');
    await this.engine.addNote(r.id, text);
  }

  protected edit(field: Field): void {
    const r = this.rider();
    if (!r || this.riderRace()?.closed) return;
    this.field.set(field);
    this.input.set(field === 'cap' ? r.cap : field === 'transponder1' ? (r.t1 ?? '') : field === 'transponder2' ? (r.t2 ?? '') : '');
    this.screen.set('edit');
  }

  /** What the field being typed in holds: a cap number, a transponder or a note. */
  private readonly inputKind = computed<'cap' | 'transponder' | 'note'>(() => {
    switch (this.field()) {
      case 'cap': return 'cap';
      case 'transponder1': case 'transponder2': return 'transponder';
      default: return 'note';
    }
  });

  /** Sets the keyboard of a transponder field to what the caret is at: letters in front, digits behind. */
  protected fitKeyboard(event: Event): void {
    const el = event.target as HTMLInputElement;
    if (el.dataset['tp'] === undefined) return;
    el.inputMode = transponderKeyboard(el.selectionStart ?? el.value.length, el.value);
  }
  protected readonly inputMax = computed(() => ({ cap: 4, transponder: 8, note: 200 })[this.inputKind()]);

  /** Keeps the typed text within what the field allows, also in the element itself. */
  protected setInput(event: Event): void {
    const el = event.target as HTMLInputElement;
    const kind = this.inputKind();
    if (kind === 'transponder') {
      this.input.set(this.fitTransponder(el, this.input()));
      return;
    }
    const v = kind === 'cap' ? typeCap(el.value) : el.value.trimStart().slice(0, this.inputMax());
    if (el.value !== v) el.value = v;
    this.input.set(v);
  }

  /** Puts the reformatted transponder in the element and keeps the caret where the person was typing. */
  private fitTransponder(el: HTMLInputElement, previous: string): string {
    const { value, caret } = editTransponder(el.value, el.selectionStart ?? el.value.length, previous);
    el.value = value;
    el.setSelectionRange(caret, caret);
    return value;
  }

  protected fieldTitle(f: Field): DtsKey {
    return (
      {
        cap: 'fieldCap',
        transponder1: 'fieldT1',
        transponder2: 'fieldT2',
        race: 'fieldRace',
        note: 'fieldNote',
      } as const
    )[f];
  }

  /** The warnings the typed value would cause, shown before saving. */
  private editWarnings() {
    const st = this.state();
    const r = this.rider();
    const f = this.field();
    const v = f === 'cap' ? normalizeCap(this.input()) : normalizeTransponder(this.input());
    if (!st || !r || this.editError() || !v || (f !== 'cap' && f !== 'transponder1' && f !== 'transponder2')) return [];
    const next = applyOp(st, { id: 'preview', at: '', kind: f, entry: r.id, value: v });
    return warningsFor(next.warnings, r.id);
  }

  protected async saveEdit(): Promise<void> {
    const r = this.rider();
    if (!r || this.editError()) return;
    const f = this.field();
    const raw = this.input().trim();
    if (f === 'cap') {
      if (!raw) return;
      // saving what is already there changes nothing, so it logs nothing either
      if (normalizeCap(raw) !== r.cap) await this.engine.change(r.id, { kind: 'cap', value: normalizeCap(raw) });
    } else if (f === 'transponder1' || f === 'transponder2') {
      const value = raw ? normalizeTransponder(raw) : '';
      if (value !== ((f === 'transponder1' ? r.t1 : r.t2) ?? '')) await this.engine.change(r.id, { kind: f, value });
    } else if (f === 'note') {
      if (!raw) return;
      await this.engine.addNote(r.id, raw);
    }
    this.screen.set('rider');
  }

  protected async moveTo(race: DtsRace): Promise<void> {
    const r = this.rider();
    if (!r || race.id === r.raceId) return;
    await this.engine.change(r.id, { kind: 'race', value: race.id });
    this.screen.set('rider');
  }

  protected async resolve(noteId: string): Promise<void> {
    await this.engine.resolveNote(noteId, this.riderId());
  }

  // ---- add a racer ----

  /** Whether the add form was started from a race, which then is not asked. */
  protected readonly raceFixed = signal(false);

  protected startAdd(race?: DtsRace): void {
    this.raceFixed.set(!!race);
    this.draft.set({ who: '', licence: this.nextLicence(), race: race?.id ?? this.state()?.races.find((r) => !r.closed)?.id ?? '', cap: '', t1: '', t2: '', signed: false });
    this.screen.set('add');
  }

  /** The number a new rider gets: ZZ and five digits, counting up from the highest one in use. */
  private nextLicence(): string {
    let highest = 0;
    for (const r of this.state()?.races ?? []) {
      for (const e of r.entries) {
        const m = /^ZZ(\d{5,6})$/.exec(e.newLicence ?? '');
        if (m) highest = Math.max(highest, Number(m[1]));
      }
    }
    return `ZZ${String(highest + 1).padStart(5, '0')}`;
  }

  /** Keeps what is typed in the add form within what the field allows, also in the element itself. */
  protected setDraft(field: 'who' | 'licence' | 'cap' | 't1' | 't2', event: Event): void {
    const el = event.target as HTMLInputElement;
    const v = field === 'cap' ? typeCap(el.value) : field === 'who' ? el.value.trimStart().slice(0, 45) : field === 'licence' ? el.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) : this.fitTransponder(el, this.draft()[field]);
    if (el.value !== v) el.value = v;
    this.draft.update((d) => ({ ...d, [field]: v }));
  }

  protected setDraftRace(event: Event): void {
    const race = (event.target as HTMLSelectElement).value;
    this.draft.update((d) => ({ ...d, race }));
  }

  protected setDraftSigned(event: Event): void {
    const signed = (event.target as HTMLInputElement).checked;
    this.draft.update((d) => ({ ...d, signed }));
  }

  protected readonly addErrors = computed<{ cap: DtsKey | ''; t1: DtsKey | ''; t2: DtsKey | '' }>(() => {
    const d = this.draft();
    return {
      cap: d.cap && !validCap(normalizeCap(d.cap)) ? 'badCap' : '',
      t1: d.t1 && !validTransponder(normalizeTransponder(d.t1)) ? 'badTransponder' : '',
      t2: d.t2 && !validTransponder(normalizeTransponder(d.t2)) ? 'badTransponder' : '',
    };
  });

  /** What still blocks saving: a name, a race, a valid number and a valid first transponder are needed; the second transponder is optional. */
  private readonly addProblems = computed<DtsKey[]>(() => {
    const d = this.draft();
    const e = this.addErrors();
    const problems: DtsKey[] = [];
    if (!d.who.trim()) problems.push('addNeedName');
    if (!d.race) problems.push('addNeedRace');
    if (!d.cap) problems.push('addNeedCap');
    else if (e.cap) problems.push(e.cap);
    if (!d.t1) problems.push('addNeedT1');
    else if (e.t1) problems.push(e.t1);
    if (e.t2) problems.push('addBadT2');
    return problems;
  });

  protected readonly addValid = computed(() => this.addProblems().length === 0);

  /** One reason per line, for the hover of the disabled save button. */
  protected readonly addWhy = computed(() => this.addProblems().map((k) => this.t(k)).join('\n'));

  protected readonly addWarnings = computed(() => {
    const st = this.state();
    const d = this.draft();
    if (!st || !this.addValid()) return [];
    const next = applyOp(st, { id: 'preview', at: '', kind: 'add-racer', who: d.who.trim(), licence: d.licence, race: d.race, cap: normalizeCap(d.cap), t1: normalizeTransponder(d.t1), t2: d.t2 ? normalizeTransponder(d.t2) : '', signed: d.signed });
    return warningsFor(next.warnings, 'preview');
  });

  protected async addConfirm(): Promise<void> {
    if (!this.addValid()) return;
    const d = this.draft();
    const id = await this.engine.addRacer({ who: d.who.trim(), licence: d.licence, race: d.race, cap: normalizeCap(d.cap), t1: normalizeTransponder(d.t1), t2: d.t2 ? normalizeTransponder(d.t2) : '', signed: d.signed });
    // a note marks the new racer on the overview and the list so the registrar sees it was added late
    await this.engine.addNote(id, this.t('addedNote'));
    this.openRider(id);
  }

  // ---- presentation helpers ----

  protected nameOf(e: DtsEntry) {
    return splitName(e.name);
  }

  protected raceCode(id: string): string {
    return this.state()?.races.find((r) => r.id === id)?.title ?? '';
  }

  /** A race title as its place and, for a second line, the time and category after it. */
  protected raceLines(id: string): { place: string; rest: string } {
    const title = this.raceCode(id);
    const i = title.indexOf(' - ');
    return i < 0 ? { place: title, rest: '' } : { place: title.slice(0, i), rest: title.slice(i + 3) };
  }

  protected warningText(w: DtsWarning, entryId: string): string {
    return warningSentence(w, entryId, this.state()?.races ?? [], this.t);
  }

  protected clockOf = clock;

  protected signedLine(e: DtsEntry): string {
    const time = clock(e.signedAt);
    return e.signedBy ? this.t('signedBy', { who: e.signedBy, time }) : this.t('signedAt', { time });
  }

  protected actionText(a: DtsAction): string {
    const k = a.kind;
    const v = (s?: string) => s || '–';
    if (k === 'sign') return this.t(a.new === '1' ? 'actSign' : 'actUnsign');
    if (k === 'cap') return this.t('actCap', { old: v(a.old), new: v(a.new) });
    if (k === 'transponder1') return this.t('actT1', { old: v(a.old), new: v(a.new) });
    if (k === 'transponder2') return this.t('actT2', { old: v(a.old), new: v(a.new) });
    if (k === 'race') return this.t('actRace');
    if (k === 'add-racer') return this.t('actAdd', { new: v(a.new) });
    if (k === 'racer-note') return this.t('actRacerNote', { text: a.text ?? '' });
    if (k === 'note-add') return this.t('actNoteAdd', { text: a.text ?? '' });
    if (k === 'note-resolve') return this.t('actNoteResolve');
    if (k === 'cutoff') return this.t('actCutoff', { new: v(a.new) });
    if (k === 'close') return this.t('actClose');
    if (k === 'reopen') return this.t('actReopen');
    return k;
  }

  protected actionWho(a: DtsAction): string {
    const e = this.entryOfAction(a);
    return e ? `${e.cap} ${splitName(e.name).last}` : '';
  }

  /** The competitor an action is about, when the list still has them. */
  protected entryOfAction(a: DtsAction): DtsEntry | undefined {
    return a.entry ? this.state()?.races.flatMap((r) => r.entries).find((x) => x.id === a.entry) : undefined;
  }

  /** Opens the competitor from a log row. */
  protected openFromLog(a: DtsAction): void {
    const e = this.entryOfAction(a);
    if (e) this.openRider(e.id);
  }

  protected get transponderField(): boolean {
    return this.field() === 'transponder1' || this.field() === 'transponder2';
  }

  /** Sets the search in motion from the button or the enter key: it opens the first match. */
  protected search(): void {
    const first = this.matches()[0];
    if (first) this.openRider(first.id);
  }

  /** The title of the browser tab: the screen, then the application. */
  private tabTitle(): string {
    const name = this.t('appName');
    let page = '';
    switch (this.screen()) {
      case 'rider': page = this.t('tabNumber', { cap: this.rider()?.cap || '–' }); break;
      case 'edit': page = this.t(this.fieldTitle(this.field())); break;
      case 'add': page = this.t('tabAdd'); break;
      case 'share': page = this.t('shareLink'); break;
    }
    return page ? `${page} · ${name}` : name;
  }

  protected statusText(): string {
    const s = this.engine.status();
    if (s === 'denied') return this.t('denied');
    if (s === 'deleted') return this.t('listDeleted');
    if (s === 'offline') return this.t('offline');
    const n = this.engine.pending();
    if (n > 0) return this.t('waiting', { n });
    const last = this.lastSyncText();
    return last ? `${this.t('allSent')} · ${last}` : this.t('allSent');
  }

  protected lastSyncText(): string {
    const ts = this.engine.lastSync();
    return ts ? this.t('lastSync', { time: clock(new Date(ts).toISOString()) }) : '';
  }
}
