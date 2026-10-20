import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AsyncPipe } from '@angular/common';
import { AlertModule, BadgeModule, ButtonModule, TableModule } from '@coreui/angular';
import { map, type Observable } from 'rxjs';
import { DataService } from '../results/data.service';
import type { ProcessedDistance } from '../results/data.models';
import { ordinalSuffix } from '../results/ordinal.util';
import { RaceCode, invalidBadgeClass, remarkBadgeClass, topAchievementOnly } from '../results/race-codes';
import { nameMatches } from '../results/startlist.util';
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

/** Codes that are not badged in the first column: the racer has no time to flag. */
const HIDDEN_CODES: ReadonlySet<string> = new Set<string>([RaceCode.DidNotStart, RaceCode.Withdrawn, RaceCode.Disqualified]);

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
  private route = inject(ActivatedRoute);

  /** The name a link brought along (?q=): the rows of the matching racers are highlighted. */
  private readonly query = this.route.snapshot.queryParamMap.get('q') ?? '';

  protected highlighted(name: string): boolean {
    return !!this.query.trim() && nameMatches(name, this.query);
  }

  protected readonly ordinalSuffix = ordinalSuffix;
  protected readonly stepKey = raceStepKey;
  protected readonly invalidBadgeClass = invalidBadgeClass;
  protected readonly remarkBadgeClass = remarkBadgeClass;

  /** The codes noted in the remark of a race, shown as badges in front of the rank. Of the records and the personal record only the most significant shows. */
  protected remarkCodes(race: { remark?: string | null }): string[] {
    return topAchievementOnly((race.remark?.trim().toUpperCase().split(/\s+/) ?? []).filter((code) => code && !HIDDEN_CODES.has(code)));
  }

  protected readonly eventName$ = this.dataService.eventName$;
  protected readonly distances$: Observable<RankedDistance[]> = this.dataService.processedData$.pipe(
    map((distances) => [...(distances ?? [])]
      .sort((a, b) => a.eventNumber - b.eventNumber)
      .map((distance) => ({ distance, rows: rankDistance(distance) }))),
  );

  /** The heat of a racer for the badge of a racer who has not started: its number, or both numbers of a quartet. */
  protected heatNumber(distance: ProcessedDistance, raceId: string): number {
    return distance.heatGroups.find((group) => group.races.some((race) => race?.id === raceId))?.heat ?? 0;
  }

  /** A time with hundredths, or thousandths when that setting is on. */
  protected time(value: string): string {
    return value ? truncateLapTime(formatDurationSeconds(parseSeconds(value)), this.settings.showThousandths.value ? 3 : 2) : '';
  }

  /** The time cut at the decimal comma or point, so the decimals can be drawn smaller. */
  protected timeParts(value: string): { whole: string; decimals: string } {
    const text = this.time(value);
    const at = text.search(/[.,]/);
    return at < 0 ? { whole: text, decimals: '' } : { whole: text.slice(0, at), decimals: text.slice(at) };
  }

  protected gap(value: string): string {
    return value ? `+${truncateLapTime(value.slice(1), this.settings.showThousandths.value ? 3 : 2)}` : '';
  }
}
