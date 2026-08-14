/**
 * Currency — single source of truth for deal-value formatting and
 * the currency picker options.
 *
 * Before this module, ~6 components each defined their own
 * `Intl.NumberFormat(..., { currency: "USD" })` helper with USD
 * baked in. The default currency is now configurable per account
 * (accounts.default_currency, migration 021), so every formatter
 * takes a currency and falls back to DEFAULT_CURRENCY only when
 * nothing is known.
 */

/** App-wide fallback when no account/deal currency is available. */
export const DEFAULT_CURRENCY = "USD";

export interface CurrencyOption {
  /** ISO-4217 code, e.g. "USD". Stored verbatim in the DB. */
  code: string;
  /** Human label for the dropdown, e.g. "US Dollar". */
  label: string;
  /** Symbol for compact display, e.g. "$". */
  symbol: string;
}

/**
 * The currencies offered in pickers — Meta's supported set, ordered by
 * code so the native `<select>`s stay scannable.
 *
 * Source: developers.facebook.com/docs/marketing-api/currencies, which
 * is the list Meta accepts across its business surfaces. Five entries
 * from that page are deliberately NOT here, because they would be
 * offered to someone choosing what to denominate a deal in:
 *
 *   FBZ           Facebook Credits — a retired virtual currency, not
 *                 ISO-4217 at all.
 *   LVL, LTL,     Withdrawn when Latvia, Lithuania and Slovakia
 *   SKK           adopted the euro.
 *   VEF           Superseded by VES, which is on the list.
 *
 * Everything kept is a code the runtime recognises
 * (`Intl.supportedValuesOf("currency")`), so `Intl.NumberFormat` renders
 * a real symbol and the right grouping — asserted by currency.test.ts.
 *
 * `symbol` is used only by {@link formatCurrencyShort}. Where a currency
 * has no distinct short symbol, it is the code plus a space ("CHF 1.2k"),
 * matching the unknown-currency fallback.
 */
export const CURRENCIES: CurrencyOption[] = [
  { code: "AED", label: "UAE Dirham", symbol: "د.إ" },
  { code: "ARS", label: "Argentine Peso", symbol: "$" },
  { code: "AUD", label: "Australian Dollar", symbol: "A$" },
  { code: "BDT", label: "Bangladeshi Taka", symbol: "৳" },
  { code: "BGN", label: "Bulgarian Lev", symbol: "BGN " },
  { code: "BHD", label: "Bahraini Dinar", symbol: "BHD " },
  { code: "BOB", label: "Bolivian Boliviano", symbol: "Bs" },
  { code: "BRL", label: "Brazilian Real", symbol: "R$" },
  { code: "CAD", label: "Canadian Dollar", symbol: "C$" },
  { code: "CHF", label: "Swiss Franc", symbol: "CHF " },
  { code: "CLP", label: "Chilean Peso", symbol: "$" },
  { code: "CNY", label: "Chinese Yuan", symbol: "¥" },
  { code: "COP", label: "Colombian Peso", symbol: "$" },
  { code: "CRC", label: "Costa Rican Colón", symbol: "₡" },
  { code: "CZK", label: "Czech Koruna", symbol: "Kč" },
  { code: "DKK", label: "Danish Krone", symbol: "kr" },
  { code: "DZD", label: "Algerian Dinar", symbol: "DZD " },
  { code: "EGP", label: "Egyptian Pound", symbol: "E£" },
  { code: "EUR", label: "Euro", symbol: "€" },
  { code: "GBP", label: "British Pound", symbol: "£" },
  { code: "GTQ", label: "Guatemalan Quetzal", symbol: "Q" },
  { code: "HKD", label: "Hong Kong Dollar", symbol: "$" },
  { code: "HNL", label: "Honduran Lempira", symbol: "L" },
  { code: "HRK", label: "Croatian Kuna", symbol: "kn" },
  { code: "HUF", label: "Hungarian Forint", symbol: "Ft" },
  { code: "IDR", label: "Indonesian Rupiah", symbol: "Rp" },
  { code: "ILS", label: "Israeli New Shekel", symbol: "₪" },
  { code: "INR", label: "Indian Rupee", symbol: "₹" },
  { code: "ISK", label: "Icelandic Króna", symbol: "kr" },
  { code: "JOD", label: "Jordanian Dinar", symbol: "JOD " },
  { code: "JPY", label: "Japanese Yen", symbol: "¥" },
  { code: "KES", label: "Kenyan Shilling", symbol: "KES " },
  { code: "KRW", label: "South Korean Won", symbol: "₩" },
  { code: "MOP", label: "Macanese Pataca", symbol: "MOP " },
  { code: "MXN", label: "Mexican Peso", symbol: "$" },
  { code: "MYR", label: "Malaysian Ringgit", symbol: "RM" },
  { code: "NGN", label: "Nigerian Naira", symbol: "₦" },
  { code: "NIO", label: "Nicaraguan Córdoba", symbol: "C$" },
  { code: "NOK", label: "Norwegian Krone", symbol: "kr" },
  { code: "NZD", label: "New Zealand Dollar", symbol: "$" },
  { code: "PEN", label: "Peruvian Sol", symbol: "PEN " },
  { code: "PHP", label: "Philippine Peso", symbol: "₱" },
  { code: "PKR", label: "Pakistani Rupee", symbol: "Rs" },
  { code: "PLN", label: "Polish Zloty", symbol: "zł" },
  { code: "PYG", label: "Paraguayan Guarani", symbol: "₲" },
  { code: "QAR", label: "Qatari Riyal", symbol: "QAR " },
  { code: "RON", label: "Romanian Leu", symbol: "lei" },
  { code: "RSD", label: "Serbian Dinar", symbol: "RSD " },
  { code: "RUB", label: "Russian Ruble", symbol: "₽" },
  { code: "SAR", label: "Saudi Riyal", symbol: "SAR " },
  { code: "SEK", label: "Swedish Krona", symbol: "kr" },
  { code: "SGD", label: "Singapore Dollar", symbol: "S$" },
  { code: "THB", label: "Thai Baht", symbol: "฿" },
  { code: "TRY", label: "Turkish Lira", symbol: "₺" },
  { code: "TWD", label: "New Taiwan Dollar", symbol: "$" },
  { code: "UAH", label: "Ukrainian Hryvnia", symbol: "₴" },
  { code: "USD", label: "US Dollar", symbol: "$" },
  { code: "UYU", label: "Uruguayan Peso", symbol: "$" },
  { code: "VES", label: "Venezuelan Bolívar", symbol: "VES " },
  { code: "VND", label: "Vietnamese Dong", symbol: "₫" },
  { code: "ZAR", label: "South African Rand", symbol: "R" },
];

/**
 * Format a deal value as a currency string. Whole-number output
 * (no minor units) — deal values are tracked to the dollar across
 * the app. `currency` defaults to USD so callers with nothing better
 * stay safe, but pass the account/deal currency wherever known.
 *
 * Total by design: `Intl.NumberFormat` throws a RangeError on a
 * structurally invalid currency code, and `deals.currency` carries
 * NO DB CHECK (only `accounts.default_currency` does), so legacy
 * rows, imports, or hand-edited data can hold malformed values like
 * "United States". We never let that crash a render — on a bad code
 * we fall back to "CODE 1,234".
 */
export function formatCurrency(
  value: number,
  currency: string = DEFAULT_CURRENCY,
): string {
  const code = (currency || DEFAULT_CURRENCY).trim();
  const amount = Number(value) || 0;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    // Invalid ISO code — show the raw code + grouped number so the
    // value is still legible instead of throwing.
    return `${code} ${new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 0,
    }).format(amount)}`;
  }
}

/**
 * Compact currency for tight spaces (donut center, legend rows):
 * "$1.2M" / "€34.5k" / "₹900". Uses the currency's symbol from
 * CURRENCIES, falling back to the code when we don't carry a symbol.
 */
export function formatCurrencyShort(
  value: number,
  currency: string = DEFAULT_CURRENCY,
): string {
  const code = currency || DEFAULT_CURRENCY;
  const symbol = CURRENCIES.find((c) => c.code === code)?.symbol ?? `${code} `;
  return `${symbol}${formatCompactNumber(value)}`;
}

/**
 * Compact number for tight spaces (chart tiles, legends): 1_234 → "1.2k",
 * 1_200_000 → "1.2M", 900 → "900". The unit-less core shared with
 * {@link formatCurrencyShort}.
 */
export function formatCompactNumber(value: number): string {
  const v = Number(value || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return v.toFixed(0);
}
