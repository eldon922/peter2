export async function fetchDefaultCountryCode(
  signal?: AbortSignal
): Promise<string> {
  const response = await fetch('/api/whatsapp/phone-format', { signal });
  if (!response.ok) throw new Error('Could not load phone formatting');
  const data = await response.json();
  if (
    typeof data.defaultCountryCode !== 'string' ||
    !/^\d{1,3}$/.test(data.defaultCountryCode)
  )
    throw new Error('Invalid default country code');
  return data.defaultCountryCode;
}
