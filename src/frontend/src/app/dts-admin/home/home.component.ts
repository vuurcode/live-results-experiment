import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { installInstantTooltips } from '../../dts/dts-tooltip';
import { DtsText } from '../../dts/dts-text';
import { qrEncode, qrPath } from '../../dts/qr';
import { adminStore, type AdminSession } from '../admin-store';
import { AdminSyncStatus } from '../sync-status';

/** /dts-admin/: how the sign-in works, plus every list on the server with a way to delete it. The page and its API sit behind the proxy's login. */
@Component({
  selector: 'app-dts-home',
  imports: [AdminSyncStatus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="dts">
      <header class="bar">
        <span class="brand">{{ t('appName') }}</span>
        <button type="button" class="link" (click)="text.toggle(); tab()" [attr.aria-label]="'NL / EN: ' + t('language')" [title]="t('tipLanguage')">
          <span [class.on]="text.lang() === 'nl'">NL</span><span aria-hidden="true">/</span><span [class.on]="text.lang() === 'en'">EN</span>
        </button>
      </header>
      <h1>{{ t('adminHeading') }}</h1>
      <app-admin-sync [t]="t" />

      <button type="button" class="new" (click)="go('/dts-admin/new')" [title]="t('tipNewSession')">{{ t('startHeading') }}</button>

      <h2>{{ t('adminListHeading') }}</h2>
      @if (failed()) {
        <p class="banner" role="alert">{{ t('adminLoadFailed') }} <button type="button" (click)="load()">{{ t('adminRetry') }}</button></p>
      } @else if (loaded() && items().length === 0) {
        <p class="muted">{{ t('adminEmpty') }}</p>
      }
      @if (message()) {
        <p class="banner" role="alert">{{ message() }}</p>
      }
      <ul class="sessions">
        @for (s of items(); track s.id) {
          <li [class.printing]="printing() === s.id">
            <button type="button" [title]="t('tipAdminDetails')" (click)="go('/dts-admin/list?s=' + s.id)">{{ t('adminDetails') }}</button>
            <button type="button" class="danger" [title]="t('tipAdminDelete')" (click)="remove(s)">{{ t('adminDelete') }}</button>
            @if (signLink(s); as link) {
              <button type="button" class="signbtn" [attr.aria-expanded]="linkOpen() === s.id" [attr.aria-controls]="'signlink-' + s.id" [title]="t('tipAdminSignLink')" (click)="linkOpen.set(linkOpen() === s.id ? '' : s.id)">{{ t('createdSign') }}</button>
            }
            @if (linkOpen() === s.id && signLink(s); as link) {
              <div class="signlink-fold">
                <div class="signlink" [id]="'signlink-' + s.id">
                  <div class="linkrow"><p class="url">{{ link }}</p></div>
                  @if (qr(link); as q) {
                    <svg class="qr" [attr.viewBox]="'0 0 ' + q.size + ' ' + q.size" role="img" [attr.aria-label]="t('qrLabel')" shape-rendering="crispEdges">
                      <rect width="100%" height="100%" fill="#fff" />
                      <path [attr.d]="q.path" fill="#000" />
                    </svg>
                  }
                  @if (s.races.length) {
                    <div class="qrraces"><p class="qrraces-head">{{ t('qrRaces') }}</p><ul>@for (r of s.races; track r.id) { <li>{{ r.title }}</li> }</ul></div>
                  }
                  <div class="linkactions"><button type="button" class="copy" (click)="copy(link)" [attr.aria-label]="copied() === link ? t('copied') : t('copy')" [title]="t('tipCopy')"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">@if (copied() === link) { <path d="M5 13l4 4L19 7" /> } @else { <rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /> }</svg></button><button type="button" class="copy print" (click)="printQr(s.id)" [attr.aria-label]="t('printQr')" [title]="t('printQr')"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" /><rect x="7" y="14" width="10" height="7" /></svg></button></div>
                  <p class="banner sharewarn" role="note"><span><strong>{{ t('qrDoNotShare') }}</strong> {{ t('qrNote') }}</span></p>
                </div>
              </div>
            }
            <ul class="races">
              @for (r of s.races; track r.id) {
                <li [class.locked]="r.closed">
                  <span class="what"><span class="rhead"><span class="rtitle">{{ r.title }}</span>@if (r.closed) { <span class="lockpill"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg> {{ t('adminClosed') }}</span> }</span>
                    <span class="meter" role="progressbar" [attr.aria-valuenow]="r.signed" aria-valuemin="0" [attr.aria-valuemax]="r.entries" [attr.aria-label]="t('adminSignedOf', { signed: r.signed, total: r.entries })">
                      <span class="fill" [style.width.%]="r.entries ? (r.signed / r.entries) * 100 : 0"></span>
                      <span class="label">{{ t('adminSignedOf', { signed: r.signed, total: r.entries }) }}</span>
                    </span>
                  </span>
                </li>
              }
            </ul>
          </li>
        }
      </ul>
    </main>
  `,
  styles: `
    details { interpolate-size: allow-keywords; }
    details::details-content { block-size: 0; overflow: clip; transition: block-size 0.25s ease, content-visibility 0.25s allow-discrete; }
    details[open]::details-content { block-size: auto; }
    @media (prefers-reduced-motion: reduce) { details::details-content { transition: none; } }
    :host { --bg: #ffffff; --fg: #111111; --muted: #444444; --card: #f2f2f2; --button: #d6e0f0; --line: #111111; --primary: #0b4f9c; --warn-bg: #fff1c2; --warn-fg: #4d3600;
      --open-bg: #e6ebf3; --signed-bg: #bfe8c8; --changed-bg: #d9c7f2; --note-bg: #ffe27a; --bad-bg: #fde0e0; --bad-fg: #7a0b0b;
      display: block; min-height: 100dvh; background: var(--bg); color: var(--fg); font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: 1.1rem; line-height: 1.4; }
    @media (prefers-color-scheme: dark) { :host { --bg: #101214; --fg: #f5f5f5; --muted: #cfcfcf; --card: #1e2124; --button: #2e3a4a; --line: #f5f5f5; --primary: #7ab7ff; --warn-bg: #4d3b00; --warn-fg: #fff2cc;
      --open-bg: #2b3036; --signed-bg: #1f6b35; --changed-bg: #6d3fb0; --note-bg: #8a6d00; --bad-bg: #5c1a1a; --bad-fg: #ffd6d6; } }
    .dts { max-width: 64rem; margin: 0 auto; padding: 0.75rem 16px 3rem; box-sizing: border-box; display: flex; flex-direction: column; gap: 0.75rem; }
    .bar { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; font-size: 1rem; }
    .brand { font-weight: 800; letter-spacing: 0.02em; }
    h1 { font-size: 1.75rem; margin: 0.25rem 0; }
    h2 { font-size: 1.25rem; margin: 0.5rem 0 0; }
    .lead, .muted { margin: 0; }
    .muted { color: var(--muted); }
    button { font: inherit; color: inherit; cursor: pointer; border: 3px solid var(--line); border-radius: 12px; background: var(--button); padding: 0.5rem 1rem; min-height: 48px; box-sizing: border-box; }
    .signbtn { display: inline-flex; align-items: center; box-sizing: border-box; white-space: nowrap; font-weight: 600; min-height: 44px; padding: 0 1rem; }
    .signbtn[aria-expanded='true'] { box-shadow: 0 0 0 3px var(--primary); }
    .signlink-fold { flex: 1 1 100%; }
    .signlink { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 0.75rem; margin: 0.5rem auto; max-width: 40rem; flex: 1 1 100%; }
    .signlink .linkrow { justify-content: center; align-self: stretch; }
    .qrraces { display: none; align-self: stretch; text-align: left; }
    @media print { .qrraces { display: block; } }
    .qrraces-head { margin: 0 0 0.25rem; font-weight: 600; }
    .qrraces ul { margin: 0; padding-left: 1.25rem; }
    .signlink .linkrow .url { flex: 0 1 auto; }
    .linkactions { display: flex; justify-content: center; gap: 0.5rem; }
    .banner.sharewarn { background: #fbdcdc; color: #9b1111; border-color: #c62828; justify-content: center; }
    @media (prefers-color-scheme: dark) { .banner.sharewarn { background: #4a2024; color: #ffc4c4; border-color: #e57373; } }
    @media print { main > :not(.sessions), .sessions > li:not(.printing) { display: none; } .printing > :not(.signlink-fold), .printing .signbtn, .signlink .copy { display: none; } .banner.sharewarn { background: none; color: #9b1111; border: 3px solid #c62828; font-size: 1.2rem; } .signlink .qr { width: 18rem; height: 18rem; } }
    .linkrow { display: flex; align-items: flex-start; gap: 0.5rem; }
    .linkrow .url { flex: 1 1 auto; }
    button.copy { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 2.5rem; height: 2.5rem; min-height: 0; padding: 0; border-width: 2px; }
    .copy .icon { width: 1.25rem; height: 1.25rem; }
    .url { word-break: break-all; font-family: ui-monospace, monospace; font-size: 1rem; margin: 0; }
    .qr { display: block; width: min(100%, 32rem); align-self: center; aspect-ratio: 1; border: 4px solid #fff; border-radius: 4px; background: #fff; }
    button.warn { background: var(--warn-bg); color: var(--warn-fg); border-color: var(--warn-fg); }
    button.danger { background: var(--bad-bg); color: var(--bad-fg); border-color: var(--bad-fg); }
    button:focus-visible { outline: 4px solid var(--primary); outline-offset: 2px; }
    @media (hover: hover) { button:hover { border-color: var(--primary); background: color-mix(in srgb, var(--primary) 14%, var(--button)); } button.warn:hover { border-color: var(--warn-fg); background: var(--warn-bg); filter: brightness(0.95); } button.danger:hover { border-color: var(--bad-fg); background: var(--bad-bg); filter: brightness(0.95); } }
    .link { display: inline-flex; align-items: center; gap: 0.35rem; border: 2px solid var(--line); border-radius: 999px; padding: 0 0.85rem; min-height: 44px; }
    .link span { color: var(--muted); }
    .link span.on { color: inherit; font-weight: 800; text-decoration: underline; text-underline-offset: 4px; }
    .mds { display: block; width: 100%; max-width: 48rem; height: auto; border: 2px solid var(--line); border-radius: 8px; }
    ul, ol { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.75rem; }
    .banner { margin: 0; padding: 0.75rem 1rem; border-radius: 12px; border: 3px solid var(--line); background: var(--bad-bg); color: var(--bad-fg); display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; justify-content: space-between; }
    .banner button { color: var(--fg); }
    @media (max-width: 30rem) { button.new { align-self: stretch; min-width: 0; } }
    .sessions li { background: var(--card); display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; border-radius: 12px; padding: 0.75rem; }
    ul.sessions { gap: 1.75rem; }
    .sessions > li { align-items: flex-start; padding: 1rem; gap: 1rem; position: relative; }
    .sessions > li > button.danger { position: absolute; top: 1rem; right: 1rem; }
    .sessions > li > button:first-child { margin-right: 7rem; }
    .races { flex: 1 1 100%; gap: 1rem; }
    .races li { background: var(--bg); padding: 0.75rem 1rem; }
    .rhead { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
    .lockpill { display: inline-flex; align-items: center; gap: 0.3rem; margin-left: auto; padding: 0.1rem 0.6rem; border-radius: 999px; border: 2px solid #c62828; background: #fbdcdc; color: #9b1111; font-size: 0.9rem; font-weight: 700; flex: none; }
    .lockpill .icon { width: 1rem; height: 1rem; }
    @media (prefers-color-scheme: dark) { .lockpill { background: #4a2024; color: #ffc4c4; border-color: #e57373; } }
    .races li.locked { border-left: 8px solid #c62828; background: color-mix(in srgb, #c62828 7%, var(--bg)); }
    .races li.locked .meter { opacity: 0.65; filter: grayscale(0.5); }
    .meter { position: relative; display: block; margin-top: 0.25rem; height: 1.5rem; border: 2px solid var(--line); border-radius: 8px; background: var(--card); overflow: hidden; }
    .meter .fill { position: absolute; inset: 0 auto 0 0; background: color-mix(in srgb, var(--primary) 45%, var(--card)); }
    .meter .label { position: relative; display: block; text-align: center; line-height: 1.25rem; font-size: 0.9rem; color: var(--fg); }
    .sessions .what { flex: 1 1 20rem; overflow-wrap: anywhere; }
    button.new { align-self: flex-start; min-width: 20rem; min-height: 56px; font-size: 1.25rem; font-weight: 600; background: #1b7a38; color: #fff; border-color: #1b7a38; }
    @media (prefers-color-scheme: dark) { button.new { background: #5fd07f; border-color: #5fd07f; color: #06220f; } }
    @media (hover: hover) { button.new:hover { background: #166630; border-color: #166630; } }
    @media (hover: hover) and (prefers-color-scheme: dark) { button.new:hover { background: #7fe09a; border-color: #7fe09a; } }
  `,
})
export class DtsHomeComponent implements OnInit {
  protected readonly text = new DtsText();
  protected readonly t = this.text.t;
  private readonly store = adminStore();
  protected readonly items = signal<AdminSession[]>([]);
  protected readonly loaded = signal(false);
  protected readonly failed = signal(false);
  protected readonly message = signal('');
  protected readonly copied = signal('');
  /** The session whose sign link is being printed; the print styles show only that one. */
  protected readonly printing = signal('');
  /** The session whose sign link panel is shown. */
  protected readonly linkOpen = signal('');

  protected printQr(id: string): void {
    this.printing.set(id);
    setTimeout(() => { window.print(); this.printing.set(''); });
  }


  ngOnInit(): void {
    installInstantTooltips();
    this.tab();
    void this.load();
  }

  /** The link a signer opens, or nothing for a list whose key the server does not have yet. */
  protected signLink(s: AdminSession): string {
    return s.signKey ? `${location.origin}/dts/sign#${s.id}.${s.signKey}` : '';
  }

  private qrCache = new Map<string, { size: number; path: string } | null>();
  protected qr(link: string): { size: number; path: string } | null {
    if (!this.qrCache.has(link)) {
      const code = qrEncode(link);
      this.qrCache.set(link, code ? { size: code.size + 8, path: qrPath(code) } : null);
    }
    return this.qrCache.get(link) ?? null;
  }

  protected async copy(link: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(link);
      this.copied.set(link);
    } catch {
      this.copied.set('');
    }
  }

  protected go(url: string): void {
    location.assign(url);
  }

  protected tab(): void {
    document.title = `${this.t('adminHeading')} · ${this.t('appName')}`;
  }

  protected async load(): Promise<void> {
    this.failed.set(false);
    const got = await this.store.sessions();
    if (got) this.items.set(got.items);
    else this.failed.set(true);
    this.loaded.set(true);
  }

  protected async remove(s: AdminSession): Promise<void> {
    if (!confirm(this.t('adminDeleteConfirm'))) return;
    this.message.set('');
    await this.store.queue({ kind: 'session-remove', session: s.id });
    await this.load();
  }
}
