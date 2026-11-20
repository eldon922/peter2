import { utils, write } from '@e965/xlsx';
import { describe, expect, it } from 'vitest';
import { parseContactCsv, parseContactRows } from './parse-contact-csv';
import { readContactWorkbook } from './read-contact-workbook';

function contactWorkbook() {
  const book = utils.book_new();
  utils.book_append_sheet(book, utils.aoa_to_sheet([['Index']]), 'Readme');
  const contacts = utils.aoa_to_sheet([
    ['Phone', 'Name', 'Company', 'Tags', 'Score'],
    [812345678, 'Padded', 'Example', 'VIP, New', 0],
    [66810000000, 'Scientific'],
    [819876543, 'Formatted prefix'],
    [1234567890123456, 'Too long'],
    [],
    [12345.67, 'Decimal'],
    ['008188765432', 'Text'],
  ]);
  contacts.A2.z = '0000000000';
  contacts.A3.z = '0.0E+00';
  contacts.A4.z = '"+66 "000000000';
  utils.book_append_sheet(book, contacts, 'Contacts');
  return readContactWorkbook(write(book, { type: 'array', bookType: 'xlsx' }));
}

describe('Excel contact import', () => {
  it('reads the selected worksheet and uses the same columns and phone formatting as CSV', () => {
    const workbook = contactWorkbook();
    expect(workbook.sheetNames).toEqual(['Readme', 'Contacts']);
    expect(workbook.rowsFromSheet('Readme').records).toEqual([['Index']]);
    const { records } = workbook.rowsFromSheet('Contacts');
    expect(records.map((row) => row[0])).toEqual([
      'Phone',
      '0812345678',
      '66810000000',
      '+66 819876543',
      '',
      '',
      '008188765432',
    ]);
    const fields = [{ id: 'score', field_name: 'Score' }];
    expect(parseContactRows(records, fields, '66')).toEqual(
      parseContactCsv(
        [
          'Phone,Name,Company,Tags,Score',
          '0812345678,Padded,Example,"VIP, New",0',
          '66810000000,Scientific',
          '+66 819876543,Formatted prefix',
          '008188765432,Text',
        ].join('\n'),
        fields,
        '66'
      )
    );
  });

  it('reports potentially rounded and fractional numbers at their original row numbers', () => {
    const { invalidNumericPhones } =
      contactWorkbook().rowsFromSheet('Contacts');
    expect(invalidNumericPhones).toMatchObject([
      { row: 5, name: 'Too long' },
      { row: 7, name: 'Decimal' },
    ]);
  });

  it('rejects files renamed to XLSX from plain text', () => {
    const text = new TextEncoder().encode('phone,name\n+14155550123,Example');
    expect(() => readContactWorkbook(text.buffer)).toThrow('Invalid XLSX file');
  });
});
