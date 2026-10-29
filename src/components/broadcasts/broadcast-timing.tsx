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

export function ScheduledCountdown({ broadcast }: { broadcast: Broadcast }) {
  const t = useTranslations('Broadcasts.timing');
  const now = useClock(broadcast.status === 'scheduled');
  if (broadcast.status !== 'scheduled' || !broadcast.scheduled_at) return null;
  const remaining = Date.parse(broadcast.scheduled_at) - now;
  const parts = durationParts(remaining);
  return <span className="block text-xs font-normal tabular-nums text-blue-600 dark:text-blue-300" suppressHydrationWarning>
    {remaining <= 0 ? t('startingSoon') : t('startsIn', { time: parts.days ? t('days', { days: parts.days, time: parts.time }) : parts.time })}
  </span>;
}
