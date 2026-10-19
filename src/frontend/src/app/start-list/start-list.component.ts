import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { AsyncPipe, Location, NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BadgeModule, ButtonModule, FormModule } from '@coreui/angular';
import { BehaviorSubject, combineLatest, map, type Observable } from 'rxjs';
import { DataService } from '../results/data.service';
import { heatsAhead, heatsOfMatches, nameMatches, startListHeats, startListNames, type StartListHeat } from '../results/startlist.util';
import { TranslateService } from '../i18n/translate.service';
import { HeaderComponent } from '../header/header.component';
import { TranslatePipe } from '../i18n/translate.pipe';

interface StartListView {
  heats: StartListHeat[];
  /** The heats grouped by distance, in the order of the event */
  distances: { id: string; name: string; heats: StartListHeat[] }[];
  names: string[];
  /** At least one heat is done, so there is a ranking to look at */
  anyDone: boolean;
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
  imports: [HeaderComponent, AsyncPipe, NgTemplateOutlet, RouterLink, BadgeModule, ButtonModule, FormModule, TranslatePipe],
  templateUrl: './start-list.component.html',
  styleUrls: ['./start-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StartListComponent {
  private dataService = inject(DataService);
  private ts = inject(TranslateService);
  private location = inject(Location);
  private route = inject(ActivatedRoute);

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
      return { heats, distances: grouped, names, anyDone: all.some((heat) => heat.done), query, competitor, next: competitor ? heatsAhead(all, competitor) : null, matches: (name: string) => !!query.trim() && nameMatches(name, query) };
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

  /** The name to search for that a link brought along (?q=), else the search kept for this competition. */
  private storedQuery(): string {
    const linked = this.route.snapshot.queryParamMap.get('q');
    if (linked) {
      try { localStorage.setItem(this.queryKey(), linked); } catch { /* storage unavailable */ }
      return linked;
    }
    try { return localStorage.getItem(this.queryKey()) ?? ''; } catch { return ''; }
  }

  /** The number of a heat for its badge: "2", or "1&2" for a quartet. */
  protected heatNumber(label: string): string {
    return label.match(/\d+/g)?.join('&') ?? label;
  }
}
