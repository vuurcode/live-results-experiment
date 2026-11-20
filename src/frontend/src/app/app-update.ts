/** A script or style file with a content hash in its name, as the build writes them (`main-ABCD1234.js`). */
const HASHED = /-[A-Z0-9]{8}\.(js|css)$/;

/** The hashed script and style files a page names. The development server writes none, so there is nothing to compare. */
export function bundlesOf(doc: Pick<Document, 'querySelectorAll'>, base: string): string[] {
  const urls = Array.from(doc.querySelectorAll('script[src], link[rel="stylesheet"], link[rel="modulepreload"]'), (el) => el.getAttribute('src') ?? el.getAttribute('href') ?? '');
  return [...new Set(urls.map((u) => new URL(u, base).pathname).filter((p) => HASHED.test(p)))].sort();
}

/** True when the hosted page names other bundles than the ones this page runs on. */
export const bundlesChanged = (running: string[], hosted: string[]): boolean => hosted.length > 0 && running.join('\n') !== hosted.join('\n');

const RELOADED = 'app-update-reloaded';
const MIN_GAP_MS = 30_000;

/** Whether a person is in the middle of typing: reloading then would throw the text away. */
function typing(doc: Document): boolean {
  const el = doc.activeElement;
  return !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && !['button', 'checkbox', 'radio', 'submit', 'range'].includes((el as HTMLInputElement).type)) || (el as HTMLElement).isContentEditable);
}

/**
 * Reloads the page when the hosted one has been replaced by a new build, so a screen left open (a results board, a phone
 * on the sign-in page) runs the new code without anyone refreshing it. The page itself is never cached (`no-cache`),
 * so fetching it shows what is hosted now. The check runs every `intervalMs`, and at once when the tab becomes visible
 * again or the connection returns. A reload waits while someone is typing, and never follows another within 30 seconds, so a
 * stale proxy cannot make the page reload in a loop. `pageUrl` is the page to fetch (the base address by default): it must be
 * one that asks for no login, or every visitor gets a password prompt. Returns a function that stops checking.
 */
export function reloadOnNewBuild(intervalMs = 60_000, doc: Document = document, win: Window = window, pageUrl: string = doc.baseURI): () => void {
  const running = bundlesOf(doc, doc.baseURI);
  if (!running.length) return () => undefined;
  let busy = false;

  const check = async (): Promise<void> => {
    if (busy || doc.visibilityState !== 'visible') return;
    busy = true;
    try {
      void win.navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => undefined);
      const res = await fetch(pageUrl, { cache: 'no-store', headers: { Accept: 'text/html' } });
      if (!res.ok) return;
      const hosted = bundlesOf(new DOMParser().parseFromString(await res.text(), 'text/html'), doc.baseURI);
      if (!bundlesChanged(running, hosted) || typing(doc)) return;
      let last = 0;
      try { last = Number(win.sessionStorage.getItem(RELOADED)) || 0; } catch { /* no session storage: the gap is not kept */ }
      if (Date.now() - last < MIN_GAP_MS) return;
      try { win.sessionStorage.setItem(RELOADED, String(Date.now())); } catch { /* as above */ }
      win.location.reload();
    } catch {
      // offline or a failing host: the next check tries again
    } finally {
      busy = false;
    }
  };

  const timer = setInterval(() => void check(), intervalMs);
  const onWake = (): void => void check();
  doc.addEventListener('visibilitychange', onWake);
  win.addEventListener('online', onWake);
  win.addEventListener('pageshow', onWake);
  win.addEventListener('focusout', onWake);
  return () => {
    clearInterval(timer);
    doc.removeEventListener('visibilitychange', onWake);
    win.removeEventListener('online', onWake);
    win.removeEventListener('pageshow', onWake);
    win.removeEventListener('focusout', onWake);
  };
}
