import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ButtonModule, FormModule } from '@coreui/angular';
import { map } from 'rxjs';
import type { ColorSchemeChoice } from '../color-scheme';
import { DataService } from '../results/data.service';
import { TranslatePipe } from '../i18n/translate.pipe';
import { TranslateService } from '../i18n/translate.service';
import { parseInteger, parseNumber, SettingsService } from './settings.service';

/** The settings of the viewer, each with its help text under it. */
@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [AsyncPipe, RouterLink, ButtonModule, FormModule, TranslatePipe],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent {
  protected settings = inject(SettingsService);
  protected ts = inject(TranslateService);
  private dataService = inject(DataService);

  /** The mass start settings only show when the competition has a mass start. */
  protected readonly hasMassStart$ = this.dataService.processedData$.pipe(
    map((distances) => !!distances?.some((d) => d.isMassStart)),
  );

  protected setGroupThreshold(event: Event): void {
    const val = parseNumber((event.target as HTMLInputElement).value);
    if (val !== undefined) this.settings.groupThreshold.set(val);
  }

  protected setMaxGroups(event: Event): void {
    const val = parseInteger((event.target as HTMLInputElement).value);
    if (val !== undefined) this.settings.maxGroups.set(val);
  }

  protected setLapVariance(event: Event): void {
    const val = parseInteger((event.target as HTMLInputElement).value);
    if (val !== undefined) this.settings.lapVariance.set(val);
  }

  /** The values of the threshold example text, following the given setting (a lap of 40.0 s as the base). */
  protected lapExample(pct: number): Record<string, string> {
    const seconds = (n: number) => this.ts.num(n, 1); // a time always has a decimal
    return { pct: this.ts.num(pct), slow: seconds(40 * (1 + pct / 100)), fast: seconds(40 * (1 - pct / 100)) };
  }

  /**
   * The mouse wheel and the spinner buttons change a number input without a `change` event (that waits for blur),
   * so the example text would lag behind. They have no `inputType`; typing does and is applied on `change`, so a
   * half-typed "0." is not overwritten.
   */
  protected stepLapVariance(event: Event): void {
    if ((event as InputEvent).inputType) return;
    this.setLapVariance(event);
  }

  protected setColorScheme(event: Event): void {
    this.settings.colorScheme.set((event.target as HTMLSelectElement).value as ColorSchemeChoice);
  }

  protected setAnimations(event: Event): void {
    this.settings.animations.set((event.target as HTMLInputElement).checked);
  }

  protected setShowThousandths(event: Event): void {
    this.settings.showThousandths.set((event.target as HTMLInputElement).checked);
  }
}
