export const LOCALES = [
  { code: "en", label: "English" },
  { code: "id", label: "Bahasa Indonesia" },
  { code: "ko", label: "한국어" },
] as const;

export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isLocale(value: string | undefined): value is string {
  return LOCALES.some((l) => l.code === value);
}
