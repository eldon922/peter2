import type { Contact } from '@/types';

export function contactsCsv(
  contacts: Contact[],
  tagsByContact: Map<string, string[]>
): string {
  const cell = (value: string | null | undefined) =>
    `"${(value ?? '').replace(/"/g, '""')}"`;
  return (
    '\uFEFF' +
    [
      ['phone', 'name', 'email', 'company', 'tags'],
      ...contacts.map((contact) => [
        contact.phone,
        contact.name,
        contact.email,
        contact.company,
        (tagsByContact.get(contact.id) ?? []).join(';'),
      ]),
    ]
      .map((row) => row.map(cell).join(','))
      .join('\r\n')
  );
}
