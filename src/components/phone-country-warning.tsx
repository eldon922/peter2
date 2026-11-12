'use client';

import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Info } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { fetchDefaultCountryCode } from '@/lib/whatsapp/phone-format';
import { normalizePhoneInput } from '@/lib/whatsapp/international-phone';
import type { PhoneConversion } from '@/types';
import { countConvertedAudiencePhones } from '@/lib/whatsapp/local-phones';
import type { ResolvedAudience } from '@/lib/broadcasts/audience';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export function PhoneCountryWarning({
  phone,
  conversion,
  resolved,
  broadcastId,
  recipientId,
  retry = false,
  tooltip = false,
}: {
  phone?: string;
  conversion?: PhoneConversion | null;
  resolved?: ResolvedAudience;
  broadcastId?: string;
  recipientId?: string;
  retry?: boolean;
  tooltip?: boolean;
}) {
  const t = useTranslations('PhoneFormat');
  const tooltipId = useId();
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const source =
    conversion ??
    phone ??
    resolved ??
    (broadcastId ? `${broadcastId}:${recipientId ?? ''}:${retry}` : null);
  const [result, setResult] = useState<{
    source: unknown;
    code: string;
    count: number;
  } | null>(null);
  useEffect(() => {
    if (
      !source ||
      (phone !== undefined && !conversion && /^\s*(\+|00)/.test(phone))
    )
      return;
    const controller = new AbortController();
    (async () => {
      const db = createClient();
      let count = phone
        ? 1
        : resolved
          ? await countConvertedAudiencePhones(db, resolved)
          : 0;
      if (broadcastId) {
        let query = db
          .from('broadcast_recipients')
          .select('id, contact:contacts!inner(phone_conversion)', {
            count: 'exact',
            head: true,
          })
          .eq('broadcast_id', broadcastId)
          .eq('status', retry ? 'failed' : 'pending')
          .not('contact.phone_conversion', 'is', null);
        if (recipientId) query = query.eq('id', recipientId);
        const response = await query;
        if (response.error) throw response.error;
        count = response.count ?? 0;
      }
      if (count === 0) return;
      const code =
        conversion?.countryCode ??
        (phone ? await fetchDefaultCountryCode(controller.signal) : '');
      if (
        phone &&
        !conversion &&
        !normalizePhoneInput(phone, code).phone_conversion
      )
        return;
      if (!controller.signal.aborted) setResult({ source, count, code });
    })().catch(() => {});
    return () => controller.abort();
  }, [source, phone, conversion, resolved, broadcastId, recipientId, retry]);
  if (!result || result.source !== source) return null;
  const description = phone
    ? t('converted', {
        phone: conversion?.input ?? phone,
        number: conversion
          ? phone
          : normalizePhoneInput(phone, result.code).phone,
        code: result.code,
      })
    : t('convertedCount', { count: result.count });
  if (tooltip)
    return (
      <TooltipProvider>
        <Tooltip open={tooltipOpen} onOpenChange={setTooltipOpen}>
          <TooltipTrigger
            closeOnClick={false}
            onClick={() => setTooltipOpen(true)}
            aria-label={t('details')}
            aria-describedby={tooltipOpen ? tooltipId : undefined}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex size-7 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2"
          >
            <Info className="size-3.5" aria-hidden />
          </TooltipTrigger>
          <TooltipContent id={tooltipId} role="tooltip">
            {description}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  return (
    <div
      className="text-muted-foreground flex items-start gap-2 text-xs leading-relaxed"
      role="note"
    >
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <p>{description}</p>
    </div>
  );
}
