import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { TemplateButton, PhoneConversion } from '@/types';
import { DEFAULT_COUNTRY_CODE, normalizePhone } from './phone-utils';

export function internationalPhone(
  input: string,
  countryCode = DEFAULT_COUNTRY_CODE
): string {
  if (!input.trim() || /[a-z]/i.test(input)) return '';
  const digits = normalizePhone(input);
  const explicit = input.trim().startsWith('+') || digits.startsWith('00');
  const phone = parsePhoneNumberFromString(
    explicit ? `+${digits.replace(/^00/, '')}` : digits,
    { defaultCallingCode: countryCode }
  );
  if (explicit) return phone ? `+${digits.replace(/^00/, '')}` : '';
  return phone?.number ?? '';
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
