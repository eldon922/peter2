'use client';
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ListPagination, useListPage } from '@/components/ui/list-pagination';
import { createClient } from '@/lib/supabase/client';
import { contactDisplayName } from '@/lib/contacts/display-name';
import { convertedAudience } from '@/lib/whatsapp/local-phones';
import {
  AUDIENCE_PAGE_SIZE,
  fetchAudiencePage,
  resolvedCount,
  type AudienceContact,
  type ResolvedAudience,
} from '@/lib/broadcasts/audience';
interface Props {
  resolved: NonNullable<ResolvedAudience>;
  maxHeightClass?: string;
}
export function AudienceContactList({
  resolved,
  maxHeightClass = 'max-h-56',
}: Props) {
  const t = useTranslations('Broadcasts.wizard.contactList');
  const total = resolvedCount(resolved) ?? 0;
  const { page, setPage } = useListPage(
    total,
    AUDIENCE_PAGE_SIZE,
    JSON.stringify(resolved)
  );
  const [result, setResult] = useState<{
    source: typeof resolved;
    page: number;
    rows: AudienceContact[];
    failed: boolean;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchAudiencePage(createClient(), resolved, page * AUDIENCE_PAGE_SIZE)
      .then((rows) => {
        if (!cancelled)
          setResult({ source: resolved, page, rows, failed: false });
      })
      .catch(() => {
        if (!cancelled)
          setResult({ source: resolved, page, rows: [], failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [resolved, page]);
  const current =
    result?.source === resolved && result.page === page ? result : null;
  return (
    <div className="space-y-2">
      <div
        className={`border-border overflow-y-auto rounded-lg border ${maxHeightClass}`}
      >
        {!current ? (
          <Loader2 className="m-3 size-4 animate-spin" />
        ) : current.failed ? (
          <p role="alert" className="p-3 text-sm text-red-500">
            {t('failed')}
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {current.rows.map((contact) => (
              <li
                key={contact.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
              >
                <span className="min-w-0 truncate">
                  {contact.name || contact.profile_name
                    ? contactDisplayName(contact)
                    : t('noName')}
                </span>
                <span className="text-muted-foreground text-xs">
                  {contact.phone}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ListPagination
        page={page}
        pageSize={AUDIENCE_PAGE_SIZE}
        total={total}
        onPageChange={setPage}
        busy={!current}
      />
    </div>
  );
}

export function ConvertedAudienceList({
  resolved,
}: {
  resolved: NonNullable<ResolvedAudience>;
}) {
  const t = useTranslations('PhoneFormat');
  const [result, setResult] = useState<{
    source: typeof resolved;
    audience: NonNullable<ResolvedAudience>;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    convertedAudience(createClient(), resolved)
      .then((audience) => {
        if (!cancelled) setResult({ source: resolved, audience });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [resolved]);
  if (result?.source !== resolved || !resolvedCount(result.audience))
    return null;
  return (
    <details className="mt-4 text-sm">
      <summary className="cursor-pointer">{t('convertedList')}</summary>
      <div className="mt-2">
        <AudienceContactList resolved={result.audience} />
      </div>
    </details>
  );
}
