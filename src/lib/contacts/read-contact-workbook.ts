import { read, utils, type CellObject, type WorkSheet } from '@e965/xlsx';

interface ContactWorksheet {
  records: string[][];
  invalidNumericPhones: { row: number; phone: string; name?: string }[];
}

export interface ContactWorkbook {
  sheetNames: string[];
  rowsFromSheet: (name: string) => ContactWorksheet;
}

export function readContactWorkbook(bytes: ArrayBuffer): ContactWorkbook {
  // XLSX is a ZIP container. SheetJS can also read text and legacy Excel
  // formats, so reject those if a file was simply renamed to .xlsx.
  if (bytes.byteLength < 4 || new DataView(bytes).getUint32(0) !== 0x504b0304) {
    throw new Error('Invalid XLSX file');
  }
  const workbook = read(bytes, {
    type: 'array',
    cellHTML: false,
    cellFormula: false,
  });
  return {
    sheetNames: workbook.SheetNames,
    rowsFromSheet: (name) => readWorksheet(workbook.Sheets[name]),
  };
}

function readWorksheet(sheet: WorkSheet | undefined): ContactWorksheet {
  const rows = new Map<number, string[]>();
  const invalidNumericPhones: ContactWorksheet['invalidNumericPhones'] = [];
  if (!sheet) return { records: [], invalidNumericPhones };

  // Only visit populated cells. Excel often includes empty, formatted
  // rows or columns in the worksheet's declared range.
  for (const address of Object.keys(sheet)) {
    if (address.startsWith('!')) continue;
    const cell = sheet[address] as CellObject;
    if (cell.v == null || cell.t === 'e') continue;
    const text = utils.format_cell(cell);
    if (!text.trim()) continue;
    const { r, c } = utils.decode_cell(address);
    const values = rows.get(r) ?? [];
    values[c] = text;
    rows.set(r, values);
  }

  const entries = [...rows].sort(([a], [b]) => a - b);
  const headers = entries[0]?.[1].map((value) => value.trim().toLowerCase());
  const phoneColumn = headers?.indexOf('phone') ?? -1;
  const nameColumn = headers?.indexOf('name') ?? -1;
  if (phoneColumn >= 0) {
    for (const [r, values] of entries.slice(1)) {
      const cell = sheet[utils.encode_cell({ r, c: phoneColumn })] as
        CellObject | undefined;
      if (cell?.t !== 'n' || typeof cell.v !== 'number') continue;
      const value = cell.v;
      if (!Number.isSafeInteger(value) || value < 0 || value >= 1e15) {
        invalidNumericPhones.push({
          row: r + 1,
          phone: values[phoneColumn] ?? String(value),
          name: values[nameColumn]?.trim() || undefined,
        });
        values[phoneColumn] = '';
        continue;
      }

      const displayed = values[phoneColumn]?.trim() ?? '';
      const digits = String(value);
      const displayedDigits = displayed.replace(/\D/g, '');
      // Keep a meaningful display format, including a plus sign or
      // padded zeros. Recover the original digits from scientific notation.
      values[phoneColumn] =
        /^\+?[\d ().-]+$/.test(displayed) &&
        (displayedDigits.replace(/^0+(?=\d)/, '') === digits ||
          (displayed.startsWith('+') && displayedDigits.endsWith(digits)))
          ? displayed
          : digits;
    }
  }
  return { records: entries.map(([, values]) => values), invalidNumericPhones };
}
