import { parsePhoneNumberFromString } from 'libphonenumber-js';
import data from './rates.json';

export type PriceCategory = 'Marketing' | 'Utility' | 'Authentication';
export function estimateBroadcastCost(
  phones: string[],
  category: PriceCategory,
  currency: string
) {
  const card = data.rates[currency as keyof typeof data.rates] as
    Record<string, Record<string, number>> | undefined;
  if (!card) throw new Error('No published rate card for this currency.');
  const field = category.toLowerCase();
  const maximum = phones.reduce((sum, number) => {
    const phone = parsePhoneNumberFromString(number);
    if (!phone?.country)
      throw new Error('Could not determine a recipient country.');
    const market =
      data.markets.find((market) => market.iso_codes.includes(phone.country!))
        ?.market ?? 'Other';
    const rate = card[market]?.[field];
    if (typeof rate !== 'number' || !Number.isFinite(rate))
      throw new Error('No published rate for this audience.');
    return sum + rate;
  }, 0);
  return deliveryCostRange(maximum, phones.length);
}
export function deliveryCostRange(maximum: number, count: number) {
  const delivered = Math.ceil((count * 9) / 10);
  return {
    minimum: count ? (maximum / count) * delivered : 0,
    maximum,
    delivered,
  };
}
export const pricingSource = {
  effective: data.effective_date,
  checked: data.checked_on,
  url: data.source,
};
