import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { TemplateButton, PhoneConversion } from '@/types';
import {
  DEFAULT_COUNTRY_CODE,
  normalizePhone,
  isValidE164,
} from './phone-utils';

export function internationalPhone(
  input: string,
  countryCode = DEFAULT_COUNTRY_CODE
): string {
  input = input
    .normalize('NFKC')
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .trim();
  if (
    !input ||
    !/^\+?[\d\s().-]+$/.test(input) ||
    !/^[1-9]\d{0,2}$/.test(countryCode)
  )
    return '';
  const digits = normalizePhone(input);
  const explicit = input.trim().startsWith('+') || digits.startsWith('00');
  const phone = parsePhoneNumberFromString(
    explicit ? `+${digits.replace(/^00/, '')}` : digits,
    { defaultCallingCode: countryCode, extract: false }
  );
  const result =
    explicit && phone ? `+${digits.replace(/^00/, '')}` : (phone?.number ?? '');
  return isValidE164(result) ? result : '';
}

export function normalizePhoneInput(
  input: string,
  countryCode = DEFAULT_COUNTRY_CODE
): { phone: string; phone_conversion: PhoneConversion | null } {
  const phone = internationalPhone(input, countryCode);
  const digits = normalizePhone(input);
  const assumed =
    phone &&
    !input.trim().startsWith('+') &&
    !digits.startsWith('00') &&
    phone !== `+${digits}`;
  return {
    phone,
    phone_conversion: assumed ? { input, countryCode } : null,
  };
}

export function normalizePhoneButtons(
  buttons: TemplateButton[]
): TemplateButton[] {
  return buttons.map((button) =>
    button.type === 'PHONE_NUMBER'
      ? { ...button, phone_number: internationalPhone(button.phone_number) }
      : button
  );
}
