import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Input, afterNextRender, inject } from '@angular/core';
import { AsyncPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ButtonModule, FormModule, OffcanvasModule, PlaceholderModule } from '@coreui/angular';
import { DataService } from '../results/data.service';
import type { TodayCompetition } from '../results/data.models';
import { TranslatePipe } from '../i18n/translate.pipe';

/** The bar at the top of every page: the menu, the competition picker and the app icon; the drawer lists the pages. */
@Component({
  selector: 'app-header',
  standalone: true,
  imports: [AsyncPipe, DatePipe, RouterLink, ButtonModule, FormModule, OffcanvasModule, PlaceholderModule, TranslatePipe],
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeaderComponent {
  protected dataService = inject(DataService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The event name is the heading of the page; other pages have a heading of their own. */
  @Input() primary = false;

  /** The menu drawer is open. */
  protected menuOpen = false;

  protected readonly todayCompetitions$ = this.dataService.todayCompetitions$;
  protected readonly eventName$ = this.dataService.eventName$;

  constructor() {
    const destroyRef = inject(DestroyRef);
    // What sticks below the bar follows its height.
    afterNextRender(() => {
      const bar: HTMLElement | null = this.host.nativeElement.querySelector('.topbar');
      if (!bar || typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() => document.documentElement.style.setProperty('--topbar-h', `${bar.offsetHeight}px`));
      observer.observe(bar);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  /** Length of the shown option text; on narrow screens a longer one gets a smaller font. */
  protected selectedLabelLength(competitions: TodayCompetition[]): number {
    const m = competitions.find(x => x.id === this.dataService.competitionId);
    return m ? `⚪ 00:00 - 00:00 · ${m.name} (${m.venue.name})`.length : 20;
  }

  /** Open another competition; the page reads its competitionId on load. */
  protected openCompetition(event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    if (id) window.location.search = `?competitionId=${encodeURIComponent(id)}`;
  }

  protected isTodayCompetition(competitions: TodayCompetition[], id: string): boolean {
    return competitions.some((m) => m.id === id);
  }
}
