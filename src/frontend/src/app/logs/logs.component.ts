import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AsyncPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AlertModule, BadgeModule, ButtonModule } from '@coreui/angular';
import { combineLatest, map, type Observable } from 'rxjs';
import { DataService } from '../results/data.service';
import type { LogChange, LogEntry } from '../results/event-log.util';
import { raceStepKey } from '../results/step-key.util';
import { invalidBadgeClass, RaceCode, remarkBadgeClass } from '../results/race-codes';
import { TranslateService } from '../i18n/translate.service';
import { HeaderComponent } from '../header/header.component';
import { TranslatePipe } from '../i18n/translate.pipe';

interface LogRow {
  entry: LogEntry;
  /** The slider step that shows the heat, null when the distance is gone. */
  heatKey: string | null;
}

/** Every update the backend sent since the page opened, latest first, with the heat it is about and what it changed. */
@Component({
  selector: 'app-logs',
  standalone: true,
  imports: [HeaderComponent, AsyncPipe, DatePipe, RouterLink, AlertModule, BadgeModule, ButtonModule, TranslatePipe],
  templateUrl: './logs.component.html',
  styleUrls: ['./logs.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LogsComponent {
  private dataService = inject(DataService);
  private ts = inject(TranslateService);

  protected readonly eventName$ = this.dataService.eventName$;
  protected readonly rows$: Observable<LogRow[]> = combineLatest([this.dataService.eventLog$, this.dataService.processedData$]).pipe(
    map(([entries, distances]) => {
      const byId = new Map(distances.map((d) => [d.id, d]));
      return entries.map((entry) => {
        const distance = byId.get(entry.distanceId);
        return { entry, heatKey: distance ? raceStepKey(distance, entry.raceId) : null };
      });
    }),
  );

  protected readonly fieldKey = {
    heat: 'logsFieldHeat', lane: 'logsFieldLane', lap: 'logsFieldLap', time: 'logsFieldTime',
    rank: 'logsFieldRank', status: 'logsFieldStatus', remark: 'logsFieldRemark',
  } as const satisfies Record<LogChange['field'], string>;

  /** The codes of a remark or status value ("PR WR"), each shown as the badge it is on the cards. */
  protected badges(change: LogChange, value: string): { code: string; text: string; cssClass: string }[] {
    return value.trim().split(/\s+/).filter(Boolean).map((code) => ({
      code,
      text: code === RaceCode.PersonalRecord ? this.ts.t('remarkShortPb') : code,
      cssClass: change.field === 'status' ? invalidBadgeClass(code) : remarkBadgeClass(code),
    }));
  }
}
