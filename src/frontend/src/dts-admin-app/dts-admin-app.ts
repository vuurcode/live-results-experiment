import { ChangeDetectionStrategy, Component } from '@angular/core';
import { DtsHomeComponent } from '../app/dts-admin/home/home.component';
import { DtsManageComponent } from '../app/dts-admin/manage/manage.component';
import { DtsAdminNewComponent } from '../app/dts-admin/new/new.component';
import { DtsAdminEntryComponent } from '../app/dts-admin/entry/entry.component';

/** Picks the management page from the path under /dts-admin/; nginx serves every path there with this application. */
@Component({
  selector: 'app-dts-admin-root',
  imports: [DtsHomeComponent, DtsManageComponent, DtsAdminNewComponent, DtsAdminEntryComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (page) {
      @case ('new') { <app-dts-admin-new /> }
      @case ('list') { <app-dts-manage /> }
      @case ('add') { <app-dts-admin-entry /> }
      @case ('edit') { <app-dts-admin-entry /> }
      @default { <app-dts-home /> }
    }
  `,
})
export class DtsAdminApp {
  protected readonly page = location.pathname.replace(/^\/dts-admin\/?/, '').replace(/\/$/, '');
}
