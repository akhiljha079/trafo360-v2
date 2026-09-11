import { PDFDocument, PDFFont, StandardFonts, rgb } from "pdf-lib";
import ExcelJS from "exceljs";
import type { ReportResult } from "./reports.service";

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv({ columns, rows }: ReportResult): string {
  const header = columns.map((c) => csvCell(c.label)).join(",");
  const lines = rows.map((row) => columns.map((c) => csvCell(row[c.key] ?? "")).join(","));
  return [header, ...lines].join("\r\n");
}

export async function toExcelBuffer({ title, columns, rows }: ReportResult): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(title.slice(0, 31));
  sheet.columns = columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(c.label.length + 4, 14) }));
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) sheet.addRow(row);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

const PAGE_WIDTH = 841.89; // A4 landscape
const PAGE_HEIGHT = 595.28;
const MARGIN = 36;
const ROW_HEIGHT = 16;
const GUTTER = 14; // gap between columns, so long values never run into the next column
const BODY_SIZE = 8;

/** Truncates text with an ellipsis so it fits within maxWidth at the given
 * size - without this, a long cell (e.g. a document type name) draws
 * straight into the next column since pdf-lib has no cell clipping. */
function fitText(font: PDFFont, text: string, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = `${text.slice(0, mid)}…`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? "" : `${text.slice(0, lo)}…`;
}

/** Simple paginated table layout - no library support for auto-flowing
 * tables in pdf-lib, so pagination is done by hand: fixed column widths
 * proportional to label length, a new page whenever rows run out of
 * vertical space. Good enough for register-style reports; not meant to
 * replace a real reporting engine if per-report custom layouts are ever
 * needed. */
export async function toPdfBuffer({ title, columns, rows }: ReportResult): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  const usableWidth = PAGE_WIDTH - MARGIN * 2 - GUTTER * (columns.length - 1);
  const totalLabelLen = columns.reduce((sum, c) => sum + c.label.length, 0) || 1;
  const colWidths = columns.map((c) => (c.label.length / totalLabelLen) * usableWidth);

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const drawHeader = () => {
    page.drawText(title, { x: MARGIN, y, size: 14, font: boldFont, color: rgb(0, 0, 0) });
    y -= 24;
    let x = MARGIN;
    columns.forEach((c, i) => {
      page.drawText(fitText(font, c.label, 9, colWidths[i]), { x, y, size: 9, font: boldFont });
      x += colWidths[i] + GUTTER;
    });
    y -= 6;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
    y -= ROW_HEIGHT;
  };

  drawHeader();

  for (const row of rows) {
    if (y < MARGIN + ROW_HEIGHT) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
      drawHeader();
    }
    let x = MARGIN;
    columns.forEach((c, i) => {
      const text = fitText(font, String(row[c.key] ?? ""), BODY_SIZE, colWidths[i]);
      page.drawText(text, { x, y, size: BODY_SIZE, font });
      x += colWidths[i] + GUTTER;
    });
    y -= ROW_HEIGHT;
  }

  if (rows.length === 0) {
    page.drawText("No matching records.", { x: MARGIN, y, size: 9, font });
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
