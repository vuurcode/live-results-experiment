/** The part of the Screen Wake Lock API that is used. */
export interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener?(type: 'release', listener: () => void): void;
}
export interface WakeLockHost {
  wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
}

/**
 * Keeps the screen from sleeping while the page is visible, so a results board left on a table or a stand stays on.
 * A browser drops the lock whenever the page is hidden, so it is requested again when the page comes back. Browsers
 * without the API, or that refuse the request (low battery, a policy), simply let the screen sleep. Returns a function that
 * releases the lock and stops listening. With idleMs the lock is also released after that long without a touch, key or
 * pointer event, so a phone forgotten on a table is not kept lit; the next touch takes the lock again.
 */
export function keepScreenAwake(host: WakeLockHost, doc: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>, idleMs = 0): () => void {
  if (!host.wakeLock) return () => undefined;
  let lock: WakeLockSentinelLike | null = null;
  let stopped = false;
  let idle = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const acquire = async (): Promise<void> => {
    if (stopped || idle || lock || doc.visibilityState !== 'visible') return;
    try {
      const granted = await host.wakeLock!.request('screen');
      if (stopped) {
        void granted.release();
        return;
      }
      lock = granted;
      granted.addEventListener?.('release', () => { if (lock === granted) lock = null; });
    } catch {
      // refused: the screen sleeps as usual
    }
  };
  const onVisibility = (): void => { void acquire(); };
  const goIdle = (): void => {
    idle = true;
    void lock?.release();
    lock = null;
  };
  const onActivity = (): void => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(goIdle, idleMs);
    if (idle) {
      idle = false;
      void acquire();
    }
  };
  const ACTIVITY = ['pointerdown', 'keydown', 'touchstart'] as const;

  doc.addEventListener('visibilitychange', onVisibility);
  if (idleMs > 0) {
    for (const t of ACTIVITY) doc.addEventListener(t, onActivity, { passive: true });
    idleTimer = setTimeout(goIdle, idleMs);
  }
  void acquire();
  return () => {
    stopped = true;
    clearTimeout(idleTimer);
    for (const t of ACTIVITY) doc.removeEventListener(t, onActivity);
    doc.removeEventListener('visibilitychange', onVisibility);
    void lock?.release();
    lock = null;
  };
}
