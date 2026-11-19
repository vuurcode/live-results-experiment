import { buildPdf, PDF_COLORS, type PdfCell, type PdfDoc } from './dts-pdf';

const cell = (cap: string, extra: Partial<PdfCell> = {}): PdfCell => ({ cap, name: `Rider ${cap}`, signed: false, ...extra });

function doc(cells: PdfCell[], log: PdfDoc['log'] = [{ time: '10:01', cap: '1', name: 'Name', action: 'Cap changed (Ünïcode ✓)', who: 'Phone 1' }]): PdfDoc {
  return {
    heading: 'Tekenlijst', signedCount: (n) => `Aantal getekend: ${n}`, unsignedCount: (n) => `Aantal niet-getekend: ${n}`, page: (n, of) => `${n} van ${of}`, generated: '15-11-2026 10:00', logHeading: 'Logboek', addedLabel: 'Nieuw/Toevoeging',
    races: [{ left: ['08-11-2026', 'Race (x)', 'CAT'], title: 'Place - 10.00 uur', cells }], log,
  };
}

const text = (b: Uint8Array) => Array.from(b, (x) => String.fromCharCode(x)).join('');

/** The brightness a black and white printer gives a colour (0 black, 1 white), and the contrast ratio of two of them. */
const gray = ([r, g, b]: number[]) => 0.299 * r + 0.587 * g + 0.114 * b;
const light = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const contrast = (a: number[], b: number[]) => {
  const [hi, lo] = [light(gray(a)), light(gray(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('dts pdf', () => {
  // Requirement: the list must stay readable and tell its marks apart when printed in grayscale.
  it('reads on a grayscale print: text, borders and marks keep their contrast without colour', () => {
    const c = PDF_COLORS;
    const black = [0, 0, 0];
    for (const fill of [c.signedFill, c.openFill]) {
      expect(contrast(black, fill)).toBeGreaterThanOrEqual(12);
      expect(contrast(c.openText, fill)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.changedText, fill)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.addedBorder, fill)).toBeGreaterThanOrEqual(3);
    }
    expect(contrast([c.noteGray, c.noteGray, c.noteGray], c.page)).toBeGreaterThanOrEqual(4.5);
    // a signed cell differs from one still to sign by its fill and by the tick, which shows on the fill and keeps the text readable
    expect(contrast(c.signedFill, c.openFill)).toBeGreaterThanOrEqual(1.15);
    expect(contrast(c.tick, c.signedFill)).toBeGreaterThanOrEqual(1.8);
    expect(contrast(black, c.tick)).toBeGreaterThanOrEqual(7);
  });

  it('writes a well-formed file with a page per 56 numbers and the log after the list', () => {
    const cells = Array.from({ length: 60 }, (_, i) => cell(String(i + 1)));
    const s = text(buildPdf(doc(cells)));
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(s).toContain('/Count 3');
    expect(s).toContain('(1 van 3)');
    expect(s).toContain('(Aantal getekend: 0) Tj');
    expect(s).toContain('(Aantal niet-getekend: 60) Tj');
    expect(s).toMatch(/0 0\.4 0\.1 rg BT \/F2 9 Tf [\d. ]+Td \(Aantal getekend: 0\)/);
    expect(s).toMatch(/0\.65 0 0 rg BT \/F2 9 Tf [\d. ]+Td \(Aantal niet-getekend: 60\)/);
    expect(s.indexOf('(Logboek)')).toBeGreaterThan(s.indexOf('(Aantal niet-getekend: 60)'));
  });

  it('continues the log over more pages when it has more lines than a page holds', () => {
    const log = Array.from({ length: 200 }, (_, i) => ({ time: '10:00', cap: String(i + 1), name: 'Someone', action: 'Getekend' }));
    const s = text(buildPdf({ ...doc([cell('1')]), log }));
    expect(s).toContain('/Count 4');
    expect(s).toContain('(4 van 4)');
    expect(s).toContain('(200) Tj');
  });

  it('fits a long name: smaller, and over two lines when needed', () => {
    const short = text(buildPdf(doc([cell('1', { name: 'Short Name', signed: true })])));
    expect(short).toContain('/F1 9 Tf');
    expect(short).toContain('(Short Name) Tj');
    const long = text(buildPdf(doc([cell('1', { name: 'Marieke van der Westhuizen-Oosterhuis', signed: true })])));
    expect(long).toContain('/F1 8 Tf');
    expect(long).toContain('(Marieke van der) Tj');
    expect(long).toContain('(Westhuizen-Oosterhuis) Tj');
    const longer = text(buildPdf(doc([cell('1', { name: 'Marieke Johanna Cornelia Petronella van der Westhuizen-Oosterhuis de Vries-Hoogeveen Janssen', signed: true })])));
    expect(longer).toContain('/F1 7 Tf');
    expect(longer).toContain('...) Tj');
  });

  it('draws the border of an added racer in green, without a plus before the name', () => {
    const s = text(buildPdf(doc([cell('1', { name: 'New Person', added: true })])));
    expect(s).toContain('(New Person) Tj');
    expect(s).not.toContain('+ New Person');
    expect(s).toContain('0.05 0.45 0.15 RG');
    expect(s).toMatch(/0\.05 0\.45 0\.15 RG 2 w \[6 [0-9.]+\] 0 d/);
    expect(s).toContain('(Nieuw/Toevoeging) Tj');
  });

  it('spaces only the characters of a transponder code and resets the spacing after it', () => {
    const s = text(buildPdf(doc([cell('1', { name: 'Zoe', t1: 'AB-12345' })])));
    expect(s).toMatch(/Tf 0\.8 Tc [0-9. ]+Td \(AB-12345\) Tj ET 0 g 0 Tc/);
    expect(s.match(/ Tc /g)?.length).toBe(1);
  });

  it('draws the strike-through lines half transparent and nothing else', () => {
    const s = text(buildPdf(doc([cell('1', { capWas: '9', t1Was: 'AB-1', t1: 'AB-2' })])));
    expect(s).toContain('/ExtGState << /GS1 << /CA 0.5 >> >>');
    expect(s.match(/q \/GS1 gs\n[^\n]* l S\nQ/g)?.length).toBe(2);
  });

  it('draws the licence number small and spaced in the top left corner', () => {
    const s = text(buildPdf(doc([cell('1', { name: 'Zoe', licence: '10000009' })])));
    expect(s).toMatch(/\/F1 5 Tf 0\.8 Tc [0-9. ]+Td \(10000009\) Tj ET 0 g 0 Tc/);
  });

  it('carries the file name as the document title', () => {
    const s = text(buildPdf({ ...doc([cell('1')]), title: 'Tekenlijst_20261108_Race_CAT' }));
    expect(s).toContain('<< /Title (Tekenlijst_20261108_Race_CAT) >>');
    const m = /trailer\n<< \/Size (\d+) \/Root 1 0 R \/Info (\d+) 0 R >>/.exec(s);
    expect(Number(m?.[2])).toBe(Number(m?.[1]) - 1);
  });

  it('points the cross reference table at the objects', () => {
    const s = text(buildPdf(doc([cell('1')])));
    const start = Number(/startxref\n(\d+)/.exec(s)?.[1]);
    expect(s.slice(start, start + 4)).toBe('xref');
    const first = /xref\n0 \d+\n0000000000 65535 f \n(\d{10})/.exec(s)?.[1];
    expect(s.slice(Number(first), Number(first) + 7)).toBe('1 0 obj');
  });

  it('strikes through the original of a changed number and transponder, and ticks a signed one', () => {
    const plain = text(buildPdf(doc([cell('1', { t1: 'AB-12345' })])));
    const changed = text(buildPdf(doc([cell('1', { capWas: '7', t1: 'AB-12345', t1Was: 'CD-54321', signed: true })])));
    expect(changed).toContain('(7) Tj');
    expect(changed).toContain('(CD-54321) Tj');
    // three strikes, and the four sides of the dashed border
    expect((changed.match(/ l S/g) ?? []).length).toBe((plain.match(/ l S/g) ?? []).length + 3 + 4);
  });

  it('escapes parentheses and replaces characters outside Latin-1', () => {
    const s = text(buildPdf(doc([cell('1', { name: 'A (b) ✓ é' })])));
    expect(s).toContain('A \\(b\\) ? é');
  });

  it('draws a note and the new value of a change in bold', () => {
    const log = (action: string, bold?: string) => text(buildPdf(doc([], [{ time: '10:01', cap: '1', name: 'N', action, bold, who: 'P' }])));
    expect(log('note: hi', 'all')).toMatch(/\/F2 8 Tf [\d.]+ [\d.]+ Td \(note: hi\)/);
    expect(log('number 5 -> 6', '6')).toMatch(/\/F2 8 Tf [\d.]+ [\d.]+ Td \(6\)/);
  });

  it('colours a log line: notes blue, competitors added green, what was undone red', () => {
    const line = (action: string, tone?: 'note' | 'added' | 'undone') => text(buildPdf(doc([], [{ time: '10:01', cap: '1', name: 'N', action, tone, who: 'P' }])));
    expect(line('note: hi', 'note')).toContain('0 0.1 0.55 rg BT /F1 8 Tf');
    expect(line('added', 'added')).toContain('0 0.4 0.1 rg BT /F1 8 Tf');
    expect(line('signing undone', 'undone')).toContain('0.65 0 0 rg BT /F1 8 Tf');
    expect(line('signed')).not.toMatch(/ rg BT \/F1 8 Tf [\d. ]+Td \(signed\)/);
  });

  it('separates the log lines of different competitors with a dotted line', () => {
    const l = (entry: string) => ({ time: '10:01', cap: '1', name: 'N', action: 'signed', entry });
    const dots = (log: PdfDoc['log']) => (text(buildPdf(doc([], log))).match(/\[0 2\] 0 d/g) ?? []).length;
    expect(dots([l('a'), l('a'), l('b'), l('b'), l('a')])).toBe(2);
    expect(dots([l('a'), l('a')])).toBe(0);
  });

  it('draws arrows and dashes as look-alikes', () => {
    const s = text(buildPdf(doc([], [{ time: '10:01', cap: '1', name: 'N', action: 'number 5 → 6, – ', who: 'P' }])));
    expect(s).toContain('number 5 -> 6, -');
  });

  it('still makes a page when there is nothing to list', () => {
    const s = text(buildPdf({ ...doc([]), log: [] }));
    expect(s).toContain('(Aantal getekend: 0) Tj');
    expect(s).toContain('(Aantal niet-getekend: 0) Tj');
  });
});
