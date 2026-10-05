'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import {
  AUDIENCE_PAGE_SIZE,
  fetchAudiencePage,
  resolvedCount,
  type AudienceContact,
  type ResolvedAudience,
} from '@/lib/broadcasts/audience';

interface Props {
  resolved: NonNullable<ResolvedAudience>;
  /** Tailwind max-height class for the scroll area. */
  maxHeightClass?: string;
}

/** Who a broadcast will go to, loaded one page at a time. */
export function AudienceContactList({
  resolved,
  maxHeightClass = 'max-h-56',
}: Props) {
  const t = useTranslations('Broadcasts.wizard.contactList');
  const total = resolvedCount(resolved) ?? 0;
  // Tagged with the audience it was loaded for, so a stale page is ignored.
  const [page, setPage] = useState<{
    source: typeof resolved;
    rows: AudienceContact[];
    failed: boolean;
  } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchAudiencePage(createClient(), resolved, 0)
      .then((rows) => {
        if (!cancelled) setPage({ source: resolved, rows, failed: false });
      })
      .catch(() => {
        if (!cancelled) setPage({ source: resolved, rows: [], failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [resolved]);

  const current = page?.source === resolved ? page : null;
  const rows = current?.rows ?? [];

  async function showMore() {
    if (!current) return;
    setLoadingMore(true);
    try {
      const next = await fetchAudiencePage(
        createClient(),
        resolved,
        current.rows.length,
      );
      setPage({ ...current, rows: [...current.rows, ...next] });
    } catch {
      setPage({ ...current, failed: true });
    } finally {
      setLoadingMore(false);
    }
  }

  if (!current) {
    return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  }

  return (
    <div className="space-y-2">
      <div className={`overflow-y-auto rounded-lg border border-border ${maxHeightClass}`}>
        <ul className="divide-y divide-border">
          {rows.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm"
            >
              <span className="min-w-0 truncate text-foreground">
                {c.name || t('noName')}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{c.phone}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{t('showing', { shown: rows.length, total })}</span>
        {current.failed && <span className="text-red-400">{t('failed')}</span>}
        {rows.length < total && !current.failed && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={showMore}
            disabled={loadingMore}
            className="h-7 px-2 text-xs"
          >
            {loadingMore && <Loader2 className="h-3 w-3 animate-spin" />}
            {t('showMore', { count: Math.min(AUDIENCE_PAGE_SIZE, total - rows.length) })}
          </Button>
        )}
      </div>
    </div>
  );
}
