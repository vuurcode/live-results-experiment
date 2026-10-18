import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { AsyncPipe, Location, NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { BadgeModule, ButtonModule, FormModule } from '@coreui/angular';
import { BehaviorSubject, combineLatest, map, type Observable } from 'rxjs';
import { DataService } from '../results/data.service';
import { heatsAhead, heatsOfMatches, nameMatches, startListHeats, startListNames, type StartListHeat } from '../results/startlist.util';
import { TranslateService } from '../i18n/translate.service';
import { TranslatePipe } from '../i18n/translate.pipe';

interface StartListView {
  heats: StartListHeat[];
  /** The heats grouped by distance, in the order of the event */
  distances: { id: string; name: string; heats: StartListHeat[] }[];
  names: string[];
  query: string;
  /** The one competitor the query matches, when it matches a single name */
  competitor: string | null;
  next: ReturnType<typeof heatsAhead>;
  matches: (name: string) => boolean;
}

/** The heats of the event in order with their racers and lanes, and how many heats come before a chosen competitor. */
@Component({
  selector: 'app-start-list',
  standalone: true,
  imports: [AsyncPipe, NgTemplateOutlet, RouterLink, BadgeModule, ButtonModule, FormModule, TranslatePipe],
  templateUrl: './start-list.component.html',
  styleUrls: ['./start-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StartListComponent {
  private dataService = inject(DataService);
  private ts = inject(TranslateService);
  private location = inject(Location);

  /** Whether the search added a history entry, so that the back gesture clears the search instead of leaving the page. */
  private searchEntry = false;

  constructor() {
    const subscription = this.location.subscribe(() => {
      if (!this.searchEntry) return;
      this.searchEntry = false;
      this.setQuery('');
    });
    inject(DestroyRef).onDestroy(() => subscription.unsubscribe());
  }

  protected readonly eventName$ = this.dataService.eventName$;
  private readonly query$ = new BehaviorSubject<string>(this.storedQuery());

  protected readonly view$: Observable<StartListView> = combineLatest([this.dataService.processedData$, this.query$]).pipe(
    map(([distances, query]) => {
      const all = startListHeats(distances ?? [], (n) => this.ts.t('heatLabel', { n }));
      const names = startListNames(all);
      const matching = query.trim() ? names.filter((name) => nameMatches(name, query)) : [];
      const competitor = matching.length === 1 ? matching[0] : null;
      const heats = heatsOfMatches(all, query);
      const grouped: StartListView['distances'] = [];
      for (const heat of heats) {
        const last = grouped[grouped.length - 1];
        if (last?.id === heat.distanceId) last.heats.push(heat);
        else grouped.push({ id: heat.distanceId, name: heat.distanceName, heats: [heat] });
      }
      return { heats, distances: grouped, names, query, competitor, next: competitor ? heatsAhead(all, competitor) : null, matches: (name: string) => !!query.trim() && nameMatches(name, query) };
    }),
  );

  protected clear(input: HTMLInputElement): void {
    input.value = '';
    this.search({ target: input } as unknown as Event);
    input.focus();
  }

  protected search(event: Event): void {
    const query = (event.target as HTMLInputElement).value;
    if (query && !this.searchEntry) {
      this.location.go(this.location.path());
      this.searchEntry = true;
    } else if (!query && this.searchEntry) {
      this.searchEntry = false;
      this.location.back();
    }
    this.setQuery(query);
  }

  private setQuery(query: string): void {
    this.query$.next(query);
    try {
      if (query) localStorage.setItem(this.queryKey(), query);
      else localStorage.removeItem(this.queryKey());
    } catch { /* storage unavailable: the search lasts for this page */ }
  }

  /** The search is kept per competition, so that coming back shows the same heats. */
  private queryKey(): string {
    return `start-list-search:${this.dataService.competitionId}`;
  }

  private storedQuery(): string {
    try { return localStorage.getItem(this.queryKey()) ?? ''; } catch { return ''; }
  }

  /** The number of a heat for its badge: "2", or "1&2" for a quartet. */
  protected heatNumber(label: string): string {
    return label.match(/\d+/g)?.join('&') ?? label;
  }
}
