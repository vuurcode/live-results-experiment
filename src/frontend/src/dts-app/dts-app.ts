import { NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, Type, signal } from '@angular/core';

/** Shows the manage page under /dts/manage, the admin page on /dts/ and the sign page everywhere else under /dts/. */
@Component({
  selector: 'app-dts-root',
  imports: [NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '@if (page(); as p) { <ng-container *ngComponentOutlet="p" /> }',
})
export class DtsApp implements OnInit {
  protected readonly page = signal<Type<unknown> | null>(null);

  async ngOnInit(): Promise<void> {
    if (location.pathname === '/dts') history.replaceState(history.state, '', `/dts/${location.search}${location.hash}`);
    if (location.pathname === '/dts/') {
      this.page.set((await import('../app/dts/home/home.component')).DtsHomeComponent);
    } else if (location.pathname.startsWith('/dts/manage') || location.pathname.startsWith('/dts/list')) {
      this.page.set((await import('../app/dts/manage/manage.component')).DtsManageComponent);
    } else {
      this.page.set((await import('../app/dts/sign/sign.component')).DtsSignComponent);
    }
  }
}
