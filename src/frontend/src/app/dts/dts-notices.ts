import { signal } from '@angular/core';

/** Notices a person can dismiss. A dismissal is remembered on the device per scope (a session) unless it is for this visit only. */
export class DtsNotices {
  readonly hidden = signal<ReadonlySet<string>>(new Set());

  constructor(private readonly scope: string) {
    try {
      const stored = JSON.parse(localStorage.getItem(this.storeKey()) ?? '[]') as unknown;
      if (Array.isArray(stored)) this.hidden.set(new Set(stored.filter((x): x is string => typeof x === 'string')));
    } catch {
      // nothing remembered
    }
  }

  private storeKey(): string {
    return `dts-dismissed:${this.scope}`;
  }

  isHidden(key: string): boolean {
    return this.hidden().has(key);
  }

  dismiss(key: string, remember = true): void {
    const next = new Set(this.hidden()).add(key);
    this.hidden.set(next);
    if (!remember) return;
    try {
      const kept = [...next].filter((k) => !k.startsWith('visit:'));
      localStorage.setItem(this.storeKey(), JSON.stringify(kept));
    } catch {
      // dismissed for this visit only
    }
  }

  /** Brings a notice back, for one whose cause came back after it was dismissed. */
  restore(key: string): void {
    if (!this.hidden().has(key)) return;
    const next = new Set(this.hidden());
    next.delete(key);
    this.hidden.set(next);
  }
}
