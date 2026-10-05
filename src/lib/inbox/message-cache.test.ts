import { beforeEach, describe, expect, it } from 'vitest';

import type { Message } from '@/types';
import {
  appendCachedMessage,
  clearMessageCache,
  getCachedMessages,
  setCachedMessages,
  updateCachedMessage,
} from './message-cache';

const msg = (id: string, text: string): Message =>
  ({ id, conversation_id: 'c1', content_text: text }) as Message;

beforeEach(() => clearMessageCache());

describe('message cache', () => {
  it('applies an edit to a cached message', () => {
    setCachedMessages('c1', [msg('m1', 'hello'), msg('m2', 'other')]);
    updateCachedMessage('c1', msg('m1', 'hello (edited)'));
    expect(getCachedMessages('c1')?.map((m) => m.content_text)).toEqual([
      'hello (edited)',
      'other',
    ]);
  });

  it('ignores updates and appends for threads that are not cached', () => {
    updateCachedMessage('c1', msg('m1', 'x'));
    appendCachedMessage('c1', msg('m1', 'x'));
    expect(getCachedMessages('c1')).toBeUndefined();
  });

  it('does not append the same message twice', () => {
    setCachedMessages('c1', [msg('m1', 'hi')]);
    appendCachedMessage('c1', msg('m1', 'hi'));
    expect(getCachedMessages('c1')).toHaveLength(1);
  });
});
