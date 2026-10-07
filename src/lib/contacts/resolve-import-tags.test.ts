import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import {
  assignImportedContactTags,
  resolveImportTagIds,
} from './resolve-import-tags';

describe('resolveImportTagIds', () => {
  it('reads past the 1000-row response cap and does not recreate tags', async () => {
    const all = Array.from({ length: 2500 }, (_, i) => ({
      id: `id${i}`,
      name: `Tag ${i}`,
    }));
    const inserted: string[] = [];
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              range: (from: number, to: number) =>
                Promise.resolve({
                  data: all.slice(from, Math.min(to + 1, from + 1000)),
                  error: null,
                }),
            }),
          }),
        }),
        insert: (rows: { name: string }[]) => ({
          select: () => {
            inserted.push(...rows.map((r) => r.name));
            return Promise.resolve({
              data: rows.map((r) => ({ id: `new-${r.name}`, name: r.name })),
              error: null,
            });
          },
        }),
      }),
    } as unknown as SupabaseClient;

    const { tagIdByKey } = await resolveImportTagIds(db, {
      accountId: 'a',
      userId: 'u',
      tagNames: ['tag 2400', 'Brand New'],
      canCreateTags: true,
    });
    expect(inserted).toEqual(['Brand New']);
    expect(tagIdByKey.get('tag 2400')).toBe('id2400');
  });
});

describe('assignImportedContactTags', () => {
  it('counts only pairs that were really added', async () => {
    const db = {
      from: () => ({
        upsert: () => ({
          select: () => Promise.resolve({ data: [{ contact_id: 'c2' }], error: null }),
        }),
      }),
    } as unknown as SupabaseClient;

    const result = await assignImportedContactTags(
      db,
      [
        { contactId: 'c1', tagNames: ['vip'] },
        { contactId: 'c2', tagNames: ['new'] },
      ],
      new Map([
        ['vip', 't1'],
        ['new', 't2'],
      ])
    );
    expect(result.assigned).toBe(1);
    expect([...result.contactIds]).toEqual(['c2']);
  });

  it('reports contacts whose tags could not be saved', async () => {
    const db = {
      from: () => ({
        upsert: () => ({
          select: () =>
            Promise.resolve({ data: null, error: { message: 'boom' }, status: 400 }),
        }),
      }),
    } as unknown as SupabaseClient;

    const result = await assignImportedContactTags(
      db,
      [{ contactId: 'c1', tagNames: ['vip'] }],
      new Map([['vip', 't1']])
    );
    expect(result.assigned).toBe(0);
    expect(result.failed.get('c1')).toBe('boom');
  });
});
