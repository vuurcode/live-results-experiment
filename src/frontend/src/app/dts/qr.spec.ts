import { qrEncode, reedSolomon } from './qr';

/** Reads the data modules back the way a scanner does: unmask, un-zigzag, deinterleave, check the error correction. */
function read(text: string) {
  const code = qrEncode(text)!;
  const { size, modules, isFunction, version } = code;
  // the format bits of both copies agree and are a valid BCH codeword
  const f1: number[] = [];
  for (let i = 0; i <= 5; i++) f1.push(modules[i][8] ? 1 : 0);
  f1.push(modules[7][8] ? 1 : 0, modules[8][8] ? 1 : 0, modules[8][7] ? 1 : 0);
  for (let i = 9; i < 15; i++) f1.push(modules[8][14 - i] ? 1 : 0);
  const f2: number[] = [];
  for (let i = 0; i < 8; i++) f2.push(modules[8][size - 1 - i] ? 1 : 0);
  for (let i = 8; i < 15; i++) f2.push(modules[size - 15 + i][8] ? 1 : 0);
  expect(f1).toEqual(f2);
  const fmt = f1.reduce((a, b, i) => a | (b << i), 0) ^ 0x5412;
  let r = fmt;
  for (let i = 14; i >= 10; i--) if ((r >>> i) & 1) r ^= 0x537 << (i - 10);
  expect(r).toBe(0);
  const mask = (fmt >>> 10) & 7;
  const masks = [
    (x: number, y: number) => (x + y) % 2 === 0, (_x: number, y: number) => y % 2 === 0, (x: number) => x % 3 === 0,
    (x: number, y: number) => (x + y) % 3 === 0, (x: number, y: number) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x: number, y: number) => ((x * y) % 2) + ((x * y) % 3) === 0, (x: number, y: number) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x: number, y: number) => ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0,
  ];
  const bits: number[] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
      if (!isFunction[y][x]) bits.push(modules[y][x] !== masks[mask](x, y) ? 1 : 0);
    }
  }
  const words: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) words.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  return { words, version };
}

const ECC = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];

function decode(text: string): string {
  const { words, version } = read(text);
  const nb = BLOCKS[version], ecc = ECC[version];
  const shortBlocks = nb - (words.length % nb), shortLen = Math.floor(words.length / nb);
  const blocks: number[][] = Array.from({ length: nb }, () => []);
  let k = 0;
  for (let i = 0; i < shortLen - ecc + 1; i++) for (let b = 0; b < nb; b++) if (!(i === shortLen - ecc && b < shortBlocks)) blocks[b].push(words[k++]);
  const eccs: number[][] = Array.from({ length: nb }, () => []);
  for (let i = 0; i < ecc; i++) for (let b = 0; b < nb; b++) eccs[b].push(words[k++]);
  blocks.forEach((d, b) => expect(reedSolomon(d, ecc)).toEqual(eccs[b]));
  const data = blocks.flat();
  const bits = data.map((w) => w.toString(2).padStart(8, '0')).join('');
  expect(bits.slice(0, 4)).toBe('0100');
  const cc = version < 10 ? 8 : 16;
  const len = parseInt(bits.slice(4, 4 + cc), 2);
  const out: number[] = [];
  for (let i = 0; i < len; i++) out.push(parseInt(bits.slice(4 + cc + i * 8, 12 + cc + i * 8), 2));
  return new TextDecoder().decode(new Uint8Array(out));
}

describe('qr', () => {
  it('has the known error correction codewords for a classic example', () => {
    // "HELLO WORLD" 1-M example data codewords from the QR tutorial literature
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(reedSolomon(data, 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });

  it('round-trips links of the size the sign page makes, in several versions', () => {
    for (const n of [5, 40, 100, 140, 180, 213]) {
      const text = 'https://example.org/dts/sign#' + 'a1B2-_'.repeat(40).slice(0, n - 29 > 0 ? n - 29 : 1);
      expect(decode(text)).toBe(text);
    }
  });

  it('refuses text that does not fit', () => {
    expect(qrEncode('x'.repeat(214))).toBeNull();
  });
});
