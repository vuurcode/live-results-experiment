import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject } from '@angular/core';
import { SettingsService } from '../../settings/settings.service';
import { TranslateService, TranslationKey } from '../../i18n/translate.service';
import type { HeatStep } from '../heat-steps';

/** The height of a mark in px, and the air kept between it and the cards pushed below it. */
const MARK_HEIGHT = 100;
const MARK_GAP = 8;
/** How long a heat stays named after it was landed on, in ms. */
const LANDED_MS = 1000;
/** The sideways pull, in px, at which a swipe mark is fully shown. */
const FULL_PULL_PX = 120;
/** Set on the page while marks show: the cards fold to their titles and make room below the marks (see the heat card styles). */
const MARKS_ATTRIBUTE = 'data-heat-marks';
const PUSH_PROPERTY = '--marks-push';

/** The heats on offer: the steps and the index of the live one. */
interface HeatView {
  steps: HeatStep[];
  live: number;
}

interface Near {
  label: string;
  /** The heat is the live one: its mark has the live border. */
  live: boolean;
  /** There is no heat there: the mark says Start or End, with a cross. */
  edge: boolean;
}

/**
 * The watermarks that name heats while the viewer swipes or slides: the heat on show in the middle and
 * the ones around it at the sides. The page uses them through five calls only: `pull` while a finger drags the heats,
 * `hold` while the slider's thumb is down, `land` once a swipe or slide is over, `dismiss` to end them at once, `clear` when nothing happened.
 */
@Component({
  selector: 'app-heat-marks',
  standalone: true,
  templateUrl: './heat-marks.component.html',
  styleUrls: ['./heat-marks.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeatMarksComponent {
  private cdr = inject(ChangeDetectorRef);
  private settings = inject(SettingsService);
  private ts = inject(TranslateService);

  /** The heat on show, in the middle. */
  protected current: string | null = null;
  protected currentLive = false;
  /** While a finger pulls: the one heat it would go to, at the side it comes from. */
  protected pulled: (Near & { side: 'left' | 'right'; progress: number }) | null = null;
  /** While held or landed: the heats before and after the one on show. */
  protected around: { previous: Near; next: Near } | null = null;
  protected fading = false;
  protected top = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** A finger drags the heats `dx` px sideways from heat `index`: the next heat is named at the right for a pull to the left, the previous at the left. */
  pull(dx: number, index: number, view: HeatView): void {
    if (!this.enabled()) return;
    this.stop();
    const near = this.near(view, index + (dx < 0 ? 1 : -1), dx < 0 ? 'sliderEnd' : 'sliderStart');
    this.set(view, index, { pulled: { ...near, side: dx < 0 ? 'right' : 'left', progress: Math.min(1, Math.abs(dx) / FULL_PULL_PX) }, around: null, fading: false });
  }

  /** The slider's thumb is down on heat `index`: the marks stay for as long as it is. */
  hold(index: number, view: HeatView): void {
    this.show(index, view, false);
  }

  /** A swipe or slide ended on heat `index`: the marks stay a moment and fade. */
  land(index: number, view: HeatView): void {
    this.show(index, view, true);
  }

  /** The marks go at once, without lingering. */
  dismiss(): void {
    this.stop();
    this.reset();
  }

  /** The marks go, unless they are lingering after a landing. */
  clear(): void {
    if (this.pulled !== null) this.reset();
  }

  private show(index: number, view: HeatView, linger: boolean): void {
    if (!this.enabled()) return;
    this.stop();
    this.set(view, index, { pulled: null, around: { previous: this.near(view, index - 1, 'sliderStart'), next: this.near(view, index + 1, 'sliderEnd') }, fading: linger });
    if (linger) this.timer = setTimeout(() => this.reset(), LANDED_MS);
  }

  private set(view: HeatView, index: number, state: { pulled: HeatMarksComponent['pulled']; around: HeatMarksComponent['around']; fading: boolean }): void {
    const step = view.steps[index];
    this.current = step ? step.label || step.distanceName : '';
    this.currentLive = index === view.live;
    this.pulled = state.pulled;
    this.around = state.around;
    this.fading = state.fading;
    // the cards move down for the marks, so the spot and the room are taken once, before they do
    if (!document.documentElement.hasAttribute(MARKS_ATTRIBUTE)) this.place();
    document.documentElement.setAttribute(MARKS_ATTRIBUTE, '');
    this.cdr.markForCheck();
  }

  private reset(): void {
    this.timer = null;
    this.current = null;
    this.pulled = null;
    this.around = null;
    this.fading = false;
    this.release();
    this.cdr.markForCheck();
  }

  private release(): void {
    document.documentElement.removeAttribute(MARKS_ATTRIBUTE);
    document.documentElement.style.removeProperty(PUSH_PROPERTY);
  }

  private stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  /** The marks are off with the animations. */
  private enabled(): boolean {
    return this.settings.animations.value && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  private near(view: HeatView, index: number, edgeKey: TranslationKey): Near {
    const step = view.steps[index];
    return { label: step ? step.label || step.distanceName : this.ts.t(edgeKey), edge: !step, live: !!step && index === view.live };
  }

  /** A long label (a heat 100 or more, a distance name) is set smaller, to stay inside its mark. */
  protected labelSize(label: string): number {
    return label.length > 9 ? 0.75 : label.length > 7 ? 0.9 : 1.1;
  }

  /**
   * The marks sit right under the top bar, over the name of the heat and the distance (which they repeat), wherever the page is
   * scrolled to. The first lane is pushed down to just under them, when it is not already.
   */
  private place(): void {
    const bar = parseFloat(document.documentElement.style.getPropertyValue('--topbar-h')) || 48;
    this.top = Math.round(bar + 8);
    // the row, not the card: the row neither slides in nor tilts, and its top does not move with the push easing in or out
    const row = document.querySelector('.individual-competitors-row');
    const push = row ? Math.max(0, this.top + MARK_HEIGHT + MARK_GAP - row.getBoundingClientRect().top) : 0;
    document.documentElement.style.setProperty(PUSH_PROPERTY, `${Math.round(push)}px`);
  }
}
