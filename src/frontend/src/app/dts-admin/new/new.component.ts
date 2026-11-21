import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { DtsText } from '../../dts/dts-text';
import { dtsAdminSend, parseJson } from '../../dts/dts-api';
import { qrEncode, qrPath } from '../../dts/qr';
import type { DtsCreated } from '../../dts/dts.models';
import type { DtsKey } from '../../dts/dts.strings';

/** The message for a refused upload: only an unprocessable file is the file's fault. */
function startError(status: number): DtsKey {
  if (status === 429) return 'startRate';
  if (status === 503 || status === 507) return 'startFull';
  if (status === 422 || status === 400) return 'startInvalid';
  if (status === 413) return 'startTooBig';
  return 'startFailed';
}

/** Management page that uploads an empty MDS export and makes a sign-in list of it. */
@Component({
  selector: 'app-dts-admin-new',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="page" [class.wide]="!created()">
      <header class="bar">
        <a class="back" href="/dts-admin/">← {{ t('adminBack') }}</a>
        <button type="button" class="lang" (click)="text.toggle()" [attr.lang]="text.lang() === 'nl' ? 'en' : 'nl'">NL / EN</button>
      </header>
      @if (created(); as c) {
        <h1>{{ t('createdHeading') }}</h1>
        <p class="banner warn">{{ t('createdWarn') }}</p>
        <section class="card">
          <h2>{{ t('createdSign') }}</h2>
          <p class="url">{{ signLink() }}</p>
          @if (qr(); as q) {
            <svg class="qr" [attr.viewBox]="'0 0 ' + q.size + ' ' + q.size" role="img" [attr.aria-label]="t('qrLabel')" shape-rendering="crispEdges">
              <rect width="100%" height="100%" fill="#fff" />
              <path [attr.d]="q.path" fill="#000" />
            </svg>
            <p class="banner sharewarn" role="note"><strong>{{ t('qrDoNotShare') }}</strong> {{ t('qrNote') }}</p>
          }
          <p class="hint" role="note">{{ t('createdAgain') }}</p>
          <button type="button" (click)="copy()">{{ copied() ? t('copied') : t('copy') }}</button>
        </section>
        <a class="big primary" [href]="'/dts-admin/list?s=' + c.id">{{ t('continue') }}</a>
      } @else {
        <h1>{{ t('startHeading') }}</h1>
        <p class="lead">{{ t('adminIntro') }}</p>
        @if (error()) {
          <p class="banner bad" role="alert">{{ t(error() || 'startInvalid') }}</p>
        }
          <div class="flow">
            <div class="roles" aria-hidden="true"><h2>{{ t('roleAdmin') }}</h2><h2>{{ t('roleJury') }}</h2></div>
            <ol class="steps" [attr.aria-label]="t('graphicsLabel')">
            <li class="admin">
              <svg viewBox="0 0 96 72" aria-hidden="true" focusable="false">
                <rect x="26" y="8" width="44" height="56" rx="4" class="paper" />
                <path d="M34 22h28M34 32h28M34 42h20" class="stroke" />
                <path d="M48 62V50M42 55l6-6 6 6" class="accent" />
              </svg>
              <span class="what" [attr.data-step]="t('stepWord')">{{ t('adminStep1') }}</span>
              <label class="big primary file new" [class.disabled]="busy()" [title]="t('tipNewSession')">
                {{ busy() ? t('startBusy') : t('sessionNew') }}
                <input type="file" accept=".xml,text/xml" (change)="pick($event)" [disabled]="busy()" />
              </label>
              <details class="mdsfold">
                <summary>{{ t('mdsShowExport') }}</summary>
                <img class="mds" src="/dts-mds-export.png" [alt]="t('mdsExportAlt')" width="1442" height="773" loading="lazy" />
              </details>
            </li>
            <li class="admin">
              <svg viewBox="0 0 96 72" aria-hidden="true" focusable="false">
                <rect x="28" y="6" width="40" height="60" rx="4" class="paper" />
                <path d="M36 14h10v10H36zM50 14h10v10H50zM36 28h10v10H36zM52 30h6v6h-6zM36 44h24M36 52h18" class="fill" />
              </svg>
              <span class="what" [attr.data-step]="t('stepWord')">{{ t('adminStepQr') }}</span>
            </li>
            <li class="jury">
              <svg viewBox="0 0 96 72" aria-hidden="true" focusable="false">
                <rect x="22" y="6" width="28" height="42" rx="4" class="paper" />
                <path d="M28 14h6v6h-6zM38 14h6v6h-6zM28 24h6v6h-6zM40 26h4v4h-4zM28 36h16" class="fill" />
                <rect x="56" y="22" width="22" height="42" rx="5" class="paper" />
                <path d="M52 30l-6-4M52 36h-8M52 42l-6 4" class="accent" />
              </svg>
              <span class="what" [attr.data-step]="t('stepWord')">{{ t('adminStep2') }}</span>
            </li>
            <li class="jury">
              <svg viewBox="0 0 96 72" aria-hidden="true" focusable="false">
                <rect x="30" y="4" width="36" height="64" rx="6" class="paper" />
                <rect x="35" y="12" width="26" height="12" rx="3" class="signed" />
                <rect x="35" y="28" width="26" height="12" rx="3" class="open" />
                <path d="M40 18l3 3 6-6" class="stroke" />
                <rect x="35" y="48" width="26" height="12" rx="3" class="accent-fill" />
              </svg>
              <span class="what" [attr.data-step]="t('stepWord')">{{ t('adminStep3') }}</span>
            </li>
            <li class="admin">
              <svg viewBox="0 0 96 72" aria-hidden="true" focusable="false">
                <rect x="8" y="10" width="80" height="52" rx="4" class="paper" />
                <rect x="14" y="18" width="16" height="12" rx="3" class="signed" />
                <rect x="34" y="18" width="16" height="12" rx="3" class="signed" />
                <rect x="54" y="18" width="16" height="12" rx="3" class="changed" />
                <rect x="14" y="36" width="16" height="12" rx="3" class="open" />
                <rect x="34" y="36" width="16" height="12" rx="3" class="note" />
                <rect x="54" y="36" width="16" height="12" rx="3" class="open" />
              </svg>
              <span class="what" [attr.data-step]="t('stepWord')">{{ t('adminStep4') }}</span>
            </li>
            <li class="admin">
              <svg viewBox="0 0 96 72" aria-hidden="true" focusable="false">
                <rect x="26" y="30" width="44" height="32" rx="5" class="paper" />
                <path d="M36 30V22a12 12 0 0 1 24 0v8" class="stroke" />
                <path d="M48 41v10" class="accent" />
              </svg>
              <span class="what" [attr.data-step]="t('stepWord')">{{ t('adminStep5') }}</span>
            </li>
            <li class="admin">
              <svg viewBox="0 0 96 72" aria-hidden="true" focusable="false">
                <circle cx="36" cy="24" r="10" class="paper" />
                <path d="M16 62c0-12 9-20 20-20s20 8 20 20" class="stroke" />
                <path d="M68 30v22M57 41h22" class="accent" />
              </svg>
              <span class="what" [attr.data-step]="t('stepWord')">{{ t('adminStep6') }}</span>
              <details class="mdsfold">
                <summary>{{ t('mdsShowDeelname') }}</summary>
                <img class="mds" src="/dts-mds-deelname-import.png" [alt]="t('mdsDeelnameAlt')" width="1902" height="218" loading="lazy" />
              </details>
            </li>
            <li class="admin">
              <svg viewBox="0 0 96 72" aria-hidden="true" focusable="false">
                <rect x="20" y="8" width="44" height="56" rx="4" class="paper" />
                <path d="M28 22h28M28 32h28M28 42h18" class="stroke" />
                <path d="M58 50h26M77 43l7 7-7 7" class="accent" />
              </svg>
              <span class="what" [attr.data-step]="t('stepWord')">{{ t('adminStep7') }}</span>
              <details class="mdsfold">
                <summary>{{ t('mdsShowImport') }}</summary>
                <img class="mds" src="/dts-mds-import.png" [alt]="t('mdsImportAlt')" width="1442" height="773" loading="lazy" />
              </details>
            </li>
            <li class="admin">
              <svg viewBox="0 0 96 72" aria-hidden="true" focusable="false">
                <path d="M28 6h26l14 14v46H28z" class="paper" />
                <path d="M54 6v14h14M36 34h24M36 44h24M36 54h14" class="stroke" />
              </svg>
              <span class="what" [attr.data-step]="t('stepWord')">{{ t('adminStep8') }}</span>
            </li>
            </ol>
          </div>
      }
    </main>
  `,
  styleUrl: '../admin.scss',
})
export class DtsAdminNewComponent implements OnInit {
  protected readonly text = new DtsText();
  protected readonly t = this.text.t;
  protected readonly busy = signal(false);
  protected readonly error = signal<DtsKey | ''>('');
  protected readonly created = signal<DtsCreated | null>(null);
  protected readonly copied = signal(false);

  ngOnInit(): void {
    document.title = `${this.t('tabNew')} · ${this.t('appName')}`;
  }

  protected readonly signLink = computed(() => {
    const c = this.created();
    return c ? `${location.origin}/dts/sign#${c.id}.${c.signKey}` : '';
  });

  protected readonly qr = computed(() => {
    const code = qrEncode(this.signLink());
    return code ? { size: code.size + 8, path: qrPath(code) } : null;
  });

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.signLink());
      this.copied.set(true);
    } catch {
      this.copied.set(false);
    }
  }

  protected async pick(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const res = await dtsAdminSend('', { method: 'POST', body: await file.arrayBuffer(), timeoutMs: 60000 });
      if (res.status === 201 || res.status === 200) this.created.set(parseJson<DtsCreated>(res));
      else this.error.set(startError(res.status));
    } catch {
      this.error.set('startOffline');
    } finally {
      this.busy.set(false);
    }
  }
}
