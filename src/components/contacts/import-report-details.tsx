'use client';

import { ListPagination } from '@/components/ui/list-pagination';
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
  imported: 'text-emerald-800 dark:text-emerald-300',
  updated: 'text-emerald-800 dark:text-emerald-300',
  skipped: 'text-amber-800 dark:text-amber-200',
  failed: 'text-red-700 dark:text-red-300',
  tagFailed: 'text-red-700 dark:text-red-300',
  customFieldFailed: 'text-red-700 dark:text-red-300',
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
  const [page, setPage] = useState(0);

  if (rows.length === 0) return null;

  function detail(row: ReportRow): string {
    const parts: string[] = [];
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
    return parts.join('\n');
  }

  return (
    <div className="border-border rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="focus-visible:ring-ring flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium outline-none focus-visible:ring-2"
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
            {rows.slice(page * PAGE, (page + 1) * PAGE).map((row, i) => (
              <li key={i} className="space-y-2 px-3 py-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                  <span className="text-popover-foreground min-w-0 truncate">
                    {row.name || '—'}
                  </span>
                  <span className="text-muted-foreground shrink-0 font-mono text-[11px]">
                    {row.phone}
                  </span>
                </div>
                {row.existingTags?.length ? (
                  <div className="space-y-1.5">
                    <p className="text-muted-foreground">
                      {t('detailExistingTags', { tags: '' })}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {row.existingTags.map((tag) => (
                        <span
                          key={tag}
                          className="bg-muted text-muted-foreground rounded-md px-2 py-1 break-all"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {detail(row) && (
                  <p className="text-muted-foreground mt-1 leading-relaxed wrap-anywhere whitespace-pre-line">
                    {detail(row)}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {rows.length > PAGE && (
            <ListPagination
              page={page}
              pageSize={PAGE}
              total={rows.length}
              onPageChange={setPage}
            />
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
      <p className="text-foreground text-sm font-semibold">
        {t('reportTitle')}
      </p>
      <Section sectionKey="imported" rows={report.imported} />
      <Section sectionKey="updated" rows={report.updated} />
      <Section sectionKey="skipped" rows={report.skipped} />
      <Section sectionKey="failed" rows={report.failed} />
      <Section sectionKey="tagFailed" rows={report.tagFailed} />
      <Section sectionKey="customFieldFailed" rows={report.customFieldFailed} />
      {report.skippedTags.length > 0 && (
        <p className="text-xs leading-relaxed text-amber-800 dark:text-amber-200">
          {t('reportSkippedTags', { names: report.skippedTags.join(', ') })}
        </p>
      )}
    </div>
  );
}
