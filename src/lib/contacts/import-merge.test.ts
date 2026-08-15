import { describe, expect, it } from 'vitest';
import { planContactImport, type ExistingContact } from './import-merge';
import type { ParsedContactRow } from './parse-contact-csv';

function row(
  phone: string,
  name?: string,
  tagNames: string[] = []
): ParsedContactRow {
  return { phone, name, tagNames };
}

function existing(
  entries: [string, ExistingContact][]
): Map<string, ExistingContact> {
  return new Map(entries);
}

describe('planContactImport', () => {
  it('inserts numbers the account has never seen', () => {
    const plan = planContactImport([row('+15551234567', 'Ann')], existing([]));
    expect(plan.toInsert).toHaveLength(1);
    expect(plan.toMerge).toEqual([]);
    expect(plan.duplicates).toBe(0);
  });

  it('merges a known number that brings new tags', () => {
    const plan = planContactImport(
      [row('+15551234567', '', ['vip'])],
      existing([['15551234567', { id: 'c1', name: 'Ann' }]])
    );
    expect(plan.toInsert).toEqual([]);
    expect(plan.toMerge).toHaveLength(1);
    expect(plan.toMerge[0].id).toBe('c1');
    // No name in the file — the stored one stands.
    expect(plan.toMerge[0].rename).toBeNull();
  });

  it('renames when the file carries a different name', () => {
    const plan = planContactImport(
      [row('+15551234567', 'Ann Smith')],
      existing([['15551234567', { id: 'c1', name: 'Ann' }]])
    );
    expect(plan.toMerge[0].rename).toBe('Ann Smith');
  });

  it('never blanks a stored name from an empty cell', () => {
    // The one outcome an import must not produce: a phone-only re-export
    // wiping names filled in since the first import.
    for (const empty of [undefined, '', '   ']) {
      const plan = planContactImport(
        [row('+15551234567', empty)],
        existing([['15551234567', { id: 'c1', name: 'Ann' }]])
      );
      expect(plan.toMerge).toEqual([]);
      expect(plan.duplicates).toBe(1);
    }
  });

  it('fills a name that was never set', () => {
    const plan = planContactImport(
      [row('+15551234567', 'Ann')],
      existing([['15551234567', { id: 'c1', name: null }]])
    );
    expect(plan.toMerge[0].rename).toBe('Ann');
  });

  it('does not count an identical name as a rename', () => {
    const plan = planContactImport(
      [row('+15551234567', 'Ann')],
      existing([['15551234567', { id: 'c1', name: 'Ann' }]])
    );
    expect(plan.toMerge).toEqual([]);
    expect(plan.duplicates).toBe(1);
  });

  it('ignores surrounding whitespace when comparing names', () => {
    const plan = planContactImport(
      [row('+15551234567', '  Ann  ')],
      existing([['15551234567', { id: 'c1', name: 'Ann' }]])
    );
    expect(plan.duplicates).toBe(1);
  });

  it('trims the name it stores', () => {
    const plan = planContactImport(
      [row('+15551234567', '  Ann Smith  ')],
      existing([['15551234567', { id: 'c1', name: 'Ann' }]])
    );
    expect(plan.toMerge[0].rename).toBe('Ann Smith');
  });

  it('merges on a rename and tags together', () => {
    const plan = planContactImport(
      [row('+15551234567', 'Ann Smith', ['vip'])],
      existing([['15551234567', { id: 'c1', name: 'Ann' }]])
    );
    expect(plan.toMerge).toHaveLength(1);
    expect(plan.toMerge[0].rename).toBe('Ann Smith');
    expect(plan.toMerge[0].row.tagNames).toEqual(['vip']);
  });

  it('matches on the normalized number, not the written form', () => {
    // The stored key comes from the generated phone_normalized column, so
    // "+1 (555) 123-4567" and "15551234567" are the same contact.
    const plan = planContactImport(
      [row('+1 (555) 123-4567', 'Ann Smith')],
      existing([['15551234567', { id: 'c1', name: 'Ann' }]])
    );
    expect(plan.toInsert).toEqual([]);
    expect(plan.toMerge[0].id).toBe('c1');
  });

  it('handles a mixed file in one pass', () => {
    const plan = planContactImport(
      [
        row('+15550000001', 'New Person'),
        row('+15551234567', '', ['vip']),
        row('+15559999999', 'Ann'),
      ],
      existing([
        ['15551234567', { id: 'c1', name: 'Ann' }],
        ['15559999999', { id: 'c2', name: 'Ann' }],
      ])
    );
    expect(plan.toInsert).toHaveLength(1);
    expect(plan.toMerge).toHaveLength(1);
    expect(plan.duplicates).toBe(1);
  });
});
