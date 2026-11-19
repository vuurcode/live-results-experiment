/**
 * A small QR code encoder: byte mode, error correction level M, versions 1 to 10 (up to 213 bytes), the
 * mask with the lowest penalty. Plain code so the sign page needs no library to show its link as a code.
 */

const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
export const QR_MAX_BYTES = 213;

export interface QrCode {
  size: number;
  version: number;
  /** modules[y][x], true is dark */
  modules: boolean[][];
  /** the modules that are not data (finders, timing, format), for the reader in the spec */
  isFunction: boolean[][];
}

function rawModules(ver: number): number {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}

function alignPositions(ver: number): number[] {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const out = [6];
  for (let pos = ver * 4 + 17 - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

// GF(256) with the QR polynomial 0x11D
const EXP: number[] = [];
const LOG: number[] = [];
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const mul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

export function reedSolomon(data: number[], degree: number): number[] {
  let gen = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(gen.length + 1).fill(0);
    gen.forEach((c, j) => {
      next[j] ^= c;
      next[j + 1] ^= mul(c, EXP[i]);
    });
    gen = next;
  }
  // gen[0] is the leading coefficient (1); the remainder uses the others
  const rem = new Array<number>(degree).fill(0);
  for (const b of data) {
    const factor = b ^ rem[0];
    rem.shift();
    rem.push(0);
    for (let i = 0; i < degree; i++) rem[i] ^= mul(gen[i + 1], factor);
  }
  return rem;
}

function bytesOf(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

export function qrEncode(text: string): QrCode | null {
  const bytes = bytesOf(text);
  let ver = 1;
  const capacity = (v: number) => Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[v] * BLOCKS[v];
  while (ver <= 10 && (4 + (ver < 10 ? 8 : 16) + bytes.length * 8 + 7) >> 3 > capacity(ver)) ver++;
  if (ver > 10) return null;

  const bits: number[] = [];
  const put = (v: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, ver < 10 ? 8 : 16);
  bytes.forEach((b) => put(b, 8));
  const dataBits = capacity(ver) * 8;
  put(0, Math.min(4, dataBits - bits.length));
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; data.length < capacity(ver); pad ^= 0xec ^ 0x11) data.push(pad);

  // blocks, each with its own error correction, then interleaved
  const nb = BLOCKS[ver], ecc = ECC_PER_BLOCK[ver];
  const rawCodewords = Math.floor(rawModules(ver) / 8);
  const shortBlocks = nb - (rawCodewords % nb);
  const shortLen = Math.floor(rawCodewords / nb);
  const blocks: number[][] = [];
  const eccs: number[][] = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const len = shortLen - ecc + (i < shortBlocks ? 0 : 1);
    const d = data.slice(k, k + len);
    k += len;
    blocks.push(d);
    eccs.push(reedSolomon(d, ecc));
  }
  const all: number[] = [];
  for (let i = 0; i < shortLen - ecc + 1; i++) blocks.forEach((b) => i < b.length && all.push(b[i]));
  for (let i = 0; i < ecc; i++) eccs.forEach((e) => all.push(e[i]));

  const size = ver * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const isFunction = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    modules[y][x] = dark;
    isFunction[y][x] = true;
  };

  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(cx + dx, cy + dy, d !== 2 && d !== 4);
    }
  }
  const al = alignPositions(ver);
  for (let i = 0; i < al.length; i++) for (let j = 0; j < al.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const formatAt = (mask: number) => {
    const d = (0 << 3) | mask; // level M is 00
    let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    return ((d << 10) | r) ^ 0x5412;
  };
  const drawFormat = (mask: number) => {
    const f = formatAt(mask);
    const bit = (i: number) => ((f >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  drawFormat(0);
  if (ver >= 7) {
    let r = ver;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const v = (ver << 12) | r;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      set(a, b, ((v >>> i) & 1) !== 0);
      set(b, a, ((v >>> i) & 1) !== 0);
    }
  }

  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j;
      const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
      if (!isFunction[y][x] && i < all.length * 8) {
        modules[y][x] = ((all[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
        i++;
      }
    }
  }

  const masks: ((x: number, y: number) => boolean)[] = [
    (x, y) => (x + y) % 2 === 0,
    (_x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0,
  ];
  const applyMask = (m: number) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!isFunction[y][x] && masks[m](x, y)) modules[y][x] = !modules[y][x];
  };
  let best = 0, bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m);
    drawFormat(m);
    const score = penalty(modules);
    applyMask(m);
    if (score < bestScore) {
      best = m;
      bestScore = score;
    }
  }
  applyMask(best);
  drawFormat(best);
  return { size, version: ver, modules, isFunction };
}

/** Runs of five or more, 2x2 blocks and the dark share: enough to pick a mask a camera reads well. */
function penalty(m: boolean[][]): number {
  const n = m.length;
  let score = 0, dark = 0;
  for (let y = 0; y < n; y++) {
    let run = 1, runV = 1;
    for (let x = 0; x < n; x++) {
      if (m[y][x]) dark++;
      if (x > 0) {
        run = m[y][x] === m[y][x - 1] ? run + 1 : 1;
        if (run === 5) score += 3;
        else if (run > 5) score++;
        runV = m[x][y] === m[x - 1][y] ? runV + 1 : 1;
        if (runV === 5) score += 3;
        else if (runV > 5) score++;
        if (y > 0 && m[y][x] === m[y][x - 1] && m[y][x] === m[y - 1][x] && m[y][x] === m[y - 1][x - 1]) score += 3;
      }
    }
  }
  score += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
  return score;
}

/** One SVG path for all dark modules, with a 4-module quiet zone. */
export function qrPath(code: QrCode): string {
  const parts: string[] = [];
  code.modules.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) { x++; continue; }
      const start = x;
      while (x < row.length && row[x]) x++;
      parts.push(`M${start + 4} ${y + 4}h${x - start}v1h${start - x}z`);
    }
  });
  return parts.join('');
}
