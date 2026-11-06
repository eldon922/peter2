'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Info } from 'lucide-react';

export function PhoneCountryWarning() {
  const t = useTranslations('PhoneFormat');
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/whatsapp/phone-format', { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data?.defaultCountryCode && !controller.signal.aborted)
          setCode(data.defaultCountryCode);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return (
    <div
      className="text-muted-foreground flex items-start gap-2 text-xs leading-relaxed"
      role="note"
    >
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <p>{code ? t('warning', { code }) : t('fallback')}</p>
    </div>
  );
}
