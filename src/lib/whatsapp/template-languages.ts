// ============================================================
// WhatsApp message-template languages.
//
// Meta accepts a fixed set of locale codes when creating a template;
// anything outside it is rejected at submission with an unhelpful
// error. The template form previously offered nineteen hand-picked
// "common" codes as datalist hints, which meant anyone needing one of
// the other sixty-odd had to already know the exact string — and a
// typo only surfaced after a round trip to Meta.
//
// This is Meta's full published list, code + English label, ordered by
// label so the picker reads alphabetically.
//
// Source: WhatsApp Business Cloud API → Message Templates →
//   Supported Languages.
//   https://developers.facebook.com/docs/whatsapp/api/messages/message-templates
//
// Note the codes are not all plain BCP-47: Meta uses `_` (not `-`) as
// the region separator, and a handful of entries are region-only
// (`pt_BR`) or script-qualified (`zh_CN`). Keep them verbatim.
// ============================================================

export interface TemplateLanguage {
  /** Meta's locale code, e.g. `en_US`. Sent verbatim. */
  code: string;
  /** English display label, e.g. "English (US)". */
  label: string;
}

export const TEMPLATE_LANGUAGES: readonly TemplateLanguage[] = [
  { code: 'af', label: 'Afrikaans' },
  { code: 'sq', label: 'Albanian' },
  { code: 'ar', label: 'Arabic' },
  { code: 'az', label: 'Azerbaijani' },
  { code: 'bn', label: 'Bengali' },
  { code: 'bg', label: 'Bulgarian' },
  { code: 'ca', label: 'Catalan' },
  { code: 'zh_CN', label: 'Chinese (CHN)' },
  { code: 'zh_HK', label: 'Chinese (HKG)' },
  { code: 'zh_TW', label: 'Chinese (TAI)' },
  { code: 'hr', label: 'Croatian' },
  { code: 'cs', label: 'Czech' },
  { code: 'da', label: 'Danish' },
  { code: 'nl', label: 'Dutch' },
  { code: 'en', label: 'English' },
  { code: 'en_GB', label: 'English (UK)' },
  { code: 'en_US', label: 'English (US)' },
  { code: 'et', label: 'Estonian' },
  { code: 'fil', label: 'Filipino' },
  { code: 'fi', label: 'Finnish' },
  { code: 'fr', label: 'French' },
  { code: 'ka', label: 'Georgian' },
  { code: 'de', label: 'German' },
  { code: 'el', label: 'Greek' },
  { code: 'gu', label: 'Gujarati' },
  { code: 'ha', label: 'Hausa' },
  { code: 'he', label: 'Hebrew' },
  { code: 'hi', label: 'Hindi' },
  { code: 'hu', label: 'Hungarian' },
  { code: 'id', label: 'Indonesian' },
  { code: 'ga', label: 'Irish' },
  { code: 'it', label: 'Italian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'kn', label: 'Kannada' },
  { code: 'kk', label: 'Kazakh' },
  { code: 'rw_RW', label: 'Kinyarwanda' },
  { code: 'ko', label: 'Korean' },
  { code: 'ky_KG', label: 'Kyrgyz (Kyrgyzstan)' },
  { code: 'lo', label: 'Lao' },
  { code: 'lv', label: 'Latvian' },
  { code: 'lt', label: 'Lithuanian' },
  { code: 'mk', label: 'Macedonian' },
  { code: 'ms', label: 'Malay' },
  { code: 'ml', label: 'Malayalam' },
  { code: 'mr', label: 'Marathi' },
  { code: 'nb', label: 'Norwegian' },
  { code: 'fa', label: 'Persian' },
  { code: 'pl', label: 'Polish' },
  { code: 'pt_BR', label: 'Portuguese (BR)' },
  { code: 'pt_PT', label: 'Portuguese (POR)' },
  { code: 'pa', label: 'Punjabi' },
  { code: 'ro', label: 'Romanian' },
  { code: 'ru', label: 'Russian' },
  { code: 'sr', label: 'Serbian' },
  { code: 'sk', label: 'Slovak' },
  { code: 'sl', label: 'Slovenian' },
  { code: 'es', label: 'Spanish' },
  { code: 'es_AR', label: 'Spanish (ARG)' },
  { code: 'es_ES', label: 'Spanish (SPA)' },
  { code: 'es_MX', label: 'Spanish (MEX)' },
  { code: 'sw', label: 'Swahili' },
  { code: 'sv', label: 'Swedish' },
  { code: 'ta', label: 'Tamil' },
  { code: 'te', label: 'Telugu' },
  { code: 'th', label: 'Thai' },
  { code: 'tr', label: 'Turkish' },
  { code: 'uk', label: 'Ukrainian' },
  { code: 'ur', label: 'Urdu' },
  { code: 'uz', label: 'Uzbek' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'zu', label: 'Zulu' },
] as const;

const BY_CODE = new Map(TEMPLATE_LANGUAGES.map((l) => [l.code, l]));

/** True when Meta will accept `code` as a template language. */
export function isSupportedTemplateLanguage(code: string): boolean {
  return BY_CODE.has(code);
}

/**
 * Display label for a code, falling back to the raw code. Templates
 * synced from Meta can carry a code we don't have a label for (Meta
 * adds locales over time), and showing the code beats showing nothing.
 */
export function templateLanguageLabel(code: string): string {
  return BY_CODE.get(code)?.label ?? code;
}
