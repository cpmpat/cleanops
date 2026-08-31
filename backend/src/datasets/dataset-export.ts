/**
 * Turning a dataset page into a file.
 *
 * Deliberately dumb: it is handed columns and rows that have *already* been
 * through the permission projection, and it has no idea what a role is. The
 * guarantee that an export never contains a column its reader may not see is
 * not enforced here — it is enforced by the fact that this module is only ever
 * called with the output of `DatasetsService.read()`, the same call that builds
 * the screen. There is no second query to drift out of step with the first.
 */

export interface ExportColumn {
  key: string;
  label: string;
}

/**
 * Stop a spreadsheet treating a value as a formula.
 *
 * A cell beginning `=`, `+` or `@` is executed on open, which turns any field
 * somebody can type into a way to run something on a colleague's machine. The
 * fix is a leading apostrophe, which both Excel and Sheets read as "this is
 * text" and do not display.
 *
 * `-` is deliberately left alone when the value is a number: prefixing -450
 * would corrupt a real figure to defend against a threat it does not carry.
 */
function defuse(v: string): string {
  if (!v) return v;
  const first = v[0];
  if (first === '=' || first === '+' || first === '@') return `'${v}`;
  if (first === '-' && !Number.isFinite(Number(v.replace(',', '.')))) return `'${v}`;
  return v;
}

/**
 * CSV, with a UTF-8 byte-order mark.
 *
 * The BOM is not decoration. Without it Excel reads the file as the system
 * legacy encoding and every Czech name comes out as mojibake — Hodinová
 * becomes HodinovÃ¡ — which reads as "the export is broken" rather than "Excel
 * guessed wrong". Comma-separated, because that is what every other tool
 * expects; anyone opening this in Czech Excel should take the .xlsx instead.
 */
export function toCsv(columns: ExportColumn[], rows: string[][]): Buffer {
  const cell = (v: string | undefined): string => {
    const s = defuse(v ?? '');
    // Quote when the value could otherwise break the row apart. Embedded
    // quotes are doubled, which is the one escaping rule CSV actually has.
    return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [
    columns.map((c) => cell(c.label)).join(','),
    ...rows.map((r) => r.map(cell).join(',')),
  ];

  return Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(lines.join('\r\n'), 'utf8'),
  ]);
}

/**
 * XLSX, with the header frozen and columns sized to their content.
 *
 * Every cell is written as a string on purpose. The values arriving here have
 * already been rendered for display, and letting Excel re-guess their types is
 * how `ID: 2130` becomes a date and a lockbox code loses its leading zero.
 */
export async function toXlsx(
  columns: ExportColumn[],
  rows: string[][],
  sheetName: string,
): Promise<Buffer> {
  // Required at call time: exceljs is a heavy import and most requests to this
  // service never export anything.
  const ExcelJS = await import('exceljs');

  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  // Excel refuses these characters in a sheet name and caps it at 31 chars.
  const ws = wb.addWorksheet(sheetName.replace(/[\\/*?:[\]]/g, '').slice(0, 31) || 'Data');

  ws.addRow(columns.map((c) => c.label));
  for (const r of rows) ws.addRow(columns.map((_, i) => defuse(r[i] ?? '')));

  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: Math.max(columns.length, 1) },
  };

  columns.forEach((c, i) => {
    let widest = c.label.length;
    for (const r of rows) widest = Math.max(widest, (r[i] ?? '').length);
    // Capped: one 400-character Booking.com URL should not make a column
    // wider than the screen.
    ws.getColumn(i + 1).width = Math.min(Math.max(widest + 2, 10), 48);
  });

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
