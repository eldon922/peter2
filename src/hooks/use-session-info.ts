'use client';

import { useMemo } from 'react';
import { differenceInHours } from 'date-fns';
import { useTranslations } from 'next-intl';

import type { Message } from '@/types';

/** WhatsApp's 24-hour reply window, as a label ("5h remaining"). */
export function useSessionInfo(messages: Message[]) {
  const t = useTranslations('Inbox.sessionTimer');

  return useMemo(() => {
    if (!messages.length) return { expired: false, remaining: '' };

    const lastCustomerMsg = [...messages]
      .reverse()
      .find((m) => m.sender_type === 'customer');
    if (!lastCustomerMsg) {
      return { expired: true, remaining: t('noCustomerMessages') };
    }

    const hoursSince = differenceInHours(new Date(), new Date(lastCustomerMsg.created_at));
    if (hoursSince >= 24) return { expired: true, remaining: t('expired') };

    const hoursLeft = 24 - hoursSince;
    const remaining =
      hoursLeft >= 1
        ? t('xhRemaining', { hours: Math.floor(hoursLeft) })
        : t('xmRemaining', { minutes: Math.floor(hoursLeft * 60) });
    return { expired: false, remaining };
  }, [messages, t]);
}
