import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AlertModule, BadgeModule, ButtonModule, TableModule } from '@coreui/angular';
import { map, type Observable } from 'rxjs';
import { DataService } from '../results/data.service';
import type { ProcessedDistance } from '../results/data.models';
import { ordinalSuffix } from '../results/ordinal.util';
import { raceStepKey } from '../results/step-key.util';
import { rankDistance, type RankingRow } from '../results/ranking.util';
import { formatDurationSeconds, parseSeconds, truncateLapTime } from '../results/time.util';
import { SettingsService } from '../settings/settings.service';
import { HeaderComponent } from '../header/header.component';
import { TranslatePipe } from '../i18n/translate.pipe';

interface RankedDistance {
  distance: ProcessedDistance;
  rows: RankingRow[];
}

/** The final order so far of every distance, from the live data. */
@Component({
  selector: 'app-ranking',
  standalone: true,
  imports: [HeaderComponent, AsyncPipe, RouterLink, AlertModule, BadgeModule, ButtonModule, TableModule, TranslatePipe],
  templateUrl: './ranking.component.html',
  styleUrls: ['./ranking.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RankingComponent {
  private dataService = inject(DataService);
  protected settings = inject(SettingsService);

  protected readonly ordinalSuffix = ordinalSuffix;
  protected readonly stepKey = raceStepKey;

  protected readonly eventName$ = this.dataService.eventName$;
  protected readonly distances$: Observable<RankedDistance[]> = this.dataService.processedData$.pipe(
    map((distances) => [...(distances ?? [])]
      .sort((a, b) => a.eventNumber - b.eventNumber)
      .map((distance) => ({ distance, rows: rankDistance(distance) }))),
  );

  /** A time with hundredths, or thousandths when that setting is on. */
  protected time(value: string): string {
    return value ? truncateLapTime(formatDurationSeconds(parseSeconds(value)), this.settings.showThousandths.value ? 3 : 2) : '';
  }

  protected gap(value: string): string {
    return value ? `+${truncateLapTime(value.slice(1), this.settings.showThousandths.value ? 3 : 2)}` : '';
  }
}
