/**
 * CSV parsing for the contacts import modal. Shared + unit-tested so
 * tag-column handling stays aligned with phone/name/email/company.
 */

export interface ParsedContactRow {
  phone: string;
  name?: string;
  email?: string;
  company?: string;
  /** Tag names from the optional `tags` column (comma/semicolon separated). */
  tagNames: string[];
}

/** Split a CSV cell into unique tag names (case-insensitive de-dupe). */
export function parseTagCell(value: string | undefined): string[] {
  if (!value?.trim()) return [];

  const seen = new Set<string>();
  const names: string[] = [];

  for (const part of value.split(/[,;]/)) {
    const name = part.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  return names;
}

export interface ParseContactCsvResult {
  rows: ParsedContactRow[];
  /** True when the CSV header includes a `tags` column. */
  hasTagsColumn: boolean;
  /** True when the CSV header includes a `company` column. */
  hasCompanyColumn: boolean;
}

export function parseContactCsv(text: string): ParseContactCsvResult {
  const records = parseCsv(text);
  const empty = { rows: [], hasTagsColumn: false, hasCompanyColumn: false };
  if (records.length < 2) return empty;

  const headers = records[0].map((h) => h.trim().toLowerCase());
  const phoneIdx = headers.indexOf('phone');
  if (phoneIdx === -1) return empty;

  const nameIdx = headers.indexOf('name');
  const emailIdx = headers.indexOf('email');
  const companyIdx = headers.indexOf('company');
  const tagsIdx = headers.indexOf('tags');

  const cell = (values: string[], idx: number) =>
    idx >= 0 ? values[idx]?.trim() || undefined : undefined;

  const rows: ParsedContactRow[] = [];

  for (let i = 1; i < records.length; i++) {
    const values = records[i];
    const phone = cell(values, phoneIdx);
    if (!phone) continue;

    rows.push({
      phone,
      name: cell(values, nameIdx),
      email: cell(values, emailIdx),
      company: cell(values, companyIdx),
      tagNames: tagsIdx >= 0 ? parseTagCell(values[tagsIdx]) : [],
    });
  }

  return {
    rows,
    hasTagsColumn: tagsIdx >= 0,
    hasCompanyColumn: companyIdx >= 0,
  };
}

/** CSV parse: quoted fields, "" escapes and line breaks inside quotes. */
function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;

  const endRecord = () => {
    record.push(field);
    field = '';
    if (record.length > 1 || record[0].trim()) records.push(record);
    record = [];
  };

  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const char = src[i];
    if (inQuotes) {
      if (char !== '"') field += char;
      else if (src[i + 1] === '"') {
        field += '"';
        i++;
      } else inQuotes = false;
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      record.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && src[i + 1] === '\n') i++;
      endRecord();
    } else {
      field += char;
    }
  }
  endRecord();
  return records;
}
