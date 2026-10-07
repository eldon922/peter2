import { describe, expect, it } from 'vitest';
import { parseContactCsv, parseTagCell } from './parse-contact-csv';

describe('parseTagCell', () => {
  it('splits comma-separated tags and trims whitespace', () => {
    expect(parseTagCell(' VIP , Lead ,  ')).toEqual(['VIP', 'Lead']);
  });

  it('splits semicolon-separated tags', () => {
    expect(parseTagCell('VIP; Lead; Customer')).toEqual([
      'VIP',
      'Lead',
      'Customer',
    ]);
  });

  it('de-dupes case-insensitively', () => {
    expect(parseTagCell('vip, VIP, Lead')).toEqual(['vip', 'Lead']);
  });

  it('returns empty for blank values', () => {
    expect(parseTagCell('')).toEqual([]);
    expect(parseTagCell(undefined)).toEqual([]);
  });
});

describe('parseContactCsv', () => {
  it('parses optional tags column', () => {
    const csv = `phone,name,tags
+15551234567,Alice,"VIP, Lead"
+15559876543,Bob,Customer`;

    expect(parseContactCsv(csv)).toEqual({
      hasTagsColumn: true,
      hasCompanyColumn: false,
      rows: [
        {
          phone: '+15551234567',
          name: 'Alice',
          email: undefined,
          company: undefined,
          tagNames: ['VIP', 'Lead'],
        },
        {
          phone: '+15559876543',
          name: 'Bob',
          email: undefined,
          company: undefined,
          tagNames: ['Customer'],
        },
      ],
    });
  });

  it('returns empty tagNames when tags column is absent', () => {
    const csv = `phone,name
+15551234567,Alice`;

    expect(parseContactCsv(csv)).toEqual({
      hasTagsColumn: false,
      hasCompanyColumn: false,
      rows: [
        {
          phone: '+15551234567',
          name: 'Alice',
          email: undefined,
          company: undefined,
          tagNames: [],
        },
      ],
    });
  });

  it('keeps apostrophes in names', () => {
    const { rows } = parseContactCsv(`phone,name\n+15551234567,O'Brien`);
    expect(rows[0].name).toBe("O'Brien");
  });

  it('handles line breaks and escaped quotes inside quoted cells', () => {
    const csv = 'phone,name,tags\r\n+1555,"Line\none ""Q""","a,b"\r\n+1556,Bob,c\r\n';
    const { rows } = parseContactCsv(csv);
    expect(rows.map((r) => [r.phone, r.name, r.tagNames])).toEqual([
      ['+1555', 'Line\none "Q"', ['a', 'b']],
      ['+1556', 'Bob', ['c']],
    ]);
  });

  it('reads a BOM-prefixed file with thousands of rows', () => {
    let csv = '\uFEFFphone,name,tags\n';
    for (let i = 0; i < 5000; i++) csv += `+62811${i},N${i},"t${i % 9},t${i % 4}"\n`;
    const { rows } = parseContactCsv(csv);
    expect(rows).toHaveLength(5000);
    expect(rows[4999].tagNames).toEqual(['t4', 't3']);
  });
});
