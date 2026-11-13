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
it('does not count rotating Meta sample signatures as template edits', () => {
  expect(
    templateSyncChanged(
      {
        header_handle:
          'https://scontent.xx.fbcdn.net/media/image.jpg?oh=old&oe=1',
      },
      {
        header_handle:
          'https://scontent.xx.fbcdn.net/media/image.jpg?oh=new&oe=2',
      }
    )
  ).toBe(false);
  expect(
    templateSyncChanged(
      { header_handle: 'https://scontent.xx.fbcdn.net/media/old.jpg?a=1' },
      { header_handle: 'https://scontent.xx.fbcdn.net/media/new.jpg?a=2' }
    )
  ).toBe(true);
});
it('treats empty optional fields as absent', () => {
  expect(
    templateSyncChanged(
      { buttons: [], sample_values: {}, footer_text: '' },
      { buttons: null, sample_values: null, footer_text: null }
    )
  ).toBe(false);
});
