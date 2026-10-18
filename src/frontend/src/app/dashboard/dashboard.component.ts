import { findLiveHeat } from '../results/live-heat';
import { newFinishers } from '../results/finish-announce.util';
import { distanceCompleted, hideDisqualifications } from '../results/hide-dq.util';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, ElementRef, HostBinding, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { DataService } from '../results/data.service';
import { SettingsService } from '../settings/settings.service';
import { FeedStatus, ProcessedDistance, StandingsGroup, CompetitorUpdate } from '../results/data.models';
import { Observable, combineLatest, concat, map, of, startWith, switchMap, tap, timer } from 'rxjs';
import { TranslateService, TranslationKey } from '../i18n/translate.service';
import { TranslatePipe } from '../i18n/translate.pipe';
import { HeaderComponent } from '../header/header.component';
import { swipeDirection, type SwipePoint } from './swipe.util';
import { MassStartTimelineComponent } from './mass-start-timeline/mass-start-timeline.component';
import { IndividualHeatCardComponent } from './individual-heat-card/individual-heat-card.component';
import { MassStartRaceRowComponent } from './mass-start-race-row/mass-start-race-row.component';
import {
  AlertModule,
  BadgeModule,
  ButtonModule,
  FormModule,
  GridModule,
  OffcanvasModule,
  PlaceholderModule,
  SharedModule,
} from '@coreui/angular';
import { FormsModule } from '@angular/forms';
import {
  individualDistanceLapSchedule as individualDistanceLapScheduleUtil,
  individualDistanceTotalLaps as individualDistanceTotalLapsUtil,
  individualRaceComplete as individualRaceCompleteUtil,
  pairHeatGroups,
  trimmedRaces as trimmedRacesUtil,
  heatGroupLaneColors as heatGroupLaneColorsUtil,
  type MergedHeatGroup,
} from '../results/heats.util';
import { lastViewedVenue, preselectCompetition, rememberVenue } from '../results/competition.util';
import { HeatPeeksComponent } from './heat-peeks/heat-peeks.component';
import { HeatSliderComponent } from './heat-slider/heat-slider.component';
import { buildSteps, type HeatStep } from './heat-steps';
import { distanceAtLap, leaderLaps, massStartLapCount } from '../results/mass-lap.util';
import { raceListAnimation, raceListKey } from './dashboard.animations';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    AlertModule,
    BadgeModule,
    ButtonModule,
    FormModule,
    OffcanvasModule,
    GridModule,
    PlaceholderModule,
    SharedModule,
    FormsModule,
    TranslatePipe,
    MassStartTimelineComponent,
    IndividualHeatCardComponent,
    MassStartRaceRowComponent,
    HeatPeeksComponent,
    HeatSliderComponent,
    HeaderComponent,
  ],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
  animations: [raceListAnimation],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent implements OnInit {
  protected dataService = inject(DataService);
  protected settings = inject(SettingsService);
  private titleService = inject(Title);
  protected ts = inject(TranslateService);
  private cdr = inject(ChangeDetectorRef);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private destroyRef = inject(DestroyRef);

  protected sortedDistances$: Observable<ProcessedDistance[]>;
  protected eventName$: Observable<string>;
  protected errors$: Observable<string[]>;
  /** Why the page has no results to show (instead of the loading skeleton), or null while it is just connecting. */
  protected emptyNotice$!: Observable<EmptyNotice | null>;

  protected liveEventNumber: number | null = null;
  /** Mass start competitors the viewer follows; several can be selected at once. A new set on every change, for the OnPush rows. */
  protected selectedRaceIds: ReadonlySet<string> = new Set();
  protected activeHeatKey: { distanceId: string; label: string } | null = null;

  /** The step the viewer slid to; null follows the live heat. */
  protected position: number | null = null;
  /** The distances with the steps of the slider and the index of the live one. */
  protected view$!: Observable<{ distances: ProcessedDistance[]; steps: HeatStep[]; live: number }>;

  protected selectRace(id: string): void {
    const next = new Set(this.selectedRaceIds);
    if (!next.delete(id)) next.add(id);
    this.selectedRaceIds = next;
  }

  /** Switches off the Angular animations (the reordering of rows and the folding of groups) with the setting. */
  @HostBinding('@.disabled') get animationsDisabled(): boolean { return !this.settings.animations.value; }

  constructor() {
    this.eventName$ = this.dataService.eventName$;
    this.errors$ = this.dataService.errors$;
    this.emptyNotice$ = combineLatest([
      this.dataService.feed$,
      this.dataService.status$.pipe(
        // a dropped connection is usually back within moments, so the disconnected notice waits a little
        switchMap(status => status.status === 'Error' || status.status === 'Disconnected'
          ? concat(of({ ...status, status: 'Connecting...' as const }), timer(DISCONNECT_GRACE_MS).pipe(map(() => status)))
          : of(status)),
      ),
      timer(10_000).pipe(map(() => true), startWith(false)), // a connection that stays silent is reported, not shown as loading forever
    ]).pipe(
      map(([feed, status, waitedLong]) => emptyNotice(feed, status.status, waitedLong)),
    );
    this.sortedDistances$ = this.dataService.processedData$.pipe(
      map((distances) => {
        if (!distances || distances.length === 0) return [];
        const sorted = [...distances].sort((a, b) => a.eventNumber - b.eventNumber);
        if (this.liveEventNumber === null) this.liveEventNumber = sorted.find((d) => d.isLive)?.eventNumber ?? null;
        // a disqualification shows once the whole distance is completed
        return sorted.map((d) => (this.liveEventNumber !== null && d.eventNumber < this.liveEventNumber) || distanceCompleted(d) ? d : hideDisqualifications(d));
      }),
    );
    this.view$ = this.sortedDistances$.pipe(
      map((distances) => ({ distances, ...buildSteps(distances, (n) => this.ts.t('heatLabel', { n }), (n) => this.ts.t('lapStepLabel', { n })) })),
      tap(({ steps }) => this.resolvePosition(steps)),
      tap(({ steps, live }) => { this.swipeView = { steps, live }; }),
      tap(({ steps, live }) => this.followLive(steps[live])),
    );
  }

  ngOnInit() {
    // The venue of the viewed competition is remembered; a page without a competition (or with one the backend does not know)
    // opens the live competition of the remembered venue, else its first.
    combineLatest([this.dataService.todayCompetitions$, this.dataService.status$]).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(([competitions, { status }]) => {
      const current = competitions.find((c) => c.id === this.dataService.competitionId);
      if (current) rememberVenue(current.venue.code);
      if (status !== 'No competition') return;
      const target = preselectCompetition(competitions, lastViewedVenue());
      if (target && target.id !== this.dataService.competitionId) window.location.replace(`?competitionId=${encodeURIComponent(target.id)}`);
    });
    this.dataService.eventName$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(name => {
      const pageTitle = this.ts.t('pageTitle');
      this.titleService.setTitle(name ? `${name} | ${pageTitle}` : pageTitle);
    });
    this.dataService.reset$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.liveEventNumber = null;
      this.position = null;
      this.positionKey = this.storedPositionKey();
      this.pinned = this.positionKey !== null;
      this.liveKey = null;
      this.previousDistances = null;
      this.cdr.markForCheck();
    });
    this.sortedDistances$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(distances => {
      this.activeHeatKey = this.findActiveHeat(distances);
      this.queueFinishes(newFinishers(this.previousDistances, distances));
      this.previousDistances = distances;
      this.cdr.markForCheck();
    });
    const timer = setInterval(() => this.announceFinishes(), ANNOUNCE_EVERY_MS);
    this.destroyRef.onDestroy(() => clearInterval(timer));
  }

  /** What a screen reader says, in a polite live region: finishes only, at most one message every few seconds, so the routine lap times stay silent. */
  protected announcement = '';
  private previousDistances: ProcessedDistance[] | null = null;
  private finishQueue: CompetitorUpdate[] = [];

  private queueFinishes(finishers: CompetitorUpdate[]): void {
    this.finishQueue.push(...finishers);
  }

  private announceFinishes(): void {
    const queue = this.finishQueue;
    if (queue.length === 0) return;
    this.finishQueue = [];
    this.announcement = queue.length === 1
      ? this.ts.t('announceFinished', { name: queue[0].name, time: queue[0].formatted_total_time })
      : this.ts.t('announceFinishedMany', { n: queue.length });
    this.cdr.markForCheck();
  }

  /** The heat whose lap times updated most recently (the later one when they changed together; the page follows by the same rule), ignoring mass starts; heats that were never timed here are never live. */
  private findActiveHeat(distances: ProcessedDistance[]): { distanceId: string; label: string } | null {
    let latest = 0;
    let result: { distanceId: string; label: string } | null = null;
    for (const distance of distances) {
      if (distance.isMassStart) continue;
      const groups = this.mergedHeatGroups(distance);
      const live = findLiveHeat(groups);
      if (live && live.updatedAt >= latest) {
        latest = live.updatedAt;
        result = { distanceId: distance.id, label: groups[live.index].label };
      }
    }
    return result;
  }

  /** Where the shown heat comes in from: opposite to the way the slider moved, as if the slider drags the heats along. */
  protected slideFrom: 'left' | 'right' | null = null;

  private liveKey: string | null = null;

  /** On the live position the view moves along when a newer heat starts; a pinned position never moves by itself. */
  private followLive(liveStep: HeatStep | undefined): void {
    const key = DashboardComponent.stepKey(liveStep);
    if (!this.pinned && this.liveKey !== null && key !== null && key !== this.liveKey) this.slideFrom = 'right';
    this.liveKey = key;
  }

  /** The step slid to, by identity: a heat that comes or goes before it moves its index, not the step on show. */
  private positionKey: string | null = this.heatFromUrl() ?? this.storedPositionKey();

  /**
   * The gate every data update passes before it may move or animate the view: set only by the viewer choosing a step
   * (setPosition), cleared only by the viewer choosing live. While it is set, an update re-finds the step by key and
   * nothing else.
   * It starts set when a position is remembered or linked to.
   */
  private pinned = this.positionKey !== null;

  /**
   * A link to a heat (the start list, the ranking) carries its step key as `heat`. It becomes the remembered position
   * and leaves the address, so a reload or a later slide is not overruled by it.
   */
  private heatFromUrl(): string | null {
    const key = this.route.snapshot.queryParamMap.get('heat');
    if (!key) return null;
    this.storePositionKey(key);
    void this.router.navigate([], { queryParams: { heat: null }, queryParamsHandling: 'merge', replaceUrl: true });
    return key;
  }

  /** The step slid to is kept per competition, so that a page reload brings the viewer back to it. */
  private positionStorageKey(): string {
    return `position:${this.dataService.competitionId}`;
  }

  private storedPositionKey(): string | null {
    try { return localStorage.getItem(this.positionStorageKey()); } catch { return null; }
  }

  private storePositionKey(key: string | null): void {
    try {
      if (key === null) localStorage.removeItem(this.positionStorageKey());
      else localStorage.setItem(this.positionStorageKey(), key);
    } catch { /* storage unavailable: the position lasts for this page */ }
  }

  private static stepKey(step: HeatStep | undefined): string | null {
    return step?.key ?? null;
  }

  /** Keeps a position slid to on its step when the steps change. */
  private resolvePosition(steps: HeatStep[]): void {
    if (!this.pinned || this.positionKey === null) return;
    const index = steps.findIndex((step) => DashboardComponent.stepKey(step) === this.positionKey);
    if (index >= 0) this.position = index;
    else if (this.position === null && steps.length > 0) this.setPosition(null, { steps, live: 0 }); // a remembered heat that is gone
  }

  private swipeView: { steps: HeatStep[]; live: number } | null = null;
  private swipeFrom: SwipePoint | null = null;
  private narrow = typeof matchMedia === 'function' ? matchMedia('(max-width: 767.98px)') : null;

  protected swipeStart(event: TouchEvent): void {
    this.swipeFrom = null;
    if (!this.narrow?.matches || event.touches.length !== 1 || !this.swipeStartsOnPage(event.target)) return;
    this.swipeFrom = { x: event.touches[0].clientX, y: event.touches[0].clientY, time: event.timeStamp };
  }

  /** Moves a heat on a swipe over the heats, on narrow screens only (a wide screen has no room to swipe in). */
  protected swipeEnd(event: TouchEvent): void {
    const from = this.swipeFrom;
    this.swipeFrom = null;
    const view = this.swipeView;
    if (!from || !view || event.touches.length > 0 || event.changedTouches.length !== 1) return;
    const touch = event.changedTouches[0];
    const direction = swipeDirection(from, { x: touch.clientX, y: touch.clientY, time: event.timeStamp }, window.innerWidth);
    if (direction === 0) return;
    const current = this.position === null ? view.live : Math.min(this.position, view.steps.length - 1);
    const target = current + direction;
    if (target < 0 || target >= view.steps.length) return;
    this.setPosition(target === view.live ? null : target, view);
    this.cdr.markForCheck();
  }

  protected swipeCancel(): void {
    this.swipeFrom = null;
  }

  /** A stroke that starts on the slider, a form control or something that scrolls sideways by itself belongs to that element. */
  private swipeStartsOnPage(target: EventTarget | null): boolean {
    for (let element = target instanceof Element ? target : null; element; element = element.parentElement) {
      if (element.matches('app-heat-slider, input, select, textarea, button, a, [role="slider"]')) return false;
      if (element.scrollWidth > element.clientWidth + 1 && ['auto', 'scroll'].includes(getComputedStyle(element).overflowX)) return false;
    }
    return true;
  }

  protected setPosition(position: number | null, view: { steps: HeatStep[]; live: number }): void {
    this.pinned = position !== null;
    this.positionKey = position === null ? null : DashboardComponent.stepKey(view.steps[Math.min(position, view.steps.length - 1)]);
    const index = (p: number | null) => (p === null ? view.live : Math.min(p, view.steps.length - 1));
    const [from, to] = [index(this.position), index(position)];
    if (to !== from) this.slideFrom = to > from ? 'right' : 'left';
    this.position = position;
    this.storePositionKey(this.positionKey);
  }

  private readonly lapViews = new Map<string, { signature: string; view: ProcessedDistance }>();

  /**
   * The mass start as it stands for the step on show: the live distance itself on the lap the leader is on, so it
   * keeps updating, else the standings after the lap of the step. A past lap is computed once per change of the
   * racers or the group settings.
   */
  protected massView(distance: ProcessedDistance, step: HeatStep): ProcessedDistance {
    const lap = step.lap ?? 0;
    if (lap >= Math.min(massStartLapCount(distance), Math.max(1, leaderLaps(distance)))) return distance;
    const threshold = this.settings.groupThreshold.value;
    const maxGroups = this.settings.maxGroups.value;
    const signature = `${threshold}:${maxGroups}:${distance.processedRaces.map((race) => `${race.id}.${race.lap_times.join(',')}`).join(';')}`;
    const key = `${distance.id}:${lap}`;
    const cached = this.lapViews.get(key);
    if (cached?.signature === signature) return cached.view;
    const view = distanceAtLap(distance, lap, threshold, maxGroups, (n) => this.ts.t(n === 1 ? 'lapUnit' : 'lapsUnit'));
    this.lapViews.set(key, { signature, view });
    return view;
  }

  /** Whether the lap of a mass start on show is still to come: the leader has not completed the lap before it. */
  protected isFutureLap(distance: ProcessedDistance, step: HeatStep): boolean {
    return step.lap !== null && step.lap > Math.max(1, leaderLaps(distance));
  }

  /** The step before or after the one on show, as a hint beside it; none across a change of distance. */
  protected neighbour({ steps }: { steps: HeatStep[] }, step: HeatStep, offset: number): HeatStep | null {
    const other = steps[steps.indexOf(step) + offset];
    return other?.distanceId === step.distanceId ? other : null;
  }

  /** The step on show: the one slid to, else the live one. */
  protected selectedStep({ steps, live }: { steps: HeatStep[]; live: number }): HeatStep | null {
    if (steps.length === 0) return null;
    return steps[this.position === null ? live : Math.min(this.position, steps.length - 1)];
  }

  protected isActiveHeatRow(distanceId: string, label: string): boolean {
    return this.activeHeatKey?.distanceId === distanceId && this.activeHeatKey?.label === label;
  }

  /** Whether any heat of a step, the two of a quartet, is the live one. */
  protected isActiveStep(distanceId: string, step: HeatStep, groups: { label: string }[]): boolean {
    return step.heatIndexes.some((i) => !!groups[i] && this.isActiveHeatRow(distanceId, groups[i].label));
  }

  protected badgeTextClass(lane: string): string {
    const light = ['white', 'yellow', 'orange', 'pink', 'lime'];
    return light.includes((lane || '').toLowerCase()) ? 'text-dark' : 'text-white';
  }

  protected raceListKey = raceListKey;
  protected readonly individualDistanceLapSchedule = individualDistanceLapScheduleUtil;
  protected readonly individualDistanceTotalLaps = individualDistanceTotalLapsUtil;
  protected readonly trimmedRaces = trimmedRacesUtil;
  protected readonly heatGroupLaneColors = heatGroupLaneColorsUtil;

  /**
   * Returns true when the race at raceIdx is the first competitor of a new
   * standings group (different lapsCount from the previous race), so we can
   * render a small visual gap between groups.
   */
  protected isFirstInNewGroup(distance: ProcessedDistance, raceIdx: number): boolean {
    const races = distance.processedRaces;
    if (!races || raceIdx <= 0 || raceIdx >= races.length) return false;
    return races[raceIdx].laps_count !== races[raceIdx - 1].laps_count;
  }

  /**
   * Returns the StandingsGroup that contains the given race id, or null.
   * Used to render a group divider above the first member of each group.
   */
  protected groupForRace(distance: ProcessedDistance, raceId: string): StandingsGroup | null {
    if (!distance.standingsGroups) return null;
    return distance.standingsGroups.find(g => g.races[0]?.id === raceId) ?? null;
  }

  /** Returns the display name for a standings group. */
  protected groupDisplayName(group: StandingsGroup, isFirst: boolean, anyFinished = false): string {
    if (group.isOthers) return this.ts.t('tailOfRace');
    if (isFirst && !anyFinished) return this.ts.t('headOfRace');
    return this.ts.t('groupLabel', { n: group.groupNumber });
  }

  /** Returns the heat groups for rendering, one row per heat. */
  protected mergedHeatGroups(distance: ProcessedDistance): { label: string; races: (CompetitorUpdate | null)[] }[] {
    return pairHeatGroups(distance.heatGroups, (n) => this.ts.t('heatLabel', { n }));
  }

  /** Max trimmed lane count across all heat groups in a distance, so narrower heats don't spread wider than their siblings. */
  protected distanceMaxLaneCount(groups: MergedHeatGroup<CompetitorUpdate>[]): number {
    return Math.max(0, ...groups.map(g => this.trimmedRaces(g.races).length));
  }

/** True when a individual race race counts as complete: all laps done OR has an invalid_reason. */
  private individualRaceComplete(race: CompetitorUpdate, distanceMeters: number): boolean {
    return individualRaceCompleteUtil(race, distanceMeters);
  }

  /** Number of completed races in a individual race distance. */
  protected individualCompletedCount(distance: ProcessedDistance): number {
    if (!distance.distanceMeters) return 0;
    return distance.processedRaces.filter(r => this.individualRaceComplete(r, distance.distanceMeters!)).length;
  }

  /** True when all races in a individual race distance are complete (finished or invalid). */
  private isIndividualDistanceDone(distance: ProcessedDistance): boolean {
    const total = distance.processedRaces.length;
    if (!distance.distanceMeters || total === 0) return false;
    return this.individualCompletedCount(distance) === total;
  }

  /** True when the distance should show the Done badge. */
  protected isDistanceDone(distance: ProcessedDistance): boolean {
    if (this.liveEventNumber !== null && distance.eventNumber < this.liveEventNumber) return true;
    if (!distance.isMassStart) return this.isIndividualDistanceDone(distance);
    return false;
  }
}

const DISCONNECT_GRACE_MS = 3000;
/** The least time between two messages of the live region. */
const ANNOUNCE_EVERY_MS = 4000;

interface EmptyNotice {
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  /** The data source's own text, shown as a quote */
  message?: string;
}

/** What to tell the viewer while there are no results to show. */
function emptyNotice(feed: FeedStatus | null, connection: string, waitedLong: boolean): EmptyNotice | null {
  if (connection === 'No competition') return { titleKey: 'feedNoCompetitionTitle', bodyKey: 'feedNoCompetitionBody' };
  if (connection === 'Error' || connection === 'Disconnected') return { titleKey: 'feedDisconnectedTitle', bodyKey: 'feedDisconnectedBody' };
  if (feed?.state === 'not_live') return { titleKey: 'feedNotLiveTitle', bodyKey: 'feedNotLiveBody', message: feed.message };
  if (feed?.state === 'unavailable') return { titleKey: 'feedUnavailableTitle', bodyKey: 'feedUnavailableBody' };
  if (feed?.state === 'ok') return { titleKey: 'feedEmptyTitle', bodyKey: 'feedEmptyBody' };
  return waitedLong ? { titleKey: 'feedSlowTitle', bodyKey: 'feedSlowBody' } : null;
}
