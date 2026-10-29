import { expect, it } from 'vitest';
import { templateSyncChanged } from './template-sync';

it('ignores audit timestamps, syncing user and JSON object key order', () => {
  expect(
    templateSyncChanged(
      {
        id: '1',
        user_id: 'creator',
        updated_at: 'yesterday',
        buttons: [{ type: 'URL', text: 'Open' }],
      },
      {
        user_id: 'admin',
        updated_at: 'today',
        buttons: [{ text: 'Open', type: 'URL' }],
        footer_text: null,
      }
    )
  ).toBe(false);
});
it('detects status, content and removed-field changes', () => {
  expect(
    templateSyncChanged({ status: 'PENDING' }, { status: 'APPROVED' })
  ).toBe(true);
  expect(templateSyncChanged({ body_text: 'Hi' }, { body_text: 'Hello' })).toBe(
    true
  );
  expect(
    templateSyncChanged({ footer_text: 'Old' }, { footer_text: null })
  ).toBe(true);
});
it('ignores optional button values omitted by JSON serialization', () => {
  expect(
    templateSyncChanged(
      { buttons: [{ type: 'URL', text: 'Open', url: 'https://example.com' }] },
      {
        buttons: [
          {
            type: 'URL',
            text: 'Open',
            url: 'https://example.com',
            example: undefined,
          },
        ],
      }
    )
  ).toBe(false);
});
