import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { DtsKey } from '../dts/dts.strings';
import { adminStore } from './admin-store';

/** Says when the pages show the copy on this device and how many changes wait to be sent. Silent while all is well. */
@Component({
  selector: 'app-admin-sync',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div role="status" class="sync">
      @if (!store.online()) {
        <p class="banner">{{ store.pending() ? t()('syncQueued', { n: store.pending() }) : t()('syncOffline') }}</p>
      } @else if (store.pending()) {
        <p class="banner">{{ t()('syncSending', { n: store.pending() }) }}</p>
      }
      @if (store.rejected()) {
        <p class="banner warn">{{ t()('syncRejected', { n: store.rejected() }) }}</p>
      }
    </div>
  `,
})
export class AdminSyncStatus {
  protected readonly store = adminStore();
  /** The page's translate function, so the language follows the page's switch. */
  readonly t = input.required<(key: DtsKey, params?: Record<string, string | number>) => string>();
}
