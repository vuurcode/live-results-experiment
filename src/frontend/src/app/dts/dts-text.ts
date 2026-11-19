import { signal } from '@angular/core';
import { dtsText, initialLang, type DtsKey, type DtsLang } from './dts.strings';

/** The language of the DTS pages: the address (?lang=) wins, then what the device remembered when storage allows, else Dutch. */
export class DtsText {
  readonly lang = signal<DtsLang>(initialLang(DtsText.stored()));

  private static stored(): string | null {
    const fromUrl = new URLSearchParams(location.search).get('lang');
    if (fromUrl === 'nl' || fromUrl === 'en') return fromUrl;
    try {
      return localStorage.getItem('dts-lang');
    } catch {
      return null;
    }
  }

  t = (key: DtsKey, params?: Record<string, string | number>): string => dtsText(this.lang(), key, params);

  toggle(): void {
    const next: DtsLang = this.lang() === 'nl' ? 'en' : 'nl';
    this.lang.set(next);
    document.documentElement.lang = next;
    const q = new URLSearchParams(location.search);
    q.set('lang', next);
    history.replaceState(history.state, '', `${location.pathname}?${q}${location.hash}`);
    try {
      localStorage.setItem('dts-lang', next);
    } catch {
      // not remembered
    }
  }
}
