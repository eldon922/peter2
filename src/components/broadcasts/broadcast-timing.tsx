'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Broadcast } from '@/types';
import { durationParts } from '@/lib/broadcasts/duration';

function useClock(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export function BroadcastDuration({ broadcast }: { broadcast: Broadcast }) {
  const t = useTranslations('Broadcasts.timing');
  const now = useClock(broadcast.status === 'sending');
  if (!broadcast.started_at) return null;
  const elapsed = (broadcast.completed_at ? Date.parse(broadcast.completed_at) : now) - Date.parse(broadcast.started_at);
  const parts = durationParts(elapsed);
  return <span className="block text-xs font-normal tabular-nums text-muted-foreground" suppressHydrationWarning>
    {t('duration')}: {parts.days ? t('days', { days: parts.days, time: parts.time }) : parts.time}
  </span>;
}
