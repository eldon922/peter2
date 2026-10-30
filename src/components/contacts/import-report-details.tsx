'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import type { ImportReport, ReportRow } from '@/lib/contacts/import-report';

const PAGE = 50;

type SectionKey =
  | 'imported'
  | 'updated'
  | 'skipped'
  | 'failed'
  | 'tagFailed'
  | 'customFieldFailed';

const TONE: Record<SectionKey, string> = {
  imported: 'text-primary',
  updated: 'text-primary',
  skipped: 'text-amber-400',
  failed: 'text-red-400',
  tagFailed: 'text-red-400',
  customFieldFailed: 'text-red-400',
};

function Section({
  sectionKey,
  rows,
}: {
  sectionKey: SectionKey;
  rows: ReportRow[];
}) {
  const t = useTranslations('Contacts.importModal');
  // Problems are worth seeing straight away; the long happy-path lists aren't.
  const [open, setOpen] = useState(
    sectionKey === 'failed' ||
      sectionKey === 'tagFailed' ||
      sectionKey === 'customFieldFailed' ||
      sectionKey === 'skipped'
  );
  const [shown, setShown] = useState(PAGE);

  if (rows.length === 0) return null;

  function detail(row: ReportRow): string {
    const parts: string[] = [];
    if (row.existingTags?.length)
      parts.push(
        t('detailExistingTags', { tags: row.existingTags.join(', ') })
      );
    if (row.reason) parts.push(t(`reason.${row.reason}`));
    if (row.rename) {
      parts.push(
        row.rename.from
          ? t('detailRenamed', { from: row.rename.from, to: row.rename.to })
          : t('detailNamed', { to: row.rename.to })
      );
    }
    if (row.tags?.length)
      parts.push(t('detailTags', { tags: row.tags.join(', ') }));
    if (row.customFields?.length)
      parts.push(
        t('detailCustomFields', { fields: row.customFields.join(', ') })
      );
    if (row.error) parts.push(row.error);
    return parts.join(' · ');
  }

  return (
    <div className="border-border rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium"
      >
        <span className={TONE[sectionKey]}>
          {t(`section.${sectionKey}`, { count: rows.length })}
        </span>
        <ChevronDown
          className={cn(
            'text-muted-foreground size-4 transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>
      {open && (
        <div className="border-border border-t">
          <ul className="divide-border/70 divide-y text-xs">
            {rows.slice(0, shown).map((row, i) => (
              <li key={i} className="px-3 py-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-popover-foreground min-w-0 truncate">
                    {row.name || '—'}
                  </span>
                  <span className="text-muted-foreground shrink-0 font-mono text-[11px]">
                    {row.phone}
                  </span>
                </div>
                {detail(row) && (
                  <p className="text-muted-foreground mt-0.5 wrap-anywhere">
                    {detail(row)}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {shown < rows.length && (
            <button
              type="button"
              onClick={() => setShown(shown + PAGE)}
              className="border-border text-muted-foreground hover:text-foreground w-full border-t px-3 py-1.5 text-xs"
            >
              {t('reportShowMore', {
                count: Math.min(PAGE, rows.length - shown),
              })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Row-by-row account of an import: added, updated, skipped (and why), failed. */
export function ImportReportDetails({ report }: { report: ImportReport }) {
  const t = useTranslations('Contacts.importModal');
  return (
    <div className="mt-4 space-y-2">
      <p className="text-muted-foreground text-[11px] font-semibold tracking-[0.14em] uppercase">
        {t('reportTitle')}
      </p>
      <Section sectionKey="failed" rows={report.failed} />
      <Section sectionKey="tagFailed" rows={report.tagFailed} />
      <Section sectionKey="customFieldFailed" rows={report.customFieldFailed} />
      <Section sectionKey="skipped" rows={report.skipped} />
      <Section sectionKey="updated" rows={report.updated} />
      <Section sectionKey="imported" rows={report.imported} />
      {report.skippedTags.length > 0 && (
        <p className="text-xs leading-relaxed text-amber-500">
          {t('reportSkippedTags', { names: report.skippedTags.join(', ') })}
        </p>
      )}
    </div>
  );
}
