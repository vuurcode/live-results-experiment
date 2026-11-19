import { describe, expect, it } from 'vitest';
import { bundlesChanged, bundlesOf } from './app-update';

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
});
