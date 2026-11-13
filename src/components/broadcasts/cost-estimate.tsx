'use client';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import {
  fetchAudiencePage,
  type ResolvedAudience,
} from '@/lib/broadcasts/audience';
import {
  estimateBroadcastCost,
  deliveryCostRange,
  pricingSource,
  type PriceCategory,
} from '@/lib/broadcasts/pricing/estimate';

export function BroadcastCostEstimate({
  resolved,
  count,
  category,
}: {
  resolved: NonNullable<ResolvedAudience>;
  count: number;
  category: PriceCategory;
}) {
  const t = useTranslations('Broadcasts.wizard.cost');
  const locale = useLocale();
  const { defaultCurrency } = useAuth();
  const [result, setResult] = useState<{
    resolved: typeof resolved;
    currency: string;
    category: PriceCategory;
    count: number;
    maximum: number | null;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function calculate() {
      const db = createClient();
      let maximum = 0;
      for (let offset = 0; offset < count;) {
        const rows = await fetchAudiencePage(
          db,
          resolved,
          offset,
          Math.min(1000, count - offset)
        );
        if (cancelled) return;
        if (!rows.length)
          throw new Error('Audience changed during estimation.');
        maximum += estimateBroadcastCost(
          rows.map((row) => row.phone),
          category,
          defaultCurrency
        ).maximum;
        offset += rows.length;
      }
      return maximum;
    }
    void calculate()
      .then((maximum) => {
        if (!cancelled)
          setResult({
            resolved,
            currency: defaultCurrency,
            category,
            count,
            maximum: maximum ?? null,
          });
      })
      .catch(() => {
        if (!cancelled)
          setResult({
            resolved,
            currency: defaultCurrency,
            category,
            count,
            maximum: null,
          });
      });
    return () => {
      cancelled = true;
    };
  }, [resolved, count, category, defaultCurrency]);
  const current =
    result?.resolved === resolved &&
    result.currency === defaultCurrency &&
    result.category === category &&
    result.count === count
      ? result
      : null;
  const money = (amount: number) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: defaultCurrency,
      maximumFractionDigits: 2,
    }).format(amount);
  return (
    <section
      className="border-border bg-card space-y-2 rounded-xl border p-5"
      aria-live="polite"
    >
      <h3 className="text-sm font-semibold">{t('title')}</h3>
      <p className="text-lg font-semibold tabular-nums">
        {!current
          ? t('loading')
          : current.maximum == null
            ? t('unavailable', { currency: defaultCurrency })
            : `${money(deliveryCostRange(current.maximum, count).minimum)} – ${money(current.maximum)}`}
      </p>
      <p className="text-muted-foreground text-xs leading-relaxed">
        {t('deliveries', {
          minimum: Math.ceil((count * 9) / 10),
          total: count,
        })}{' '}
        {t('assumptions')}
      </p>
      <a
        href={pricingSource.url}
        target="_blank"
        rel="noreferrer"
        className="text-muted-foreground text-xs underline"
      >
        {t('source', { date: pricingSource.effective })}
      </a>
    </section>
  );
}
