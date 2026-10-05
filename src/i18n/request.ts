import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { isLocale, LOCALE_COOKIE } from './locales';

export default getRequestConfig(async () => {
  // The user's pick (cookie) wins, then the deployment default, then 'en'
  const saved = (await cookies()).get(LOCALE_COOKIE)?.value;
  const fallback = process.env.NEXT_PUBLIC_APP_LOCALE;
  const locale = isLocale(saved) ? saved : isLocale(fallback) ? fallback : 'en';

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
