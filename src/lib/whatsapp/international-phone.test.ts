import { describe, expect, it } from 'vitest';
import { internationalPhone, normalizePhoneInput } from './international-phone';
import { toMetaPhone } from './phone-utils';

describe('international phone standardization', () => {
  it.each([
    '0812 3456-7890',
    '81234567890',
    '6281234567890',
    '+62 812-3456-7890',
    '006281234567890',
  ])('stores %s with a country code and plus', (input) => {
    expect(internationalPhone(input, '62')).toBe('+6281234567890');
  });
  it('uses the configured country code and preserves explicit foreign numbers', () => {
    expect(internationalPhone('07700 900123', '44')).toBe('+447700900123');
    expect(internationalPhone('+1 (415) 555-1212', '62')).toBe('+14155551212');
    expect(internationalPhone('010-1234-5678', '82')).toBe('+821012345678');
    expect(internationalPhone('0669833999', '39')).toBe('+390669833999');
  });
  it('retains conversion evidence after the phone has been standardized', () => {
    expect(normalizePhoneInput('081234567890', '62')).toEqual({
      phone: '+6281234567890',
      phone_conversion: { input: '081234567890', countryCode: '62' },
    });
    expect(
      normalizePhoneInput('+6281234567890', '62').phone_conversion
    ).toBeNull();
    expect(
      normalizePhoneInput('006281234567890', '62').phone_conversion
    ).toBeNull();
    expect(
      normalizePhoneInput('6281234567890', '62').phone_conversion
    ).toBeNull();
  });
  it('rejects empty or non-phone inputs and only removes plus at the Meta boundary', () => {
    expect(internationalPhone('')).toBe('');
    expect(internationalPhone('not a number')).toBe('');
    expect(toMetaPhone(internationalPhone('081234567890', '62'))).toBe(
      '6281234567890'
    );
  });
});
