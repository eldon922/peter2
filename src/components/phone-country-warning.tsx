'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

export function PhoneCountryWarning() {
  const t = useTranslations('PhoneFormat');
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/whatsapp/phone-format', { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (data?.defaultCountryCode && !controller.signal.aborted) setCode(data.defaultCountryCode); })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return <p className="my-2 text-xs text-amber-700 dark:text-amber-300" role="note">
    {code ? t('warning', { code }) : t('fallback')}
  </p>;
}
