import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, Input, inject } from '@angular/core';
import { BadgeModule, CardModule } from '@coreui/angular';
import { CompetitorUpdate } from '../../results/data.models';
import { TranslateService, TranslationKey } from '../../i18n/translate.service';
import { parseSeconds, sameHundredths, formatDurationSeconds, truncateLapTime, splitFormattedTime, isRecentUpdate } from '../../results/time.util';
import { invalidBadgeClass, isNeverLive, remarkBadgeClass, GHOST_HIDING_CODES, NO_TIME_CODES, RaceCode, RECORD_CODES, RECORD_PRIORITY } from '../../results/race-codes';
import { categoryName } from '../../results/category.util';
import { emptyLaneColor, isIndividualFinished, individualStartDegrees, individualFinishAngle, individualRaceComplete, individualPrComparison as individualPrComparisonUtil } from '../../results/heats.util';

/** The usual lane colours by slot, for lanes no competitor has shown a colour for yet. */

@Component({
  selector: 'app-individual-heat-card',
  standalone: true,
  imports: [BadgeModule, CardModule],
  templateUrl: './individual-heat-card.component.html',
  styleUrls: ['./individual-heat-card.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IndividualHeatCardComponent {
  protected ts = inject(TranslateService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private cdr = inject(ChangeDetectorRef);

  @Input({ required: true }) label!: string;
  @Input() maxLanes = 0;
  @Input() laneColors: (string | null)[] = [];
  @Input() lapSchedule: number[] = [];
  @Input() distanceMeters: number | null = null;
  @Input() distanceId = '';
  @Input() distanceName = '';
  @Input() active = false;
  /** The heading of a quartet, over the heats of both pairs: the first card shows it, and the second, which has none, leaves its heading out. A pair has its own label as heading. */
  @Input() headingLabel: string | null | undefined;
  @Input() headingActive = false;
  /** Always show thousandths; otherwise hundredths, with thousandths only where a PB needs them. */
  @Input() showThousandths = false;

  private rawRaces: (CompetitorUpdate | null)[] = [];
  private cappedFor: { raw: (CompetitorUpdate | null)[]; schedule: number[] } | null = null;
  private capped: (CompetitorUpdate | null)[] = [];

  /**
   * The races with their laps limited to the distance's lap schedule. The data source sometimes reports a lap
   * beyond the finish; it has no distance and would count towards the total, so it is dropped.
   */
  @Input({ required: true })
  set races(value: (CompetitorUpdate | null)[]) {
    this.noteLapArrivals(this.rawRaces, value);
    this.rawRaces = value;
  }
  get races(): (CompetitorUpdate | null)[] {
    if (this.cappedFor?.raw !== this.rawRaces || this.cappedFor.schedule !== this.lapSchedule) {
      const max = this.lapSchedule.length;
      this.capped = max === 0 ? this.rawRaces : this.rawRaces.map(r =>
        r && r.lap_times && r.lap_times.length > max
          ? { ...r, lap_times: r.lap_times.slice(0, max), laps_count: Math.min(r.laps_count, max) }
          : r);
      this.cappedFor = { raw: this.rawRaces, schedule: this.lapSchedule };
    }
    return this.capped;
  }

  /** False shows every lap and total at once, without the snake and the count-up. */
  @Input() animate = true;

  /** Must match the duration of the `snakeAround` animation in _shared.scss. */
  private readonly SNAKE_MS = 1400;
  /** Race id → the moment its latest lap arrived; until the snake around that lap has finished the total counts up to the new time. */
  private lapArrivedAt = new Map<string, number>();
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private tickEnd = 0;

  /** Notes a race whose lap just arrived: its total counts up to the new time while the snake around that lap is drawn. */
  private noteLapArrivals(before: (CompetitorUpdate | null)[], after: (CompetitorUpdate | null)[]): void {
    const total = this.lapSchedule.length;
    // a card in a folded distance is not seen: unfolding it later shows the finished laps without a snake
    if (!total || !this.animate || this.reducedMotion.matches || !this.host.nativeElement.getClientRects().length) return;
    for (const race of after) {
      const laps = race?.lap_times?.length ?? 0;
      if (!race || race.invalid_reason || laps > total) continue;
      const earlier = before.find(r => r?.id === race.id);
      if (!earlier || earlier.lap_times.length >= laps) continue;
      this.lapArrivedAt.set(race.id, Date.now());
      this.tickUntil(Date.now() + this.SNAKE_MS);
    }
  }

  /** Renders every frame until the given moment, so the counting totals move smoothly; one loop serves all races. */
  private tickUntil(end: number): void {
    const running = this.tickEnd > Date.now();
    this.tickEnd = end;
    if (running) return;
    const frame = () => {
      this.cdr.markForCheck();
      if (Date.now() < this.tickEnd) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /** Progress 0..1 of the snake of the latest lap, eased like the animation; 1 when there is none or it has finished. */
  private lapProgress(race: CompetitorUpdate): number {
    const arrived = this.lapArrivedAt.get(race.id);
    if (arrived === undefined || !this.animate) return 1;
    const t = Math.min(1, (Date.now() - arrived) / this.SNAKE_MS);
    return t * t * (3 - 2 * t);
  }

  /** True while the snake around the lap that just arrived is drawing; a lap that was already there when the card was rendered has none. */
  protected snakeFresh(race: CompetitorUpdate): boolean {
    return this.lapProgress(race) < 1;
  }

  /** True while the snake around the final lap is drawing and the total counts up; the result's watermark then waits. */
  protected settling(race: CompetitorUpdate): boolean {
    return (race.lap_times?.length ?? 0) >= this.lapSchedule.length && this.lapProgress(race) < 1;
  }

  /** Laps whose total is shown: all of them, but not yet the final one while its snake is still drawing. */
  protected totalLaps(race: CompetitorUpdate): number {
    const laps = race.lap_times?.length ?? 0;
    return laps >= this.lapSchedule.length && this.lapProgress(race) < 1 ? laps - 1 : laps;
  }

  /** Columns of the lap badge grid when every lap shares one row. */
  protected get cells(): number {
    return this.lapSchedule.length;
  }

  protected isRecentUpdate = isRecentUpdate;

  protected splitFormattedTime = splitFormattedTime;
  protected truncateLapTime = truncateLapTime;
  protected isIndividualFinished = isIndividualFinished;

  private readonly REMARK_KEY_MAP: Record<string, TranslationKey> = {
    [RaceCode.PersonalRecord]: 'remarkNewPb',
    [RaceCode.Fall]: 'remarkFall',
    [RaceCode.Disqualified]: 'remarkDisqualified',
    [RaceCode.DidNotStart]: 'remarkDidNotStart',
    [RaceCode.DidNotFinish]: 'remarkDidNotFinish',
    [RaceCode.Withdrawn]: 'remarkWithdrawn',
    [RaceCode.ManualTime]: 'remarkManualTime',
    [RaceCode.WorldRecord]: 'remarkWorldRecord',
    [RaceCode.NationalRecord]: 'remarkNationalRecord',
    [RaceCode.TrackRecord]: 'remarkNewTrackRecord',
    [RaceCode.TrackRecordCourse]: 'remarkTrackRecordCourse',
  };

  /**
   * Returns the cumulative total time up to and including lap `lapIndex` as a
   * formatted string (e.g. "1:23.456"), summing individual split lap_times.
   * Returns null if the lap has not been completed yet.
   */
  protected individualCumulativeTime(race: CompetitorUpdate, lapIndex: number): string | null {
    if (!race.lap_times || race.lap_times.length <= lapIndex) return null;
    let total = 0;
    for (let i = 0; i <= lapIndex; i++) {
      total += parseSeconds(race.lap_times[i]);
    }
    return formatDurationSeconds(total);
  }

  /** The category as a name with the gender in front, in the viewer's language: "Women Juniors A1". */
  private categoryFullName(code: string | null): string {
    return categoryName(code, {
      women: this.ts.t('genderWomen'), men: this.ts.t('genderMen'),
      pupils: this.ts.t('categoryPupils'), juniors: this.ts.t('categoryJuniors'), neoSeniors: this.ts.t('categoryNeoSeniors'),
      seniors: this.ts.t('categorySeniors'), masters: this.ts.t('categoryMasters'),
    });
  }

  /** Split a space-separated remark string into individual codes. */
  protected splitRemarks(remark: string | null): string[] {
    if (!remark) return [];
    return remark.trim().split(/\s+/);
  }

  /** The code is a remark of the race already: its badge is shown once, not again as the invalid reason. */
  protected isRemarked(race: CompetitorUpdate, code: string): boolean {
    return this.splitRemarks(race.remark).some((r) => r.toUpperCase() === code.toUpperCase());
  }

  /** The remark codes that mark the card: a manual time (MT) only says how the time was taken, so the card shows the time and the PR status as usual. */
  private markingCodes(remark: string | null): string[] {
    return this.splitRemarks(remark).map(v => v.toUpperCase()).filter(v => v !== RaceCode.ManualTime);
  }

  /** Full description for a remark or invalid_reason code, or null if unknown. */
  protected individualLabelTitle(code: string | null): string | null {
    if (!code) return null;
    const key = this.REMARK_KEY_MAP[code.toUpperCase()];
    return key ? this.ts.t(key) : null;
  }

  /** Color variant for a individual race card based on invalid_reason/remark values. */
  protected individualCardVariant(race: CompetitorUpdate): 'pr' | 'record' | 'red' | 'orange' | null {
    if (race.invalid_reason) {
      return race.invalid_reason.toUpperCase() === RaceCode.Disqualified ? 'red' : 'orange';
    }
    const parts = this.markingCodes(race.remark);
    if (parts.length) {
      if (parts.some(v => RECORD_CODES.has(v))) return 'record';
      if (parts.some(v => v === RaceCode.PersonalRecord)) return 'pr';
      return 'orange';
    }
    return null;
  }

  /** True when the watermark of this race goes in the middle of the card (no time to show), not in the corner of the title. */
  protected watermarkCentered(race: CompetitorUpdate): boolean {
    const codes = [race.invalid_reason, ...this.splitRemarks(race.remark)];
    return codes.some(c => !!c && NO_TIME_CODES.has(c.toUpperCase()));
  }

  /** The live tag goes on the cards of the live heat, except for competitors who did not start or withdrew, and those whose result is in. */
  protected showLive(race: CompetitorUpdate): boolean {
    return this.active && !isNeverLive(race) && !(this.distanceMeters != null && individualRaceComplete(race, this.distanceMeters));
  }

  /** A live card has the live border, unless the card already has a border of its own (a personal best, a record, a fall ...). */
  protected liveBorder(race: CompetitorUpdate): boolean {
    return this.showLive(race) && this.individualCardVariant(race) === null;
  }

  /** True for a race that did not start, was disqualified or withdrew: its placeholder badges are not shown (their room is kept). */
  protected ghostsHidden(race: CompetitorUpdate): boolean {
    const codes = [race.invalid_reason, ...this.splitRemarks(race.remark)];
    return codes.some(c => !!c && GHOST_HIDING_CODES.has(c.toUpperCase()));
  }

  /** Watermark text: invalid_reason takes priority over remark; resolved via label map.
   *  PR remarks are rendered as a DOM overlay instead (returns null).
   *  Records (WR, NR, TR, TRC, in that order) get priority; TRC is a track record that names its category in full on a second line. */
  protected individualWatermarkText(race: CompetitorUpdate): string | null {
    if (race.invalid_reason) {
      return this.individualLabelTitle(race.invalid_reason) ?? race.invalid_reason;
    }
    const parts = this.markingCodes(race.remark);
    if (!parts.length) return null;
    // PR watermark is rendered as a DOM overlay to support smaller decimal formatting
    if (parts.every(v => v === RaceCode.PersonalRecord)) return null;
    // records come first, the most significant one wins
    const recordCode = RECORD_PRIORITY.find(v => parts.includes(v));
    if (recordCode) {
      const label = this.individualLabelTitle(recordCode) ?? recordCode;
      if (recordCode === RaceCode.TrackRecordCourse && race.category) {
        return `${label}\n(${this.categoryFullName(race.category)})`;
      }
      return label;
    }
    // Other non-PR remark
    const firstNonPr = parts.find(v => v !== RaceCode.PersonalRecord);
    if (firstNonPr) {
      return this.individualLabelTitle(firstNonPr) ?? firstNonPr;
    }
    return null;
  }

  /** The total time so far (the final time once finished), shown after the lap badges in compact mode. */
  protected compactTotalTime(race: CompetitorUpdate): string | null {
    if (race.invalid_reason || !race.lap_times?.length) return null;
    const progress = this.lapProgress(race);
    const final = this.individualCumulativeTime(race, race.lap_times.length - 1)!;
    if (progress >= 1) return final;
    // the previous total counts up to the new time by the moment the snake has finished
    const previous = race.lap_times.length > 1 ? parseSeconds(this.individualCumulativeTime(race, race.lap_times.length - 2)!) : 0;
    return formatDurationSeconds(previous + (parseSeconds(final) - previous) * progress);
  }

  /**
   * Decimals of the totals, PB and PB difference on a card: hundredths unless thousandths are switched on, or
   * the finished time and the personal best have the same hundredths (the thousandths settle it).
   */
  protected decimals(race: CompetitorUpdate): 2 | 3 {
    if (this.showThousandths) return 3;
    if (this.distanceMeters == null || !race.personal_record || !race.lap_times?.length || !isIndividualFinished(race, this.distanceMeters)) return 2;
    const total = this.individualCumulativeTime(race, race.lap_times.length - 1);
    if (!total) return 2;
    return sameHundredths(total, race.personal_record) ? 3 : 2;
  }

  /** Columns of the wide layout: the lanes of the widest heat in the distance, at most four. */
  protected get laneCount(): number {
    return Math.min(4, Math.max(1, this.maxLanes || this.races.length));
  }

  /** Lane colour of a slot: the competitor's own, else that of the empty lane. */
  protected laneColor(race: CompetitorUpdate | null, slot: number): string | null {
    return race?.lane ?? emptyLaneColor(this.races, slot, this.laneColors);
  }

  /** The lane of a card for a screen reader ("Red lane"): the lanes are told apart by their colour, which is no use unseen. */
  protected laneLabel(race: CompetitorUpdate, slot: number): string | null {
    const key = { white: 'laneWhite', red: 'laneRed', yellow: 'laneYellow', blue: 'laneBlue' }[this.laneColor(race, slot) ?? ''] as 'laneWhite' | 'laneRed' | 'laneYellow' | 'laneBlue' | undefined;
    return key ? this.ts.t(key) : null;
  }

  /** Category name and club code for under the name: "Women Juniors A1 (CLF4)", or whichever of the two there is. */
  protected metaLine(race: CompetitorUpdate): string {
    const name = this.categoryFullName(race.category);
    return race.club_code ? (name ? `${name} (${race.club_code})` : race.club_code) : name;
  }

  /** Tooltip of a compact lap badge: three rows - distance, lap time, total time. */
  protected compactBadgeTitle(race: CompetitorUpdate, i: number): string {
    const total = this.individualCumulativeTime(race, i);
    return [
      `${this.ts.t('tooltipDistance')}: ${this.lapSchedule[i]}m`,
      `${this.ts.t('tooltipLapTime')}: ${truncateLapTime(race.lap_times[i], 2)}`,
      `${this.ts.t('tooltipTotalTime')}: ${total ? truncateLapTime(total, this.decimals(race)) : ''}`,
    ].join('\n');
  }

  /** Where the finish line is on a lap badge's ring, in degrees clockwise from the top. */
  protected get ringFinish(): string {
    return `${this.distanceMeters == null ? 0 : individualFinishAngle(this.distanceMeters)}deg`;
  }

  /** Share of the ring the snake draws for lap i: the first lap from where the distance starts on the oval, the others all the way round. */
  protected lapFraction(i: number): number {
    if (i > 0 || this.distanceMeters == null) return 1;
    return Math.min(1, individualStartDegrees(this.distanceMeters) / 360);
  }

  /** True once the final lap is done. */
  protected compactDone(race: CompetitorUpdate): boolean {
    return this.distanceMeters != null && isIndividualFinished(race, this.distanceMeters) && this.totalLaps(race) === race.lap_times.length;
  }

  /** True once the skater has finished faster than the personal best shown on the card. */
  protected isPbImproved(race: CompetitorUpdate): boolean {
    return !!this.distanceMeters && !!this.individualPrComparison(race, this.distanceMeters)?.faster;
  }

  /** Badge text: the upstream code `PR` is shown as the local term (PB in English, PR in Dutch); other codes are international. */
  protected remarkBadgeText(code: string): string {
    return code === RaceCode.PersonalRecord ? this.ts.t('remarkShortPb') : code;
  }

  protected remarkBadgeClass = remarkBadgeClass;
  protected invalidBadgeClass = invalidBadgeClass;

  /**
   * Compares the competitor's total time against their personal best once
   * the final lap of a individual race distance is complete. Returns the sign and
   * 3-decimal diff string, or null if comparison is not applicable.
   */
  protected individualPrComparison(race: CompetitorUpdate, distanceMeters: number): { faster: boolean; diff: string } | null {
    return individualPrComparisonUtil(race.personal_record, race.total_time, race, distanceMeters);
  }
}
