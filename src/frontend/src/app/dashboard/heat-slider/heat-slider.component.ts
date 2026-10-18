import { AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, OnDestroy, EventEmitter, HostListener, Input, OnChanges, Output, inject } from '@angular/core';
import { TranslateService } from '../../i18n/translate.service';
import { TranslatePipe } from '../../i18n/translate.pipe';
import type { HeatStep } from '../heat-steps';

/**
 * One slider over every heat of the event, those still to come included. The live heat is marked on the bar and moves
 * along as the event progresses; sliding onto it is "live": the position is then null and follows it. Hovering or dragging previews the distance, heat and racers under the pointer.
 */
/** The px between record lines of one step, and from a long line to the first one beside it. */
const MARK_GAP = 5;
const MARK_BESIDE = 5;
/** The wheel distance, in px, that moves the thumb one step; a faster scroll still moves it one step at a time. */
const WHEEL_STEP = 40;
/** How long the thumb is held before the bar grows. */
const HOLD_MS = 250;
/** How long the thumb is held before a narrow screen's bar zooms in. */
const ZOOM_HOLD_MS = 1000;
// The zoom stays this long after a release, so the thumb can be grabbed again to slide further.
const ZOOM_LINGER_MS = 1500;
/** The heats the bar shows while it is held on a narrow screen: a window around the thumb that scrolls as it is dragged. */
const ZOOM_STEPS = 15;
/** The width of a character of the small distance texts, in px, and the room kept between two texts. */
const TEXT_CHAR_PX = 5.4;
const TEXT_GAP_PX = 6;
/** The track's thumb size in px: the markers sit inside it, so the bar's ends are half a thumb in. */
const THUMB_PX = 24;

@Component({
  selector: 'app-heat-slider',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './heat-slider.component.html',
  styleUrls: ['./heat-slider.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeatSliderComponent implements OnChanges, AfterViewInit, OnDestroy {
  private ts = inject(TranslateService);
  private cdr = inject(ChangeDetectorRef);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private narrow = typeof matchMedia === 'function' ? matchMedia('(max-width: 767.98px)') : null;

  @Input({ required: true }) steps: HeatStep[] = [];
  /** The index of the live step, the newest heat that was timed. */
  @Input() liveIndex = 0;
  /** The step shown; null for live. */
  @Input() position: number | null = null;
  /** Whether the live markers glide: the live heat advanced among the same heats, rather than heats coming or going. */
  protected glide = false;
  private seenLive = 0;
  private seenCount = 0;
  @Output() positionChange = new EventEmitter<number | null>();

  private trackWidth = 0;
  private resizeObserver: ResizeObserver | null = null;

  ngAfterViewInit(): void {
    const track = this.host.nativeElement.querySelector('.track');
    if (!track || typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => {
      const width = track.getBoundingClientRect().width;
      if (width === this.trackWidth) return;
      this.trackWidth = width;
      this.cdr.markForCheck();
    });
    this.resizeObserver.observe(track);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    if (this.lingerTimer !== null) clearTimeout(this.lingerTimer);
  }

  ngOnChanges(): void {
    if (this.liveIndex === this.seenLive && this.steps.length === this.seenCount) return; // another input changing must not cut a glide short
    this.glide = this.liveIndex > this.seenLive && this.steps.length === this.seenCount;
    this.seenLive = this.liveIndex;
    this.seenCount = this.steps.length;
  }

  /** The step under the pointer or being dragged to; null while the preview is hidden. */
  protected previewIndex: number | null = null;

  protected get last(): number {
    return Math.max(0, this.steps.length - 1);
  }

  protected get value(): number {
    return this.position === null ? Math.min(this.liveIndex, this.last) : Math.min(this.position, this.last);
  }

  protected get live(): boolean {
    return this.value === this.liveIndex;
  }

  protected get preview(): HeatStep | null {
    return this.previewIndex === null ? null : (this.steps[this.previewIndex] ?? null);
  }

  /** Where the preview sits along the track, as a fraction. */
  protected get previewFraction(): number {
    return this.last === 0 || this.previewIndex === null ? 0 : Math.min(1, Math.max(0, this.fraction(this.previewIndex)));
  }

  /**
   * Held on a narrow screen, the bar zooms in on a window of heats around the thumb, so a heat is wide enough to
   * land on; the whole event stays visible as a mini-map above it.
   */
  protected get zoomed(): boolean {
    return this.zoomHeld && (this.narrow?.matches ?? false) && this.last >= ZOOM_STEPS;
  }

  /** The mini-map of the whole event shows as soon as the bar grows on a narrow screen, ahead of the zoom, and while the zoom lingers. */
  protected get miniShown(): boolean {
    return (this.expanded || this.zoomHeld) && (this.narrow?.matches ?? false) && this.last >= ZOOM_STEPS;
  }

  /** The first heat of the zoom window, which follows the thumb and stops at the ends of the event. */
  protected get zoomStart(): number {
    const span = ZOOM_STEPS - 1;
    return Math.min(this.last - span, Math.max(0, this.value - Math.floor(span / 2)));
  }

  /** Whether a heat is on the bar: always, but while zoomed only inside the window. */
  protected inWindow(index: number): boolean {
    return !this.zoomed || (index >= this.zoomStart && index <= this.zoomStart + ZOOM_STEPS - 1);
  }

  /** The window as fractions of the whole event, for the mini-map. */
  protected get windowLeft(): number {
    return this.zoomStart / this.last;
  }

  protected get windowRight(): number {
    return (this.zoomStart + ZOOM_STEPS - 1) / this.last;
  }

  /** The boundaries between distances, as fractions of the whole event, for the mini-map. */
  protected get miniBoundaries(): number[] {
    return this.distanceStarts.filter(({ index }) => index > 0).map(({ index }) => (index - 0.5) / this.last);
  }

  /** The texts at the ends of the mini-map: the first distance and the end, to say what it covers. */
  protected get miniStartText(): string {
    const first = this.distanceStarts[0];
    return first ? first.text || first.name : '';
  }

  /** Which way the Live and You labels of the mini-map lean so they do not cover each other: apart when the dots are close. */
  protected get miniLean(): { live: string; you: string } {
    const close = Math.abs(this.miniLive - this.miniValue) * this.trackWidth < 48;
    if (!close) return { live: '', you: '' };
    return this.miniValue < this.miniLive ? { live: 'lean-right', you: 'lean-left' } : { live: 'lean-left', you: 'lean-right' };
  }

  protected get miniLive(): number {
    return this.liveIndex / this.last;
  }

  protected get miniValue(): number {
    return this.value / this.last;
  }

  /** The first step of each distance; a long line marks the boundary before it, between two heats. */
  protected get distanceStarts(): { index: number; name: string; text: string }[] {
    return this.steps
      .map((step, index) => ({ step, index }))
      .filter(({ step, index }) => index === 0 || step.distanceId !== this.steps[index - 1].distanceId)
      .map(({ step, index }) => ({ index, name: step.distanceName, text: step.distanceMeters ? `${step.distanceMeters}m` : step.isMassStart ? this.ts.t('massStartSettings') : '' }));
  }

  /**
   * The distance texts shown. When they all fit they all show; when some would run into the one before or into the end
   * text, only the thumb's distance is named, in full, centred above the bar, and the end text goes. The lines always stay.
   */
  protected get textLayout(): { shown: Set<number>; end: boolean; current: string | null } {
    const width = this.trackWidth;
    const candidates = this.distanceStarts.filter(({ text, index }) => text && (this.inWindow(index) || this.inWindow(index - 1)));
    const all = { shown: new Set(candidates.map(({ index }) => index)), end: true, current: null };
    if (width === 0) return all;
    const size = (text: string) => text.length * TEXT_CHAR_PX;
    let right = -Infinity;
    const endLeft = this.inWindow(this.last) ? width - size(this.ts.t('sliderEnd')) - TEXT_GAP_PX : Infinity;
    for (const { index, text } of candidates) {
      const w = size(text);
      const x = index === 0 ? 0 : THUMB_PX / 2 + (width - THUMB_PX) * this.fraction(index - 0.5);
      const [left, end] = index === 0 ? [0, w] : [x - w / 2, x + w / 2];
      if (left < right + TEXT_GAP_PX || end > endLeft) {
        return { shown: new Set<number>(), end: false, current: this.steps[this.value]?.distanceName ?? null };
      }
      right = end;
    }
    return all;
  }

  /** A line for each racer with a record, side by side on their step; the line of a step that has a long line too goes beside it. */
  protected get recordMarks(): { index: number; code: string; title: string; offset: number }[] {
    return this.steps.flatMap((step, index) => {
      const n = step.racerRecords.length;
      const title = `${step.records.join(' ')} · ${this.stepText(step)}`;
      const side = this.hasLongLine(index) ? (index === this.last ? -1 : 1) : 0;
      return step.racerRecords.map((code, i) => ({ index, code, title, offset: Math.round(side === 0 ? (i - (n - 1) / 2) * MARK_GAP : side * (MARK_BESIDE + i * MARK_GAP)) }));
    });
  }

  /** Every step has a tick above the bar, the live one and those with records too; record lines are drawn under it. */
  protected get ticks(): number[] {
    return this.steps.map((_, index) => index);
  }

  /** Whether the live line is on the step already, so a record line there is drawn beside it instead of over it. */
  protected hasLongLine(index: number): boolean {
    return index === this.liveIndex;
  }

  protected isRecord(code: string): boolean {
    return code !== 'PR';
  }

  /** Where the boundary before a distance's first step sits: halfway between it and the step before. */
  protected boundaryFraction(index: number): number {
    return this.fraction(index - 0.5);
  }

  /** Where a step sits along the track, as a fraction. */
  protected fraction(index: number): number {
    if (this.zoomed) return (index - this.zoomStart) / (ZOOM_STEPS - 1);
    return this.last === 0 ? 0 : index / this.last;
  }

  /** The number of a heat for above its tick: "2", or "1&2" for a quartet; none for a mass start. */
  protected heatNumber(index: number): string {
    return this.steps[index]?.label.match(/\d+/g)?.join('&') ?? '';
  }

  protected stepText(step: HeatStep): string {
    return step.label ? `${step.distanceName} · ${step.label}` : step.distanceName;
  }

  protected get valueText(): string {
    const step = this.steps[this.value];
    return step ? this.stepText(step) : '';
  }

  protected goLive(): void {
    this.wantsLive = true;
    this.positionChange.emit(null);
  }

  /**
   * Whether the viewer's last own move put the thumb on the live heat. Only the viewer's input sets it, never a data
   * update, so a heat that becomes live under the thumb does not turn a chosen position into following live.
   */
  private wantsLive = false;

  /** The viewer moved the thumb onto a step; held, the position stays a number even on the live heat. */
  private choose(value: number): void {
    this.wantsLive = value === this.liveIndex;
    this.positionChange.emit(!this.dragging && this.wantsLive ? null : value);
  }

  protected onInput(event: Event): void {
    if (this.zoomed) {
      (event.target as HTMLInputElement).value = String(this.value); // the zoomed thumb moves by the drag below, not by the input's own scale
      return;
    }
    const value = Number((event.target as HTMLInputElement).value);
    // The ghost follows the pointer; with the keyboard it would lag behind the thumb.
    this.previewIndex = this.dragging ? value : null;
    this.choose(value);
  }

  protected onPointerMove(event: PointerEvent): void {
    if (this.dragging && event.buttons === 0) this.endDrag(); // the button was released unseen
    if (this.zoomed) return; // the preview follows the thumb, not the pointer
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (rect.width === 0) return;
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    this.previewIndex = Math.round(fraction * this.last);
  }

  /** A press is on the slider: the shown step is frozen against data updates until it ends. */
  protected dragging = false;

  /** The thumb has been held long enough for the bar to grow; a plain click leaves it as it is. */
  protected expanded = false;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private zoomTimer: ReturnType<typeof setTimeout> | null = null;
  /** The thumb has been held long enough to zoom. */
  private zoomHeld = false;
  private lingerTimer: ReturnType<typeof setTimeout> | null = null;

  /** Where the pointer and the thumb were when the zoom began; the drag moves the thumb from there, one heat per window step. */
  private lastX = 0;
  private anchorX = 0;
  private anchorValue = 0;

  protected startDrag(event: PointerEvent): void {
    this.dragging = true;
    this.lastX = event.clientX;
    this.holdTimer = setTimeout(() => {
      this.expanded = true;
      this.cdr.markForCheck();
    }, HOLD_MS);
    if (this.lingerTimer !== null) clearTimeout(this.lingerTimer);
    this.lingerTimer = null;
    if (this.zoomHeld) {
      this.anchorX = this.lastX;
      this.anchorValue = this.value;
    } else {
      this.zoomTimer = setTimeout(() => {
        this.anchorX = this.lastX;
        this.anchorValue = this.value;
        this.zoomHeld = true;
        this.cdr.markForCheck();
      }, ZOOM_HOLD_MS);
    }
    this.wantsLive = this.value === this.liveIndex;
    // Held, the position is a number even on the live heat, so the view stays on the step when a newer heat starts.
    if (this.position === null) this.positionChange.emit(this.value);
  }

  // A release outside the window or a lost focus sends no pointerup to the page, so those end the press too.
  @HostListener('window:pointerup')
  @HostListener('window:pointercancel')
  @HostListener('window:blur')
  protected endDrag(): void {
    if (!this.dragging) return;
    const held = this.value;
    this.dragging = false;
    this.expanded = false;
    if (this.holdTimer !== null) clearTimeout(this.holdTimer);
    if (this.zoomTimer !== null) clearTimeout(this.zoomTimer);
    this.holdTimer = null;
    this.zoomTimer = null;
    if (this.zoomHeld) {
      this.lingerTimer = setTimeout(() => {
        this.zoomHeld = false;
        this.lingerTimer = null;
        this.cdr.markForCheck();
      }, ZOOM_LINGER_MS);
    }
    this.positionChange.emit(this.wantsLive ? null : held);
  }

  @HostListener('window:pointermove', ['$event'])
  protected onDragMove(event: PointerEvent): void {
    if (!this.dragging) return;
    this.lastX = event.clientX;
    if (!this.zoomed) return;
    const track = this.host.nativeElement.querySelector('.track');
    const width = track?.getBoundingClientRect().width ?? 0;
    if (width === 0) return;
    const value = Math.min(this.last, Math.max(0, this.anchorValue + Math.round(((event.clientX - this.anchorX) / width) * (ZOOM_STEPS - 1))));
    if (value === this.value) return;
    this.previewIndex = value;
    this.choose(value);
    this.cdr.markForCheck();
  }

  private wheelSum = 0;

  /** Scrolling over the slider moves the thumb: down and right go to later heats. Small trackpad deltas add up to a step; one step per event, however far it scrolled. */
  protected onWheel(event: WheelEvent): void {
    if (this.steps.length < 2 || this.dragging) return;
    event.preventDefault();
    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (Math.sign(delta) !== Math.sign(this.wheelSum)) this.wheelSum = 0;
    this.wheelSum += delta * (event.deltaMode === 1 ? 16 : 1);
    if (Math.abs(this.wheelSum) < WHEEL_STEP) return;
    const direction = Math.sign(this.wheelSum);
    this.wheelSum = 0;
    const value = Math.min(this.last, Math.max(0, this.value + direction));
    if (value === this.value) return;
    this.previewIndex = value;
    this.choose(value);
  }

  /** The arrow keys slide the thumb without it being focused; a control that uses them itself, the slider's own input included, keeps them. */
  @HostListener('window:keydown', ['$event'])
  protected onKey(event: KeyboardEvent): void {
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const target = event.target as HTMLElement | null;
    if (direction === 0 || this.steps.length < 2 || this.dragging || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (target?.closest('input, textarea, select, [contenteditable], [role="slider"], [role="tab"], [role="menu"]')) return;
    const value = Math.min(this.last, Math.max(0, this.value + direction));
    event.preventDefault();
    this.previewIndex = null;
    if (value !== this.value) this.choose(value);
  }

  protected hidePreview(): void {
    this.previewIndex = null;
  }

  /** The upstream code PR is shown as the local term, like on the cards. */
  protected badgeText(code: string): string {
    return code.toUpperCase() === 'PR' ? this.ts.t('remarkShortPb') : code;
  }

  protected moreText(step: HeatStep): string {
    return this.ts.t('sliderMore', { n: step.more });
  }
}
