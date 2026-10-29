'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

export default function Loading() {
  const t = useTranslations('Activity');
  return (
    <div
      role="status"
      className="text-muted-foreground flex min-h-48 items-center justify-center gap-2 text-sm"
    >
      <Loader2 className="size-5 animate-spin" />
      {t('loading')}
    </div>
  );
}
