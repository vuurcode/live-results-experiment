/** A dependency-free writer of the signing list as a PDF: A4 pages with a grid of number boxes per race, then the action log. */

export interface PdfCell {
  cap: string;
  /** The number of the uploaded file when it was changed: drawn struck through. */
  capWas?: string;
  t1?: string;
  t1Was?: string;
  t2?: string;
  t2Was?: string;
  name: string;
  /** The licence number, drawn small in the top left corner. */
  licence?: string;
  signed: boolean;
  added?: boolean;
  /** The values that differ from the uploaded file (also a transponder that was set or removed): drawn bold and red. */
  changed?: { cap?: boolean; t1?: boolean; t2?: boolean };
}

export interface PdfRace {
  /** Left of the header: the date, the race name and the category code, one per line. */
  left: string[];
  /** The middle of the header: what the race is. */
  title: string;
  cells: PdfCell[];
}

export interface PdfLogLine {
  time: string;
  /** The number and the name of the competitor, each in a column of its own. */
  cap: string;
  name: string;
  action: string;
  /** What is drawn bold of the action: all of it (a note), or the part that is the new value of a change. */
  bold?: 'all' | string;
  /** The competitor the line is about; a change of it between two lines draws a separator. */
  entry?: string;
  /** The colour of the action: a note, a competitor added, or something undone (signing, a closed race). */
  tone?: 'note' | 'added' | 'undone';
  /** Who did it (the signer's device), drawn small and gray at the right. */
  who?: string;
}

export interface PdfDoc {
  /** The document title, which a PDF viewer shows in the tab and offers as the name when saving. */
  title?: string;
  /** The word at the top right of every list page. */
  heading: string;
  /** "Aantal getekend: 5" and "Aantal niet-getekend: 7" for the numbers of a race that are signed and not signed. */
  signedCount: (n: number) => string;
  unsignedCount: (n: number) => string;
  /** "1 van 3". */
  page: (n: number, of: number) => string;
  /** When the list was made, as text. */
  generated: string;
  logHeading: string;
  /** The bold word at the top left of the cell of a racer added during the day. */
  addedLabel: string;
  races: PdfRace[];
  log: PdfLogLine[];
}

const W = 595.28;
const H = 841.89;
const MARGIN = 27;
const COLS = 4;
const BOX_W = 126;
/** The columns span the page between the margins. */
const COL_PITCH = (W - 2 * MARGIN - BOX_W) / (COLS - 1);
const BOX_H = 46;
/** The sizes of a name, largest first. */
const NAME_SIZES = [9, 8, 7];
/** The size of a transponder code, and the distance between two of them. */
const TRANSPONDER_SIZE = 8;
/** The extra space between the characters of a transponder code, in points. */
const TRANSPONDER_SPACING = 0.8;
/** The size of the licence number in the top left corner. */
const LICENCE_SIZE = 5;
const ROW_PITCH = 50;
const GRID_TOP = 62;
const ROWS = 14;
const PER_PAGE = COLS * ROWS;

type Font = 'F1' | 'F2' | 'F3';

/** Helvetica advance widths of the printable ASCII range (per 1000 em), for aligning and shortening text. */
const WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** Characters outside Latin-1 that have a plain look-alike, which the PDF fonts can draw. */
const LOOKALIKES: Record<string, string> = { '→': '->', '←': '<-', '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...' };

/** The text as the one-byte characters of the PDF: Latin-1 stays, look-alikes are replaced, anything else becomes a question mark. */
function latin(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFC').replace(/[→←–—‘’“”…]/g, (c) => LOOKALIKES[c])) {
    const c = ch.codePointAt(0) ?? 63;
    out += c >= 32 && c < 127 || c >= 160 && c < 256 ? ch : '?';
  }
  return out;
}

function width(text: string, size: number, font: Font): number {
  let w = 0;
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    w += c >= 32 && c < 127 ? WIDTHS[c - 32] : 556;
  }
  return (w * size * (font === 'F2' ? 1.06 : 1)) / 1000;
}

/** The width of text with extra space between its characters. */
function spacedWidth(text: string, size: number, font: Font, spacing: number): number {
  return width(text, size, font) + spacing * (text.length - 1);
}

/** The text cut to fit the width, with dots for what was left out. */
function fit(text: string, size: number, font: Font, max: number): string {
  if (width(text, size, font) <= max) return text;
  let t = text;
  while (t.length > 1 && width(`${t}...`, size, font) > max) t = t.slice(0, -1);
  return `${t.trimEnd()}...`;
}

/** The text broken into lines that fit the width. */
function wrap(text: string, size: number, font: Font, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && width(next, size, font) > max) {
      lines.push(line);
      line = fit(word, size, font, max);
    } else line = width(next, size, font) > max ? fit(next, size, font, max) : next;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

const num = (n: number) => (Math.round(n * 100) / 100).toString();
const esc = (s: string) => latin(s).replace(/[\\()]/g, '\\$&');

/** One page being drawn; y counts from the top of the page. */
class Page {
  private readonly ops: string[] = [];

  text(s: string, x: number, y: number, size: number, font: Font = 'F1', align: 'left' | 'right' | 'center' = 'left', rgb?: [number, number, number], spacing = 0): void {
    const t = latin(s);
    if (!t) return;
    const w = spacedWidth(t, size, font, spacing);
    const left = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
    this.ops.push(`${rgb ? `${rgb.join(' ')} rg ` : ''}BT /${font} ${num(size)} Tf${spacing ? ` ${num(spacing)} Tc` : ''} ${num(left)} ${num(H - y)} Td (${esc(t)}) Tj ET${rgb ? ' 0 g' : ''}${spacing ? ' 0 Tc' : ''}`);
  }

  /** Text in gray. */
  grayText(s: string, x: number, y: number, size: number): void {
    const t = latin(s);
    if (!t) return;
    this.ops.push(`${NOTE_GRAY} g BT /F1 ${num(size)} Tf ${num(x)} ${num(H - y)} Td (${esc(t)}) Tj ET 0 g`);
  }

  line(x1: number, y1: number, x2: number, y2: number, lineWidth = 0.6): void {
    this.ops.push(`${num(lineWidth)} w ${num(x1)} ${num(H - y1)} m ${num(x2)} ${num(H - y2)} l S`);
  }

  rect(x: number, y: number, w: number, h: number, lineWidth = 0.6): void {
    this.ops.push(`${num(lineWidth)} w ${num(x)} ${num(H - y - h)} ${num(w)} ${num(h)} re S`);
  }

  /**
   * A dashed box outline in a colour, with the stroke colour and the dash back to plain afterwards. Each side is
   * stroked on its own with a gap stretched so that the side starts and ends with a dash: the corners are always drawn.
   */
  outline(x: number, y: number, w: number, h: number, rgb: [number, number, number], lineWidth: number, dash: [number, number]): void {
    const [on, off] = dash;
    const top = H - y - h;
    const sides: [number, number, number, number][] = [
      [x, top, x + w, top],
      [x + w, top, x + w, top + h],
      [x + w, top + h, x, top + h],
      [x, top + h, x, top],
    ];
    const ops = sides.map(([x1, y1, x2, y2]) => {
      const length = Math.hypot(x2 - x1, y2 - y1);
      const n = Math.max(2, Math.round((length + off) / (on + off)));
      const gap = (length - n * on) / (n - 1);
      return `[${num(on)} ${num(gap)}] 0 d ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`;
    });
    this.ops.push(`${rgb.join(' ')} RG ${num(lineWidth)} w ${ops.join(' ')} [] 0 d 0 G`);
  }

  /** A very small dotted line in transparent gray. */
  dotted(x1: number, y: number, x2: number): void {
    this.ops.push(`q /GS1 gs 0.4 G 0.6 w 1 J [0 2] 0 d ${num(x1)} ${num(H - y)} m ${num(x2)} ${num(H - y)} l S Q`);
  }

  /** A filled box, with the text colour back to black afterwards. */
  fill(x: number, y: number, w: number, h: number, rgb: [number, number, number]): void {
    this.ops.push(`${rgb.join(' ')} rg ${num(x)} ${num(H - y - h)} ${num(w)} ${num(h)} re f 0 g`);
  }

  /** A tick mark in the box that fits the size, drawn in a light colour so that it reads as a watermark. */
  tick(x: number, y: number, size: number, rgb: [number, number, number], lineWidth: number): void {
    this.ops.push(`${rgb.join(' ')} RG ${num(lineWidth)} w 1 J 1 j ${num(x)} ${num(H - y - size * 0.55)} m ${num(x + size * 0.38)} ${num(H - y - size)} l ${num(x + size)} ${num(H - y)} l S 0 G 0 J 0 j`);
  }

  /** A half transparent line through text that was drawn with the same arguments. */
  strike(s: string, x: number, y: number, size: number, align: 'left' | 'right' = 'left', spacing = 0): void {
    const t = latin(s);
    const w = spacedWidth(t, size, 'F1', spacing);
    const left = align === 'left' ? x : x - w;
    this.ops.push('q /GS1 gs');
    this.line(left - 0.5, y - size * 0.3, left + w + 0.5, y - size * 0.3, 0.7);
    this.ops.push('Q');
  }

  get stream(): string {
    return this.ops.join('\n');
  }
}

/** Signed numbers get a very light green, the ones still to sign a light gray. */
const SIGNED_FILL: [number, number, number] = [0.94, 0.98, 0.95];
/** The watermark tick, a little darker than the signed fill; dark enough to show on a grayscale print. */
const TICK_COLOR: [number, number, number] = [0.55, 0.78, 0.6];
const OPEN_FILL: [number, number, number] = [0.88, 0.88, 0.88];
/** The text of a number still to sign is grayed out. */
const OPEN_TEXT: [number, number, number] = [0.3, 0.3, 0.3];
/** Changed values stand out in bold red. */
const CHANGED_TEXT: [number, number, number] = [0.7, 0.05, 0.05];
/** The dash pattern of the highlighted borders. */
const DASHED: [number, number] = [6, 3];
/** The border of a racer that was added during the day. */
const ADDED_BORDER: [number, number, number] = [0.05, 0.45, 0.15];
/** The gray of the secondary text (log times and signers). */
const NOTE_GRAY = 0.35;

/** The counts below a race: bold, dark green for the signed numbers and dark red for the others. */
const COUNT_SIZE = 9;
const SIGNED_COUNT: [number, number, number] = [0, 0.4, 0.1];
const UNSIGNED_COUNT: [number, number, number] = [0.65, 0, 0];
/** The colours of the log lines: dark blue for notes, dark green for competitors added, dark red for what was undone. */
const LOG_TONES: Record<NonNullable<PdfLogLine['tone']>, [number, number, number]> = { note: [0, 0.1, 0.55], added: SIGNED_COUNT, undone: UNSIGNED_COUNT };

/** The colours, for the grayscale check of the spec. */
export const PDF_COLORS = { signedFill: SIGNED_FILL, openFill: OPEN_FILL, tick: TICK_COLOR, openText: OPEN_TEXT, changedText: CHANGED_TEXT, addedBorder: ADDED_BORDER, noteGray: NOTE_GRAY, page: [1, 1, 1] as [number, number, number] };

function drawCell(p: Page, x: number, top: number, c: PdfCell, addedLabel: string): void {
  p.fill(x, top, BOX_W, BOX_H, c.signed ? SIGNED_FILL : OPEN_FILL);
  if (c.signed) {
    const size = 13;
    p.tick(x + (BOX_W - size) / 2, top + (BOX_H - size * 0.7) / 2 - size * 0.15, size, TICK_COLOR, 2);
  }
  p.rect(x, top, BOX_W, BOX_H);
  const changed = !c.added && (c.capWas || c.t1Was || c.t2Was || c.changed?.cap || c.changed?.t1 || c.changed?.t2);
  if (c.added || changed) p.outline(x - 1, top - 1, BOX_W + 2, BOX_H + 2, c.added ? ADDED_BORDER : CHANGED_TEXT, 2, DASHED);
  if (c.added) {
    // the label sits right of the licence number, which takes the corner
    const after = c.licence ? spacedWidth(latin(c.licence), LICENCE_SIZE, 'F1', TRANSPONDER_SPACING) + 6 : 0;
    p.text(addedLabel, x + 4 + after, top + 6.5, 5.5, 'F2', 'left', ADDED_BORDER);
  }
  const right = x + BOX_W - 4;
  const ink = c.signed ? undefined : OPEN_TEXT;
  if (c.licence) p.text(c.licence, x + 4, top + 6.5, LICENCE_SIZE, 'F1', 'left', ink, TRANSPONDER_SPACING);
  // the original number is half the size of the new one (20 pt), struck through above it
  if (c.capWas) {
    p.text(c.capWas, x + 4, top + 14, 10, 'F1', 'left', ink);
    p.strike(c.capWas, x + 4, top + 14, 10);
  }
  if (c.changed?.cap) p.text(c.cap, x + 4, top + 30, 20, 'F2', 'left', CHANGED_TEXT);
  else p.text(c.cap, x + 4, top + 30, 20, 'F2', 'left', ink);
  let y = top + 8;
  for (const [was, now, changed] of [[c.t1Was, c.t1, c.changed?.t1], [c.t2Was, c.t2, c.changed?.t2]] as const) {
    if (was) {
      p.text(was, right, y, TRANSPONDER_SIZE, 'F1', 'right', ink, TRANSPONDER_SPACING);
      p.strike(was, right, y, TRANSPONDER_SIZE, 'right', TRANSPONDER_SPACING);
      y += TRANSPONDER_SIZE;
    }
    if (now) {
      p.text(now, right, y, TRANSPONDER_SIZE, changed ? 'F2' : 'F1', 'right', changed ? CHANGED_TEXT : ink, TRANSPONDER_SPACING);
      y += TRANSPONDER_SIZE;
    }
  }
  const name = c.name;
  // the largest size that shows the whole name on one line, else the largest that shows it over two, else the smallest with the end cut off
  const room = BOX_W - 8;
  const words = name.split(/\s+/).filter(Boolean).join(' ');
  const single = NAME_SIZES.find((size) => width(latin(name), size, 'F1') <= room);
  const small = NAME_SIZES[NAME_SIZES.length - 1];
  const twoLines = (size: number) => wrap(name, size, 'F1', room);
  const double = single ? undefined : NAME_SIZES.slice(1).find((size) => { const l = twoLines(size); return l.length <= 2 && l.join(' ') === words; });
  if (single) p.text(name, right, top + BOX_H - 4, single, 'F1', 'right', ink);
  else {
    const size = double ?? small;
    const lines = twoLines(size);
    const shown = lines.length > 2 ? [lines[0], fit(lines.slice(1).join(' '), size, 'F1', room)] : lines;
    shown.forEach((line, k) => p.text(line, right, top + BOX_H - 4 - (shown.length - 1 - k) * (size + 1), size, 'F1', 'right', ink));
  }
}

function listPages(doc: PdfDoc): Page[] {
  const pages: Page[] = [];
  for (const race of doc.races) {
    const count = Math.max(1, Math.ceil(race.cells.length / PER_PAGE));
    for (let i = 0; i < count; i++) {
      const p = new Page();
      race.left.slice(0, 3).forEach((s, k) => p.text(s, MARGIN, 34 + k * 9, 8, k === 1 ? 'F2' : 'F1'));
      wrap(race.title, 8, 'F1', W - MARGIN - 100 - 183).slice(0, 3).forEach((line, k) => p.text(line, 183, 34 + k * 9, 8));
      p.text(doc.heading, W - MARGIN, 36, 14, 'F3', 'right');
      p.line(MARGIN, 56, W - MARGIN, 56, 0.8);
      race.cells.slice(i * PER_PAGE, (i + 1) * PER_PAGE).forEach((c, k) => {
        drawCell(p, MARGIN + (k % COLS) * COL_PITCH, GRID_TOP + Math.floor(k / COLS) * ROW_PITCH, c, doc.addedLabel);
      });
      const signed = race.cells.filter((c) => c.signed).length;
      const signedText = doc.signedCount(signed);
      p.text(signedText, MARGIN, H - 22, COUNT_SIZE, 'F2', 'left', SIGNED_COUNT);
      p.text(doc.unsignedCount(race.cells.length - signed), MARGIN + spacedWidth(latin(signedText), COUNT_SIZE, 'F2', 0) + 18, H - 22, COUNT_SIZE, 'F2', 'left', UNSIGNED_COUNT);
      pages.push(p);
    }
  }
  return pages;
}

function logPages(doc: PdfDoc): Page[] {
  if (!doc.log.length) return [];
  const pages: Page[] = [];
  const lineHeight = 10.5;
  const perPage = Math.floor((H - 60 - 40) / lineHeight);
  // the columns: time, number, name, action; who at the right edge
  const capX = MARGIN + 36;
  const nameX = capX + 34;
  const actionX = nameX + 130;
  const whoW = 70;
  const rows: { time: string; cap: string; name: string; action: string; bold?: string; tone?: PdfLogLine['tone']; entry?: string; who?: string }[] = [];
  for (const l of doc.log) {
    const lines = wrap(l.action, 8, 'F1', W - MARGIN - whoW - actionX);
    lines.forEach((t, k) => rows.push({ time: k === 0 ? l.time : '', cap: k === 0 ? l.cap : '', name: k === 0 ? fit(l.name, 8, 'F1', actionX - nameX - 8) : '', action: t, bold: l.bold, tone: l.tone, entry: l.entry, who: k === 0 ? l.who : undefined }));
  }
  for (let i = 0; i < rows.length; i += perPage) {
    const p = new Page();
    p.text(doc.logHeading, MARGIN, 36, 14, 'F3');
    p.line(MARGIN, 44, W - MARGIN, 44, 0.8);
    rows.slice(i, i + perPage).forEach((r, k) => {
      const y = 60 + k * lineHeight;
      p.grayText(r.time, MARGIN, y, 6.5);
      p.text(r.cap, capX, y, 8, 'F2');
      p.text(r.name, nameX, y, 8);
      if (k > 0 && r.entry !== undefined && r.entry !== rows[i + k - 1].entry) p.dotted(MARGIN, y - 8, W - MARGIN);
      const ink = r.tone && LOG_TONES[r.tone];
      if (r.bold === 'all') p.text(r.action, actionX, y, 8, 'F2', 'left', ink);
      else {
        // the new value of a change in bold, the rest as it is
        const at = r.bold ? r.action.lastIndexOf(r.bold) : -1;
        if (at < 0) p.text(r.action, actionX, y, 8, 'F1', 'left', ink);
        else {
          const before = r.action.slice(0, at);
          p.text(before, actionX, y, 8, 'F1', 'left', ink);
          const x = actionX + width(latin(before), 8, 'F1');
          p.text(r.bold ?? '', x, y, 8, 'F2', 'left', ink);
          p.text(r.action.slice(at + (r.bold ?? '').length), x + width(latin(r.bold ?? ''), 8, 'F2'), y, 8, 'F1', 'left', ink);
        }
      }
      if (r.who) p.grayText(fit(r.who, 6, 'F1', whoW), W - MARGIN - width(latin(fit(r.who, 6, 'F1', whoW)), 6, 'F1'), y, 6);
    });
    pages.push(p);
  }
  return pages;
}

/** The PDF file of the signing list followed by the log. */
export function buildPdf(doc: PdfDoc): Uint8Array {
  const pages = [...listPages(doc), ...logPages(doc)];
  if (!pages.length) pages.push(new Page());
  pages.forEach((p, i) => {
    p.text(doc.page(i + 1, pages.length), W - MARGIN, H - 22, 7, 'F1', 'right');
    p.text(doc.generated, W / 2, H - 22, 7, 'F1', 'center');
  });

  // objects: 1 catalog, 2 page tree, 3-5 fonts, then a page and its content per page
  const objects: string[] = [];
  const kids = pages.map((_, i) => `${6 + i * 2} 0 R`).join(' ');
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Times-BoldItalic /Encoding /WinAnsiEncoding >>');
  pages.forEach((p, i) => {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> /ExtGState << /GS1 << /CA 0.5 >> >> >> /Contents ${7 + i * 2} 0 R >>`);
    const body = `0 G 0 g\n${p.stream}`;
    objects.push(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
  });

  const title = latin(doc.title ?? '');
  if (title) objects.push(`<< /Title (${esc(title)}) >>`);

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${title ? ` /Info ${objects.length} 0 R` : ''} >>\nstartxref\n${xref}\n%%EOF\n`;

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
  return bytes;
}
