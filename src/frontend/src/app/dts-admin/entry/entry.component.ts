import { clearSiblingField } from '../../dts/dts-field';
import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { DtsText } from '../../dts/dts-text';
import { randomId } from '../../dts/dts-api';
import { adminStore } from '../admin-store';
import { AdminSyncStatus } from '../sync-status';
import { normalizeCap, normalizeTransponder, validCap, validTransponder } from '../../dts/dts.logic';
import type { DtsEntry, DtsOp, DtsOpKind, DtsState } from '../../dts/dts.models';
import type { DtsKey } from '../../dts/dts.strings';

const SESSION_ID = /^[0-9a-f]{32}$/;

interface Draft {
  who: string;
  licence: string;
  race: string;
  cap: string;
  t1: string;
  t2: string;
  signed: boolean;
}

/**
 * Management form that adds a competitor to a list (`/dts-admin/add?s=&race=`) or changes one (`/dts-admin/edit?s=&c=`).
 * The changes are operations like the signers make, stored under the admin's own device name.
 */
@Component({
  selector: 'app-dts-admin-entry',
  imports: [AdminSyncStatus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="page">
      <header class="bar">
        <a class="back" [href]="backHref()">← {{ t('back') }}</a>
        <button type="button" class="lang" (click)="text.toggle()" [attr.lang]="text.lang() === 'nl' ? 'en' : 'nl'">NL / EN</button>
      </header>
      <app-admin-sync [t]="t" />
      @if (missing()) {
        <p class="banner" role="alert">{{ t('adminNotFound') }}</p>
      } @else if (state()) {
        <h1>{{ mode === 'add' ? t('addRacer') : t('editHeading') }}</h1>
        <form (submit)="$event.preventDefault(); save()">
          <label class="field">
            <span>{{ t('addRace') }}</span>
            <select name="race" (change)="set('race', $event)">
              @for (race of state()?.races; track race.id) {
                <option [value]="race.id" [disabled]="race.closed" [selected]="race.id === draft().race">{{ race.title }}</option>
              }
            </select>
          </label>
          <label class="field">
            <span>{{ t('addCap') }}</span>
            <input type="text" name="cap" autocomplete="off" autocapitalize="characters" maxlength="4" [value]="draft().cap" (input)="set('cap', $event)" [attr.aria-invalid]="!!errors().cap" />
          </label>
          <label class="field">
            <span>{{ t('addWho') }}</span>
            <input type="text" name="who" autocomplete="off" autocapitalize="words" maxlength="45" [value]="draft().who" (input)="set('who', $event)" [disabled]="mode === 'edit'" />
          </label>
          <label class="field">
            <span>{{ t('addLicence') }}</span>
            <input type="text" name="licence" autocomplete="off" autocapitalize="characters" maxlength="8" [value]="draft().licence" (input)="set('licence', $event)" [disabled]="mode === 'edit'" />
          </label>
          <label class="field">
            <span><img class="chip" src="/dts-transponder-red.webp" alt="" width="66" height="44" /> {{ t('addT1') }}</span>
            <span class="clearable"><input type="text" name="t1" autocomplete="off" autocapitalize="characters" [placeholder]="t('transponderHint')" [value]="draft().t1" (input)="set('t1', $event)" [attr.aria-invalid]="!!errors().t1" />
              @if (draft().t1) { <button type="button" class="clear" [attr.aria-label]="t('clearField')" [title]="t('clearField')" (click)="clearField($event)">×</button> }
            </span>
          </label>
          <label class="field">
            <span><img class="chip" src="/dts-transponder-blue.webp" alt="" width="66" height="44" /> {{ t('addT2') }}</span>
            <span class="clearable"><input type="text" name="t2" autocomplete="off" autocapitalize="characters" [placeholder]="t('transponderHint')" [value]="draft().t2" (input)="set('t2', $event)" [attr.aria-invalid]="!!errors().t2" />
              @if (draft().t2) { <button type="button" class="clear" [attr.aria-label]="t('clearField')" [title]="t('clearField')" (click)="clearField($event)">×</button> }
            </span>
          </label>
          <label class="check">
            <input type="checkbox" name="signed" [checked]="draft().signed" (change)="setSigned($event)" />
            <span>{{ t('addSigned') }}</span>
          </label>
          @for (err of errorKeys(); track err) {
            <p class="banner" role="alert">{{ t(err) }}</p>
          }
          @if (locked()) {
            <p class="banner" role="alert">{{ t('adminRaceClosed') }}</p>
          }
          @if (failed()) {
            <p class="banner" role="alert">{{ t('adminSaveFailed') }}</p>
          }
          <button type="submit" class="big primary" [disabled]="!valid() || busy() || locked()">{{ t('save') }}</button>
        </form>
      }
    </main>
  `,
  styleUrl: '../admin.scss',
})
export class DtsAdminEntryComponent implements OnInit {
  protected readonly text = new DtsText();
  protected readonly t = this.text.t;
  protected readonly mode: 'add' | 'edit' = location.pathname.replace(/\/$/, '').endsWith('/edit') ? 'edit' : 'add';
  private readonly params = new URLSearchParams(location.search);
  private readonly id = this.params.get('s') ?? '';
  private readonly entryId = this.params.get('c') ?? '';
  protected readonly state = signal<DtsState | null>(null);
  protected readonly missing = signal(false);
  /** The race of the competitor being changed is closed, so the server would drop the change. */
  protected readonly locked = signal(false);
  protected readonly busy = signal(false);
  protected readonly failed = signal(false);
  protected readonly draft = signal<Draft>({ who: '', licence: '', race: this.params.get('race') ?? '', cap: '', t1: '', t2: '', signed: false });
  private original: Draft | null = null;

  protected readonly errors = computed<{ cap: DtsKey | ''; t1: DtsKey | ''; t2: DtsKey | '' }>(() => {
    const d = this.draft();
    return {
      cap: d.cap && !validCap(normalizeCap(d.cap)) ? 'badCap' : '',
      t1: d.t1 && !validTransponder(normalizeTransponder(d.t1)) ? 'badTransponder' : '',
      t2: d.t2 && !validTransponder(normalizeTransponder(d.t2)) ? 'badTransponder' : '',
    };
  });
  protected readonly errorKeys = computed(() => [...new Set(Object.values(this.errors()).filter((k): k is DtsKey => !!k))]);
  protected readonly valid = computed(() => {
    const d = this.draft();
    return !this.errorKeys().length && !!d.cap.trim() && (this.mode === 'edit' || !!d.who.trim()) && !!d.race;
  });

  protected readonly clearField = clearSiblingField;

  protected backHref(): string {
    return SESSION_ID.test(this.id) ? `/dts-admin/list?s=${this.id}` : '/dts-admin/';
  }

  async ngOnInit(): Promise<void> {
    document.title = `${this.mode === 'add' ? this.t('addRacer') : this.t('editHeading')} · ${this.t('appName')}`;
    if (!SESSION_ID.test(this.id)) return void this.missing.set(true);
    try {
      const got = await adminStore().state(this.id);
      if (!got || got === 'gone') return void this.missing.set(true);
      const st = got.state;
      if (this.mode === 'edit') {
        const found = st.races.flatMap((r) => r.entries.map((e) => ({ e, race: r.id }))).find((x) => x.e.id === this.entryId);
        if (!found) return void this.missing.set(true);
        this.locked.set(!!st.races.find((r) => r.id === found.race)?.closed);
        this.original = this.draftOf(found.e, found.race);
        this.draft.set({ ...this.original });
      } else if (!this.draft().race || !st.races.some((r) => r.id === this.draft().race && !r.closed)) {
        this.draft.update((d) => ({ ...d, race: st.races.find((r) => !r.closed)?.id ?? '' }));
      }
      this.state.set(st);
    } catch {
      this.missing.set(true);
    }
  }

  private draftOf(e: DtsEntry, race: string): Draft {
    return { who: e.name, licence: e.licence ?? '', race, cap: e.cap, t1: e.t1 ?? '', t2: e.t2 ?? '', signed: e.signed };
  }

  protected set(key: Exclude<keyof Draft, 'signed'>, event: Event): void {
    const value = (event.target as HTMLInputElement | HTMLSelectElement).value;
    this.draft.update((d) => ({ ...d, [key]: value }));
  }

  protected setSigned(event: Event): void {
    const signed = (event.target as HTMLInputElement).checked;
    this.draft.update((d) => ({ ...d, signed }));
  }

  private opsToSend(): DtsOp[] {
    const d = this.draft();
    const at = new Date().toISOString();
    const base = { at, deviceAt: at };
    const cap = normalizeCap(d.cap);
    const t1 = normalizeTransponder(d.t1);
    const t2 = normalizeTransponder(d.t2);
    if (this.mode === 'add') {
      return [{ id: randomId(), ...base, kind: 'add-racer', who: d.who.trim(), licence: d.licence.trim() || undefined, race: d.race, cap, t1: t1 || undefined, t2: t2 || undefined, signed: d.signed }];
    }
    const o = this.original!;
    const field = (kind: DtsOpKind, value: string): DtsOp => ({ id: randomId(), ...base, kind, entry: this.entryId, value });
    const ops: DtsOp[] = [];
    if (cap !== o.cap) ops.push(field('cap', cap));
    if (t1 !== o.t1) ops.push(field('transponder1', t1));
    if (t2 !== o.t2) ops.push(field('transponder2', t2));
    if (d.race !== o.race) ops.push(field('race', d.race));
    if (d.signed !== o.signed) ops.push(field('sign', d.signed ? '1' : '0'));
    return ops;
  }

  protected async save(): Promise<void> {
    if (!this.valid() || this.busy() || this.locked()) return;
    this.busy.set(true);
    this.failed.set(false);
    try {
      const ops = this.opsToSend();
      if (ops.length) {
        // the change is kept on this device and sent when the connection allows
        await adminStore().queue({ kind: 'ops', session: this.id, ops });
      }
      location.assign(this.backHref());
    } catch {
      this.failed.set(true);
      this.busy.set(false);
    }
  }
}
