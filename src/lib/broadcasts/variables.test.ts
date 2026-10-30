import { describe, it, expect } from 'vitest';

import {
  bodyPlaceholderKeys,
  numberChanged,
  resolveVariables,
  resolveHeaderVariable,
  buttonVariables,
  resolveButtonVariables,
  HEADER_VARIABLE_KEY,
} from './variables';
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
    expect(bodyPlaceholderKeys('Hi {{1}}, code {{2}}. Bye {{1}}')).toEqual([
      '1',
      '2',
    ]);
  });

  it('returns nothing for a template with no placeholders', () => {
    expect(bodyPlaceholderKeys('Hi there')).toEqual([]);
  });

  it('tolerates null/undefined body text', () => {
    expect(bodyPlaceholderKeys(null)).toEqual([]);
    expect(bodyPlaceholderKeys(undefined)).toEqual([]);
  });

  it('recognizes named and positional keys', () => {
    expect(bodyPlaceholderKeys('Hi {{name}} and {{1}}')).toEqual(['1', 'name']);
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
      numberChanged({
        phone_attempted: null,
        contact: { phone: '14155550123' },
      })
    ).toBe(false);
  });

  it('is false — and does not throw — for a deleted contact', () => {
    expect(
      numberChanged({ phone_attempted: '14155550123', contact: null })
    ).toBe(false);
    expect(numberChanged({ phone_attempted: '14155550123' })).toBe(false);
  });
});

it('keeps header personalization separate from body parameters with the same name', () => {
  const mappings = {
    name: { type: 'static' as const, value: 'Body name' },
    [HEADER_VARIABLE_KEY]: { type: 'field' as const, value: 'name' },
  };
  expect(resolveVariables(mappings, contact)).toEqual(['Body name']);
  expect(resolveHeaderVariable(mappings, contact)).toBe('Jane');
  expect(resolveHeaderVariable({}, contact)).toBeUndefined();
});

it('resolves URL buttons separately from header/body placeholders and keeps template indexes', () => {
  const template = {
    buttons: [
      { type: 'QUICK_REPLY' as const, text: 'Help' },
      { type: 'URL' as const, text: 'Order', url: 'https://example.com/order/{{1}}' },
      { type: 'URL' as const, text: 'Invoice', url: 'https://example.com/invoice/{{1}}' },
      { type: 'URL' as const, text: 'Home', url: 'https://example.com/' },
    ],
  };
  expect(buttonVariables(template).map(({ key, index }) => [key, index])).toEqual([
    ['button:1', 1], ['button:2', 2],
  ]);
  const mappings = {
    '1': { type: 'field' as const, value: 'name' },
    [HEADER_VARIABLE_KEY]: { type: 'static' as const, value: 'Header' },
    'button:1': { type: 'custom_field' as const, value: 'order' },
    'button:2': { type: 'static' as const, value: 'invoice-123' },
  };
  expect(resolveVariables(mappings, contact)).toEqual(['Jane']);
  expect(resolveHeaderVariable(mappings, contact)).toBe('Header');
  expect(resolveButtonVariables(mappings, contact, new Map([['order', 'order-456']]))).toEqual({
    1: 'order-456', 2: 'invoice-123',
  });
});
