import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject } from '@angular/core';
import { SettingsService } from '../../settings/settings.service';
import { TranslateService, TranslationKey } from '../../i18n/translate.service';
import type { HeatStep } from '../heat-steps';

/** The px a mark and the slider below it need under the mark's top edge. */
const MARK_ROOM = 220;
/** How long a heat stays named after it was landed on, in ms. */
const LANDED_MS = 1000;
/** The sideways pull, in px, at which a swipe mark is fully shown. */
const FULL_PULL_PX = 120;
/** Set on the page while marks show: the cards fold to their titles and make room below the marks (see the heat card styles). */
const MARKS_ATTRIBUTE = 'data-heat-marks';

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
    // the cards move down for the marks, so the spot is taken once, before they do
    if (!document.documentElement.hasAttribute(MARKS_ATTRIBUTE)) this.top = this.markTop();
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

  /**
   * Where the marks sit, in px from the top of the screen: level with the top lane as it stands unscrolled, so they cover as
   * little of the cards as possible, and never under the top bar or off the bottom, wherever the page is scrolled to.
   */
  private markTop(): number {
    const bar = parseFloat(document.documentElement.style.getPropertyValue('--topbar-h')) || 48;
    const lane = document.querySelector('.individual-competitor-card')?.getBoundingClientRect();
    const unscrolled = lane ? lane.top + window.scrollY : window.innerHeight / 2;
    return Math.round(Math.min(Math.max(unscrolled, bar + 8), window.innerHeight - MARK_ROOM));
  }
}
