import { AfterViewInit, DestroyRef, Directive, ElementRef, NgZone, inject } from '@angular/core';

/** How long a tap on the lap times shows all of them, in ms. */
const OPEN_MS = 5000;

/**
 * The lap times of a card that need more than one row show only the latest, to keep the card short. A tap on them shows all
 * for a few seconds. The folding is a class (`laps-folded`) on the element; the rows are counted with the laps all in place.
 */
@Directive({ selector: '[appLapFold]', standalone: true })
export class LapFoldDirective implements AfterViewInit {
  private host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private zone = inject(NgZone);
  private destroyRef = inject(DestroyRef);
  private opened = 0;
  private width = -1;

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => {
      let frame = 0;
      const schedule = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => this.measure());
      };
      const resize = new ResizeObserver(() => {
        // folding changes the height, not the width: only a new width needs a count
        if (this.host.clientWidth !== this.width) schedule();
      });
      resize.observe(this.host);
      const mutation = new MutationObserver(schedule);
      mutation.observe(this.host, { childList: true });
      const tap = () => this.open();
      this.host.addEventListener('click', tap);
      this.destroyRef.onDestroy(() => {
        cancelAnimationFrame(frame);
        clearTimeout(this.opened);
        resize.disconnect();
        mutation.disconnect();
        this.host.removeEventListener('click', tap);
      });
    });
    this.measure();
  }

  private measure(): void {
    this.width = this.host.clientWidth;
    if (this.opened) return;
    const laps = [...this.host.querySelectorAll<HTMLElement>('.individual-compact-lap')];
    this.host.classList.remove('laps-folded');
    const latest = this.host.querySelector('.individual-lap-latest');
    // a layout read with every lap in place: more than one row when a lap sits lower than the first
    const rows = laps.length > 0 && laps.some((lap) => lap.offsetTop !== laps[0].offsetTop);
    this.host.classList.toggle('laps-folded', rows && latest !== null);
  }

  private open(): void {
    if (!this.host.classList.contains('laps-folded')) return;
    this.host.classList.remove('laps-folded');
    this.opened = window.setTimeout(() => {
      this.opened = 0;
      this.measure();
    }, OPEN_MS);
  }
}
