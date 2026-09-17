import 'server-only';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFFont, PDFPage, rgb, type RGB } from 'pdf-lib';
import { forPdf } from './bidi';
import type { CheckSeverity, PropertyReport } from './report';

const FONT_DIR = resolve(process.cwd(), 'assets', 'fonts');

/**
 * DejaVu is vendored rather than taken from the host: it carries Hebrew, Latin
 * digits and the shekel sign in one file, which a subsetted webfont does not.
 */
function loadFonts(): { regular: Buffer; bold: Buffer } {
  return {
    regular: readFileSync(resolve(FONT_DIR, 'DejaVuSans.ttf')),
    bold: readFileSync(resolve(FONT_DIR, 'DejaVuSans-Bold.ttf')),
  };
}

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 48;
const CONTENT_WIDTH = A4.width - MARGIN * 2;

const INK = rgb(0.07, 0.1, 0.09);
const MUTED = rgb(0.4, 0.47, 0.44);
const ACCENT = rgb(0.05, 0.43, 0.39);
const LINE = rgb(0.83, 0.86, 0.84);
const CRIT = rgb(0.64, 0.17, 0.17);
const WARN = rgb(0.54, 0.38, 0);
const GOOD = rgb(0.11, 0.45, 0.28);

const SEVERITY: Record<CheckSeverity, { label: string; color: RGB }> = {
  blocking: { label: 'חוסם', color: CRIT },
  required: { label: 'נדרש', color: WARN },
  advised: { label: 'מומלץ', color: MUTED },
};

interface Cursor {
  page: PDFPage;
  y: number;
  pageNumber: number;
}

/** Everything is right-aligned, so x is measured from the right margin inward. */
class Writer {
  private cursor: Cursor;
  private readonly pages: PDFPage[] = [];

  constructor(
    private readonly doc: PDFDocument,
    private readonly regular: PDFFont,
    private readonly bold: PDFFont,
  ) {
    this.cursor = this.newPage();
  }

  private newPage(): Cursor {
    const page = this.doc.addPage([A4.width, A4.height]);
    this.pages.push(page);
    return { page, y: A4.height - MARGIN, pageNumber: this.pages.length };
  }

  get y(): number {
    return this.cursor.y;
  }

  /** Reserve vertical space, starting a new page when the block would not fit. */
  need(height: number): void {
    if (this.cursor.y - height < MARGIN + 28) this.cursor = this.newPage();
  }

  space(h: number): void {
    this.cursor.y -= h;
  }

  private font(weight: 'regular' | 'bold'): PDFFont {
    return weight === 'bold' ? this.bold : this.regular;
  }

  /** Draw one line of right-aligned text. `maxWidth` limits where the right edge sits. */
  line(
    text: string,
    options: { size?: number; weight?: 'regular' | 'bold'; color?: RGB; indent?: number; maxWidth?: number } = {},
  ): void {
    const { size = 10, weight = 'regular', color = INK, indent = 0, maxWidth = CONTENT_WIDTH } = options;
    const font = this.font(weight);
    const visual = forPdf(text);
    const width = Math.min(font.widthOfTextAtSize(visual, size), maxWidth);
    const right = A4.width - MARGIN - indent;
    this.need(size * 1.5);
    this.cursor.page.drawText(visual, {
      x: right - width,
      y: this.cursor.y - size,
      size,
      font,
      color,
      maxWidth,
    });
    this.cursor.y -= size * 1.5;
  }

  /** Wrap a paragraph to the content width, measuring in the font that will draw it. */
  paragraph(text: string, { size = 8.5, color = MUTED, width = CONTENT_WIDTH } = {}): void {
    const font = this.font('regular');
    const words = text.split(/\s+/).filter(Boolean);
    let current = '';
    const lines: string[] = [];

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(forPdf(candidate), size) > width && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);

    for (const l of lines) this.line(l, { size, color, maxWidth: width });
  }

  /**
   * A label/value row: label on the right, value on the left, a dotted leader between.
   * The value is drawn from the left edge so columns of figures line up.
   */
  row(label: string, value: string, { size = 9.5 } = {}): void {
    this.need(size * 1.6);
    const font = this.regular;
    const y = this.cursor.y - size;

    const labelVisual = forPdf(label);
    const valueVisual = forPdf(value);
    const labelWidth = font.widthOfTextAtSize(labelVisual, size);
    const valueWidth = font.widthOfTextAtSize(valueVisual, size);

    this.cursor.page.drawText(labelVisual, {
      x: A4.width - MARGIN - labelWidth,
      y,
      size,
      font,
      color: MUTED,
    });
    this.cursor.page.drawText(valueVisual, { x: MARGIN, y, size, font: this.bold, color: INK });

    const gapStart = MARGIN + valueWidth + 6;
    const gapEnd = A4.width - MARGIN - labelWidth - 6;
    if (gapEnd - gapStart > 12) {
      this.cursor.page.drawLine({
        start: { x: gapStart, y: y + 2 },
        end: { x: gapEnd, y: y + 2 },
        thickness: 0.4,
        color: LINE,
        dashArray: [1, 2],
      });
    }
    this.cursor.y -= size * 1.6;
  }

  rule(color = LINE): void {
    this.need(8);
    this.cursor.page.drawLine({
      start: { x: MARGIN, y: this.cursor.y },
      end: { x: A4.width - MARGIN, y: this.cursor.y },
      thickness: 0.7,
      color,
    });
    this.cursor.y -= 8;
  }

  sectionHeading(title: string): void {
    // Keep a heading with at least the first rows of its section.
    this.need(52);
    this.space(6);
    this.line(title, { size: 12, weight: 'bold', color: ACCENT });
    this.rule(ACCENT);
  }

  /** Page numbers are stamped last, once the total is known. */
  stampFooters(generatedAt: string): void {
    const total = this.pages.length;
    this.pages.forEach((page, i) => {
      const text = forPdf(`מפתח נכסים · הופק ${generatedAt} · עמוד ${i + 1} מתוך ${total}`);
      const width = this.regular.widthOfTextAtSize(text, 7.5);
      page.drawText(text, {
        x: A4.width - MARGIN - width,
        y: MARGIN - 16,
        size: 7.5,
        font: this.regular,
        color: MUTED,
      });
    });
  }
}

/** Render the report to PDF bytes. */
export async function renderReportPdf(report: PropertyReport): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fonts = loadFonts();
  const regular = await doc.embedFont(fonts.regular, { subset: true });
  const bold = await doc.embedFont(fonts.bold, { subset: true });

  doc.setTitle(report.title);
  doc.setSubject('דוח נכס — מידע כללי, אינו שומה ואינו ייעוץ');
  doc.setCreator('מפתח נכסים');

  const w = new Writer(doc, regular, bold);

  w.line(report.title, { size: 16, weight: 'bold' });
  w.line(report.subtitle, { size: 10, color: MUTED });
  w.line(`מסלול חישוב: ${report.profileLabel} · הופק ${report.generatedAt}`, { size: 9, color: MUTED });
  w.space(4);
  w.rule();

  if (report.flags.length > 0) {
    w.sectionHeading('דגלים');
    for (const f of report.flags) {
      const color = f.level === 'crit' ? CRIT : f.level === 'warn' ? WARN : GOOD;
      const mark = f.level === 'crit' ? '■' : f.level === 'warn' ? '▲' : '✓';
      w.paragraph(`${mark} ${f.text}`, { size: 9, color, width: CONTENT_WIDTH - 8 });
      w.space(1.5);
    }
  }

  for (const section of report.sections) {
    w.sectionHeading(section.title);
    for (const r of section.rows) w.row(r.label, r.value);
    if (section.note) {
      w.space(3);
      w.paragraph(section.note, { size: 8 });
    }
  }

  w.sectionHeading('מה נשאר לבדוק');
  w.paragraph(
    'הרשימה נגזרת ממה שהרשומה אומרת ומה שהיא לא אומרת. „לא בדקנו” מייצר פריט ולא שתיקה.',
    { size: 8.5 },
  );
  w.space(4);
  for (const item of report.checklist) {
    const { label, color } = SEVERITY[item.severity];
    w.need(40);
    w.line(`[${label}] ${item.title}`, { size: 9.5, weight: 'bold', color });
    w.paragraph(item.why, { size: 8.5, width: CONTENT_WIDTH - 12 });
    w.space(3);
  }

  w.space(6);
  w.sectionHeading('כתב ויתור');
  w.paragraph(report.disclaimer, { size: 7.5 });

  w.stampFooters(report.generatedAt);
  return doc.save();
}
