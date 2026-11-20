/*
 * Keeps the DTS pages openable on a bad connection. Page loads under /dts/ try the network for a few seconds and fall
 * back to the last copy; the hashed script and style files never change, so they are kept for good. The API and
 * everything outside the DTS pages go straight to the network.
 */
const CACHE = 'dts-shell-v4';
const SHELL = '/dts-shell';
const SHELL_URL = '/dts/sign';
const WAIT_MS = 3500;

const ASSET = /-[A-Za-z0-9_-]{8}\.(js|css)$/;
const BASE = '/dts/';

/**
 * The first visit loads the page before this worker controls it, so neither the page nor its scripts passed through
 * the fetch handler. They are fetched once here, the scripts the page names and the chunks those name in turn, so that
 * a reload without connection works from the first visit on.
 */
async function precache() {
  const cache = await caches.open(CACHE);
  const res = await fetch(SHELL_URL, { cache: 'no-cache' });
  if (!res.ok) return;
  await cache.put(SHELL, res.clone());
  const pending = [...(await res.text()).matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => new URL(m[1], location.origin + BASE).pathname);
  pending.push('/dts-transponder-red.webp', '/dts-transponder-blue.webp');
  const seen = new Set();
  while (pending.length) {
    const path = pending.pop();
    if (seen.has(path) || !(ASSET.test(path) || /^\/(icon|apple-touch-icon)\.png$/.test(path) || /^\/dts-transponder-/.test(path))) continue;
    seen.add(path);
    const file = (await cache.match(path)) ?? (await fetch(path).then((r) => (r.ok ? (cache.put(path, r.clone()), r) : null)));
    if (file && path.endsWith('.js')) {
      for (const m of (await file.clone().text()).matchAll(/\.\/(chunk-[A-Za-z0-9_-]+\.js)/g)) pending.push(BASE + m[1]);
    }
  }
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  // a failed precache only means the first offline reload has to wait for the second visit
  event.waitUntil(precache().catch(() => undefined));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith('dts-shell-') && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

async function page(request) {
  const cache = await caches.open(CACHE);
  const network = fetch(request, { cache: 'no-cache' }).then((res) => {
    if (res.ok) cache.put(SHELL, res.clone());
    return res;
  });
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), WAIT_MS));
  try {
    const first = await Promise.race([network, timeout]);
    if (first) return first;
    return (await cache.match(SHELL)) ?? network;
  } catch {
    return (await cache.match(SHELL)) ?? Response.error();
  }
}

async function asset(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

/** Scripts and styles without a hash in their name (a development server) are fetched fresh, and the last copy serves when there is no connection. */
async function fresh(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    return (await cache.match(request)) ?? Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' && url.pathname.startsWith('/dts/')) {
    event.respondWith(page(request));
    return;
  }
  if (ASSET.test(url.pathname) || /^\/(icon|apple-touch-icon)\.png$/.test(url.pathname) || /^\/dts-transponder-(red|blue)\.webp$/.test(url.pathname)) {
    event.respondWith(asset(request));
  } else if (url.pathname.startsWith(BASE) && (request.destination === 'script' || request.destination === 'style')) {
    event.respondWith(fresh(request));
  }
});
