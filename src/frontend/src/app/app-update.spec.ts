import { describe, expect, it, vi } from 'vitest';
import { bundlesChanged, bundlesOf, reloadOnNewBuild } from './app-update';

const page = (html: string): Document => new DOMParser().parseFromString(html, 'text/html');

describe('app update', () => {
  it('lists the hashed bundles of a page and nothing else', () => {
    const doc = page('<link rel="stylesheet" href="styles-ABCD1234.css"><link rel="icon" href="favicon.png"><script src="/dts/main-WXYZ9876.js" type="module"></script><script src="/env-inject.js"></script>');
    expect(bundlesOf(doc, 'http://x/dts/')).toEqual(['/dts/main-WXYZ9876.js', '/dts/styles-ABCD1234.css']);
  });

  it('finds no bundles in a development page, so it never reloads', () => {
    const doc = page('<script src="main.js"></script><link rel="stylesheet" href="styles.css">');
    expect(bundlesOf(doc, 'http://x/')).toEqual([]);
    expect(bundlesChanged([], [])).toBe(false);
  });

  it('sees a new build by another hash, and ignores an unreadable hosted page', () => {
    expect(bundlesChanged(['/main-AAAAAAAA.js'], ['/main-BBBBBBBB.js'])).toBe(true);
    expect(bundlesChanged(['/main-AAAAAAAA.js'], ['/main-AAAAAAAA.js'])).toBe(false);
    expect(bundlesChanged(['/main-AAAAAAAA.js'], [])).toBe(false);
  });

  // Requirement: the check must not fetch a page that asks for a login (the admin page at /dts/), or every visitor gets a password prompt.
  it('fetches the page it is given, not the base address', async () => {
    const doc = page('<script src="/dts/main-AAAAAAAA.js" type="module"></script>');
    Object.defineProperty(doc, 'baseURI', { value: 'http://x/dts/' });
    Object.defineProperty(doc, 'visibilityState', { value: 'visible' });
    const fetched: string[] = [];
    const fake = vi.fn((url: string) => { fetched.push(url); return Promise.resolve(new Response('', { status: 404 })); });
    vi.stubGlobal('fetch', fake);
    const stop = reloadOnNewBuild(60_000, doc, window, 'http://x/dts/index.html');
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(fetched).toEqual(['http://x/dts/index.html']));
    stop();
    vi.unstubAllGlobals();
  });
});
