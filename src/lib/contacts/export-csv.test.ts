import { expect, it } from 'vitest';
import { contactsCsv } from './export-csv';
import { parseContactCsv } from './parse-contact-csv';
import type { Contact } from '@/types';

it('exports every tag and round-trips quoted names and untagged contacts', () => {
  const contacts = [
    { id: '1', phone: '+628123456789', name: 'A, "B"\nC', email: 'a@example.com' },
    { id: '2', phone: '+628987654321', name: '이름' },
  ] as Contact[];
  const { rows } = parseContactCsv(contactsCsv(contacts, new Map([['1', ['Customer', 'VIP']]])));
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ name: 'A, "B"\nC', tagNames: ['Customer', 'VIP'] });
  expect(rows[1]).toMatchObject({ name: '이름', tagNames: [] });
});
