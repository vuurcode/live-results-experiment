import { Component, DestroyRef, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { keepScreenAwake } from './wake-lock';
import { SettingsService } from './settings/settings.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrls: ['./app.scss'],
})
export class App {
  constructor() {
    // the stylesheet stills the CSS animations and transitions under this attribute, on every page
    const subscription = inject(SettingsService).animations.changes$.subscribe((on) => {
      document.documentElement.setAttribute('data-animations', on ? 'on' : 'off');
    });
    inject(DestroyRef).onDestroy(() => subscription.unsubscribe());
    inject(DestroyRef).onDestroy(keepScreenAwake(navigator, document));
  }
}
