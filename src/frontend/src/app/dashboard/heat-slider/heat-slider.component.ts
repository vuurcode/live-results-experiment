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
const ZOOM_HOLD_MS = 500;
// The zoom stays this long after a release, so the thumb can be grabbed again to slide further.
const ZOOM_LINGER_MS = 1500;
/** The heats the bar shows while it is held on a narrow screen: a window around the thumb that scrolls as it is dragged. */
const ZOOM_STEPS = 15;
/** How long the bar takes to zoom in or out. */
const ZOOM_ANIM_MS = 1000;
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
  /** On page load the live markers start at the beginning of the bar ('start') and then slide to the live heat ('go'). */
  protected intro: 'start' | 'go' | null = null;
  private introDone = false;
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
    cancelAnimationFrame(this.zoomFrame);
    cancelAnimationFrame(this.slideFrame);
    this.resizeObserver?.disconnect();
    if (this.lingerTimer !== null) clearTimeout(this.lingerTimer);
  }

  ngOnChanges(): void {
    this.startIntro();
    if (this.liveIndex === this.seenLive && this.steps.length === this.seenCount) return; // another input changing must not cut a glide short
    this.glide = this.liveIndex > this.seenLive && this.steps.length === this.seenCount;
    this.seenLive = this.liveIndex;
    this.seenCount = this.steps.length;
  }

  private startIntro(): void {
    if (this.introDone || this.steps.length < 2) return;
    this.introDone = true;
    const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (this.liveIndex === 0 || calm || document.documentElement.dataset['animations'] === 'off') return;
    this.intro = 'start';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      this.intro = 'go';
      this.cdr.markForCheck();
      setTimeout(() => { this.intro = null; this.cdr.markForCheck(); }, 1400);
    }));
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
    return this.zoomHeld && this.zoomable;
  }

  private get zoomable(): boolean {
    return (this.narrow?.matches ?? false) && this.last >= ZOOM_STEPS;
  }

  /** How far the bar has zoomed, 0 (the whole event) to 1 (the window); it glides there when the zoom starts or ends. */
  protected zoomAmount = 0;
  private zoomFrame = 0;

  private animateZoom(): void {
    const target = this.zoomed ? 1 : 0;
    cancelAnimationFrame(this.zoomFrame);
    if (target === 1 && this.zoomAmount === 0) {
      this.shownStart = this.zoomStart;
      this.slideWindow();
    }
    if (this.stillMotion() || this.zoomAmount === target) {
      this.zoomAmount = target;
      this.cdr.markForCheck();
      return;
    }
    const from = this.zoomAmount;
    const begin = performance.now();
    const step = (now: number): void => {
      const k = Math.min(1, (now - begin) / ZOOM_ANIM_MS);
      this.zoomAmount = from + (target - from) * (1 - (1 - k) ** 3);
      this.cdr.markForCheck();
      if (k < 1) this.zoomFrame = requestAnimationFrame(step);
    };
    this.zoomFrame = requestAnimationFrame(step);
  }

  /** The mini-map of the whole event shows with the zoom of a narrow screen, until the zoom has lingered out. */
  protected get miniShown(): boolean {
    return this.zoomHeld && this.zoomable;
  }

  /** Whether the heat ticks are drawn: on a narrow screen the whole event is too dense for them, so they come with the zoom. */
  protected get ticksShown(): boolean {
    return !this.zoomable || this.zoomed || this.zoomAmount > 0;
  }

  /** The bar grows while held, except on a narrow screen with a zoom, where it goes straight to the zoom. */
  protected get grown(): boolean {
    return this.zoomable ? this.zoomed : this.expanded;
  }

  /** The first heat of the zoom window, which follows the thumb and stops at the ends of the event. */
  protected get zoomStart(): number {
    const span = ZOOM_STEPS - 1;
    return Math.min(this.last - span, Math.max(0, this.value - Math.floor(span / 2)));
  }

  /** Where the window is drawn: it slides after the thumb to the first heat it should show, instead of jumping a heat at a time. */
  protected get windowFrom(): number {
    return this.zoomAmount > 0 ? this.shownStart : this.zoomStart;
  }

  private shownStart = 0;
  private slideFrame = 0;

  private slideWindow(): void {
    cancelAnimationFrame(this.slideFrame);
    const step = (): void => {
      const gap = this.zoomStart - this.shownStart;
      this.shownStart = Math.abs(gap) < 0.01 || this.stillMotion() ? this.zoomStart : this.shownStart + gap * 0.3;
      this.cdr.markForCheck();
      if (this.zoomHeld || this.zoomAmount > 0) this.slideFrame = requestAnimationFrame(step);
    };
    this.slideFrame = requestAnimationFrame(step);
  }

  /** Animations are off in the settings or the system asks for reduced motion. */
  private stillMotion(): boolean {
    return document.documentElement.getAttribute('data-animations') === 'off' || (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  }

  /** Whether a heat is on the bar: always, but once zoomed only inside the window. */
  protected inWindow(index: number): boolean {
    return !this.zoomed || this.zoomAmount < 1 || (index >= Math.floor(this.windowFrom) && index <= Math.ceil(this.windowFrom) + ZOOM_STEPS - 1);
  }

  /** The window as fractions of the whole event, for the mini-map. */
  protected get windowLeft(): number {
    return this.windowFrom / this.last;
  }

  protected get windowRight(): number {
    return (this.windowFrom + ZOOM_STEPS - 1) / this.last;
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
      .map(({ step, index }) => ({ index, name: step.distanceName, text: step.distanceMeters ? `${step.distanceMeters}m` : step.isMassStart ? this.ts.t('massStartSettings') : step.distanceName }));
  }

  /**
   * The distance texts shown. When they all fit they all show; otherwise they are placed by priority, each only where it
   * runs into no text already placed: the distance under the thumb first, then the next one to come, then the rest by
   * their distance from the thumb, and the end text last. The lines always stay.
   */
  protected get textLayout(): { shown: Set<number>; end: boolean } {
    const width = this.trackWidth;
    const candidates = this.distanceStarts.filter(({ text, index }) => text && (this.inWindow(index) || this.inWindow(index - 1)));
    const all = { shown: new Set(candidates.map(({ index }) => index)), end: true };
    if (width === 0) return all;
    const size = (text: string) => text.length * TEXT_CHAR_PX;
    const spans = (index: number, text: string): [number, number] => {
      const w = size(text);
      const x = THUMB_PX / 2 + (width - THUMB_PX) * this.fraction(index - 0.5);
      return index === 0 ? [0, w] : [x - w / 2, x + w / 2];
    };
    const endText = this.ts.t('sliderEnd');
    const end: [number, number] = this.inWindow(this.last) ? [width - size(endText), width] : [Infinity, Infinity];
    const placed: [number, number][] = [];
    const fits = ([left, right]: [number, number]) => placed.every(([l, r]) => right + TEXT_GAP_PX <= l || left >= r + TEXT_GAP_PX);
    const here = this.distanceIndexOf(this.value);
    const rank = (index: number) => {
      const own = this.distanceIndexOf(index);
      return own === here ? -2 : own === here + 1 ? -1 : Math.abs(own - here);
    };
    const shown = new Set<number>();
    for (const { index, text } of [...candidates].sort((a, b) => rank(a.index) - rank(b.index) || a.index - b.index)) {
      const span = spans(index, text);
      if (!fits(span) || (span[1] + TEXT_GAP_PX > end[0] && rank(index) > -1)) continue;
      placed.push(span);
      shown.add(index);
    }
    const showEnd = fits(end);
    return { shown, end: showEnd };
  }

  /** The position, among the distances, of the distance a step belongs to. */
  private distanceIndexOf(step: number): number {
    const starts = this.distanceStarts;
    let own = 0;
    starts.forEach(({ index }, i) => { if (index <= step) own = i; });
    return own;
  }

  /** A line for each racer with a record, and a shorter one for each DQ, fall and DNF, side by side on their step; the line of a step that has a long line too goes beside it, those of the live step stand above it. */
  protected get recordMarks(): { index: number; code: string; title: string; offset: number; live: boolean; fault: boolean }[] {
    return this.steps.flatMap((step, index) => {
      const codes = [...step.racerRecords, ...step.faults];
      const n = codes.length;
      const title = `${step.records.join(' ')} · ${this.stepText(step)}`;
      const live = index === this.liveIndex;
      const side = !live && this.hasLongLine(index) ? (index === this.last ? -1 : 1) : 0;
      return codes.map((code, i) => ({ index, code, title, live, fault: i >= step.racerRecords.length, offset: Math.round(side === 0 ? (i - (n - 1) / 2) * MARK_GAP : side * (MARK_BESIDE + i * MARK_GAP)) }));
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
    const whole = this.last === 0 ? 0 : index / this.last;
    if (!this.zoomable || this.zoomAmount === 0) return whole;
    return whole + ((index - this.windowFrom) / (ZOOM_STEPS - 1) - whole) * this.zoomAmount;
  }

  /** The numbers of a heat for under its tick: one, or several for a quartet, which stack; none for a mass start. */
  protected heatNumbers(index: number): string[] {
    return this.steps[index]?.label.match(/\d+/g) ?? [];
  }

  /** The text of the live marker: Live, with the number of the live heat, or both numbers of a quartet. */
  protected get liveText(): string {
    const numbers = this.heatNumbers(this.liveIndex);
    return [this.ts.t('badgeLive'), numbers.map((n) => `#${n}`).join('/')].filter(Boolean).join(' ');
  }

  /** The most numbers any heat has, which the distance names under the ticks make room for. */
  protected get numberLines(): number {
    return Math.max(1, ...this.steps.map((_, i) => this.heatNumbers(i).length));
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
    // the heats sit between the centres of the thumb at both ends, as the ticks do
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left - THUMB_PX / 2) / Math.max(1, rect.width - THUMB_PX)));
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

  /** A finger is on the mini-map, moving the thumb over the whole event. */
  protected miniDragging = false;

  protected miniDown(event: PointerEvent): void {
    if (this.steps.length < 2 || event.button > 0) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.miniDragging = true;
    if (this.lingerTimer !== null) clearTimeout(this.lingerTimer);
    this.lingerTimer = null;
    this.miniMove(event);
  }

  protected miniMove(event: PointerEvent): void {
    if (!this.miniDragging) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (rect.width === 0) return;
    const value = Math.round(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * this.last);
    if (value === this.value) return;
    this.wantsLive = value === this.liveIndex;
    this.positionChange.emit(value);
    this.cdr.markForCheck();
  }

  protected miniUp(): void {
    if (!this.miniDragging) return;
    this.miniDragging = false;
    this.positionChange.emit(this.wantsLive ? null : this.value);
    if (this.zoomHeld) {
      this.lingerTimer = setTimeout(() => {
        this.zoomHeld = false;
        this.lingerTimer = null;
        this.animateZoom();
      }, ZOOM_LINGER_MS);
    }
    this.cdr.markForCheck();
  }

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
        this.animateZoom();
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
        this.animateZoom();
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

  /** Wheeling zooms a narrow screen's bar like holding it does, and lets go of the zoom after the same linger. */
  private lingerZoom(): void {
    if (!this.zoomable || this.miniDragging) return;
    if (this.lingerTimer !== null) clearTimeout(this.lingerTimer);
    if (!this.zoomHeld) {
      this.zoomHeld = true;
      this.animateZoom();
    }
    this.lingerTimer = setTimeout(() => {
      this.zoomHeld = false;
      this.lingerTimer = null;
      this.animateZoom();
    }, ZOOM_LINGER_MS);
  }

  /** Scrolling over the slider moves the thumb: down and right go to later heats. Small trackpad deltas add up to a step; one step per event, however far it scrolled. */
  protected onWheel(event: WheelEvent): void {
    if (this.steps.length < 2 || this.dragging) return;
    event.preventDefault();
    this.lingerZoom();
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
