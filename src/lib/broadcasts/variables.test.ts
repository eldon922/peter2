import { describe, it, expect } from 'vitest';

import { bodyPlaceholderKeys, numberChanged, resolveVariables } from './variables';
import type { Contact } from '@/types';

const contact = {
  id: 'c-1',
  name: 'Jane',
  phone: '+1 415-555-0123',
  email: 'jane@example.com',
  company: 'Acme',
} as Contact;

describe('bodyPlaceholderKeys', () => {
  it('extracts keys in template order, deduplicated', () => {
    expect(bodyPlaceholderKeys('Hi {{1}}, code {{2}}. Bye {{1}}')).toEqual(['1', '2']);
  });

  it('returns nothing for a template with no placeholders', () => {
    expect(bodyPlaceholderKeys('Hi there')).toEqual([]);
  });

  it('tolerates null/undefined body text', () => {
    expect(bodyPlaceholderKeys(null)).toEqual([]);
    expect(bodyPlaceholderKeys(undefined)).toEqual([]);
  });

  it('ignores non-numeric braces', () => {
    expect(bodyPlaceholderKeys('Hi {{name}} and {{1}}')).toEqual(['1']);
  });
});

describe('resolveVariables', () => {
  it('orders numerically so {{2}} precedes {{10}}', () => {
    const params = resolveVariables(
      {
        '10': { type: 'static', value: 'ten' },
        '2': { type: 'static', value: 'two' },
      },
      contact
    );
    expect(params).toEqual(['two', 'ten']);
  });

  it('resolves built-in fields and custom fields', () => {
    const params = resolveVariables(
      {
        '1': { type: 'field', value: 'name' },
        '2': { type: 'custom_field', value: 'cf-1' },
      },
      contact,
      new Map([['cf-1', 'VIP']])
    );
    expect(params).toEqual(['Jane', 'VIP']);
  });

  it('yields an empty string for a missing custom value', () => {
    const params = resolveVariables(
      { '1': { type: 'custom_field', value: 'cf-missing' } },
      contact,
      new Map()
    );
    expect(params).toEqual(['']);
  });
});

describe('numberChanged', () => {
  it('is true when the contact was edited to a different number', () => {
    expect(
      numberChanged({
        phone_attempted: '14155550123',
        contact: { phone: '14155559999' },
      })
    ).toBe(true);
  });

  it('is false for a trunk-prefix variant of the same number', () => {
    // The send succeeded on a variant phoneVariants produced; that is
    // not an edit and must not raise the hint.
    expect(
      numberChanged({
        phone_attempted: '6281234567890',
        contact: { phone: '62081234567890' },
      })
    ).toBe(false);
  });

  it('is false when only the formatting differs', () => {
    expect(
      numberChanged({
        phone_attempted: '14155550123',
        contact: { phone: '+1 415-555-0123' },
      })
    ).toBe(false);
  });

  it('is false for a pre-migration row with no attempted number', () => {
    expect(
      numberChanged({ phone_attempted: null, contact: { phone: '14155550123' } })
    ).toBe(false);
  });

  it('is false — and does not throw — for a deleted contact', () => {
    expect(numberChanged({ phone_attempted: '14155550123', contact: null })).toBe(
      false
    );
    expect(numberChanged({ phone_attempted: '14155550123' })).toBe(false);
  });
});
