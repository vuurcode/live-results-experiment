import { AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, EventEmitter, Input, NgZone, Output, inject, signal } from '@angular/core';
import { TranslatePipe } from '../../i18n/translate.pipe';
import type { HeatStep } from '../heat-steps';

/** The space between a half and the side of the screen, in px; keep in step with the `.peek` offsets (1rem). */
const SIDE_GAP = 16;
/** The least width, in px, a half is worth showing at: it shrinks with the room beside the heat on show, the previous one going first. */
const MIN_BEFORE = 110;
const MIN_AFTER = 80;
/** The widest, in px, a half is when it waits outside the screen for a swipe to pull it in. */
const EDGE_WIDTH = 112;

interface Peek {
  /** The lanes in order; an empty lane has no name and is drawn as an empty badge in the colour of the lane. Each racer has the label of its heat, shown small at the bottom of its lane. */
  racers: { name: string | null; lane: string | null; heat: string | null }[];
}

/**
 * The heat on show with the heats before and after it hinted at on its sides, on a wide screen: half a card each, only the
 * racer name badges, the whole thing faint. The next heat shows the left half of its card; for the previous heat the
 * half is made up, with the badges at its right edge. A half is half a card wide. When the row is too narrow, the previous
 * heat goes first and then the next, so the heat on show keeps its room. Where there is no heat on that side within the distance, a grey half says
 * that the distance starts or ends there.
 */
@Component({
  selector: 'app-heat-peeks',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './heat-peeks.component.html',
  styleUrls: ['./heat-peeks.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeatPeeksComponent implements AfterViewInit {
  private host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private zone = inject(NgZone);
  private destroyRef = inject(DestroyRef);

  /** A click on a half asks for the heat it hints at: -1 for the one before, 1 for the one after. */
  @Output() go = new EventEmitter<-1 | 1>();

  @Input() set prev(step: HeatStep | null) {
    this.before.set(this.peekOf(step));
    this.measure();
  }
  @Input() set next(step: HeatStep | null) {
    this.after.set(this.peekOf(step));
    this.measure();
  }

  protected before = signal<Peek | null>(null);
  protected after = signal<Peek | null>(null);
  /** The width of the cards of the heat on show together, 0 until measured. */
  protected shown = signal(0);
  /** The width of a half card, 0 until measured. */
  protected half = signal(0);
  protected showBefore = signal(false);
  protected showAfter = signal(false);
  /** The cards fill the row, so the halves wait outside it, at its sides, and a swipe pulls the one it moves toward into view. */
  protected outside = signal(false);
  /** The box of each name badge of the heat on show and of its lane: top and height from the top of the row, in px. */
  protected badges = signal<{ top: number; height: number; laneTop: number; laneHeight: number }[]>([]);

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => {
      let frame = 0;
      const schedule = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => this.measure());
      };
      // the heat on show changes under us (results come in, laps and badges appear, the cards slide in), moving the name badges
      const resize = new ResizeObserver(schedule);
      resize.observe(this.host);
      const mutation = new MutationObserver(schedule);
      mutation.observe(this.host, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
      this.host.addEventListener('animationend', schedule);
      this.destroyRef.onDestroy(() => {
        cancelAnimationFrame(frame);
        resize.disconnect();
        mutation.disconnect();
        this.host.removeEventListener('animationend', schedule);
      });
    });
    this.measure();
  }

  private peekOf(step: HeatStep | null): Peek | null {
    if (!step || step.isMassStart || step.racers.length === 0) return null;
    return { racers: step.slots.map((slot) => ({ name: slot.racer?.name ?? null, lane: slot.lane, heat: slot.racer?.heat ?? null })) };
  }

  /** Reads the card width and the lane rows off the heat on show and decides which halves fit. */
  private measure(): void {
    const boxes = [...this.host.querySelectorAll<HTMLElement>('.individual-competitor-card')].map((card) => card.getBoundingClientRect());
    if (boxes.length === 0) return;
    const width = this.host.clientWidth;
    const cardWidth = boxes[0].width;
    // the cards of the heat side by side (the four lane view) are as wide as their union
    const shown = Math.round(Math.max(...boxes.map((b) => b.right)) - Math.min(...boxes.map((b) => b.left)));
    // one box per lane; an empty lane has no name, so it takes the size and the place in its lane of the first name on show
    const laneCols = [...this.host.querySelectorAll<HTMLElement>('.individual-lane-col')];
    const lanes = laneCols.map((lane) => lane.querySelector<HTMLElement>('.individual-comp-name-text'));
    const first = lanes.find((name) => name !== null);
    const firstInLane = first ? this.offsetWithin(first) - this.offsetWithin(laneCols[lanes.indexOf(first)]) : 0;
    const badges = first
      ? lanes.map((name, i) => {
          const laneTop = this.offsetWithin(laneCols[i]);
          // the badge of an empty lane sits where the first one does within its lane, so the lanes stay apart
          return { top: name ? this.offsetWithin(name) : laneTop + firstInLane, height: (name ?? first).offsetHeight, laneTop, laneHeight: laneCols[i].offsetHeight };
        })
      : [];
    const half = Math.round(cardWidth / 2);
    // the heat on show is centred, so a half takes the room beside it, up to half a card
    const free = (width - shown) / 2 - SIDE_GAP;
    const peekWidth = Math.round(Math.min(half, free));
    const outside = peekWidth < MIN_AFTER;
    const showBefore = outside || peekWidth >= MIN_BEFORE;
    const showAfter = outside || peekWidth >= MIN_AFTER;
    // one signal write per field, only when it changed, so an unchanged measure renders nothing
    this.zone.run(() => {
      this.shown.set(shown);
      this.half.set(outside ? Math.min(half, EDGE_WIDTH) : peekWidth);
      this.outside.set(outside);
      this.showBefore.set(showBefore);
      this.showAfter.set(showAfter);
      if (JSON.stringify(badges) !== JSON.stringify(this.badges())) this.badges.set(badges);
    });
  }

  /** The distance of an element from the top of the peeks, by layout offsets so that a slide-in transform does not skew it. */
  private offsetWithin(element: HTMLElement): number {
    const peeks = this.host.firstElementChild;
    let top = 0;
    for (let e: HTMLElement | null = element; e && e !== peeks; e = e.offsetParent as HTMLElement | null) top += e.offsetTop;
    return top;
  }

  /** The racers of a peek that have a row of the heat on show to sit in; a longer heat is cut off. */
  protected rowsOf(peek: Peek): Peek['racers'] {
    return peek.racers.slice(0, Math.max(1, this.badges().length));
  }

  /** The badge box of a racer: the one of the same lane on show, else the last. */
  protected badgeOf(index: number): { top: number; height: number; laneTop: number; laneHeight: number } {
    const badges = this.badges();
    return badges[index] ?? badges[badges.length - 1] ?? { top: 0, height: 0, laneTop: 0, laneHeight: 0 };
  }
}
