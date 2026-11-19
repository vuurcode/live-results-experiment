/** Makes the DTS pages installable and openable offline: the manifest, the iOS home screen tags and the service worker. */

function head(tag: string, attrs: Record<string, string>): void {
  const key = Object.keys(attrs)[0];
  if (document.head.querySelector(`${tag}[${key}="${attrs[key]}"]`)) return;
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.head.appendChild(el);
}

export function installable(): void {
  // the notch and the home bar are covered by the page, the pages pad for them with safe-area insets
  const viewport = document.head.querySelector('meta[name=viewport]');
  if (viewport && !viewport.getAttribute('content')?.includes('viewport-fit')) viewport.setAttribute('content', `${viewport.getAttribute('content')}, viewport-fit=cover`);
  head('link', { rel: 'manifest', href: '/dts.webmanifest' });
  head('meta', { name: 'theme-color', content: '#0b4f9c' });
  head('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' });
  head('meta', { name: 'mobile-web-app-capable', content: 'yes' });
  head('meta', { name: 'apple-mobile-web-app-title', content: 'Tekenlijst' });
  head('meta', { name: 'referrer', content: 'no-referrer' });
  if ('serviceWorker' in navigator) {
    // A failure (private window, blocked) only means no offline shell.
    navigator.serviceWorker.register('/dts-sw.js', { scope: '/dts/' }).catch(() => undefined);
  }
}

/** True when the page runs from the home screen. */
export function standalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

/**
 * True where the browser can add the page to the home screen but the page is not there yet. `navigator.standalone` exists
 * only on iOS Safari, which drops site data after a week unless the page is on the home screen.
 */
export function homeScreenHint(): boolean {
  return 'standalone' in navigator && !standalone();
}
