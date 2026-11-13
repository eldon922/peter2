'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from './button';

export function useListPage(
  total: number,
  pageSize: number,
  filterKey: string
) {
  const [selection, setSelection] = useState({ key: filterKey, page: 0 });
  const page =
    selection.key === filterKey
      ? Math.min(selection.page, Math.max(0, Math.ceil(total / pageSize) - 1))
      : 0;
  return {
    page,
    setPage: (page: number) => setSelection({ key: filterKey, page }),
  };
}

export function ListPagination({
  page,
  pageSize,
  total,
  onPageChange,
  busy = false,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  busy?: boolean;
}) {
  const t = useTranslations('Pagination');
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const visiblePages = Array.from(
    new Set([0, pages - 1, page - 1, page, page + 1])
  )
    .filter((value) => value >= 0 && value < pages)
    .sort((a, b) => a - b);
  return (
    <nav
      aria-label={t('label')}
      className="border-border text-muted-foreground flex shrink-0 flex-wrap items-center justify-between gap-3 border-t px-3 py-3 text-xs"
    >
      <span aria-live="polite" aria-atomic="true" className="tabular-nums">
        {t('range', {
          from: total ? page * pageSize + 1 : 0,
          to: Math.min(total, (page + 1) * pageSize),
          total,
        })}
      </span>
      <div className="flex shrink-0 gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-9 pointer-coarse:size-11"
          disabled={busy || page === 0}
          aria-label={t('previous')}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="size-4" />
        </Button>
        {visiblePages.map((value, index) => (
          <span key={value} className="flex items-center gap-1">
            {index > 0 && value - visiblePages[index - 1] > 1 && (
              <span aria-hidden>…</span>
            )}
            <Button
              type="button"
              variant={page === value ? 'secondary' : 'ghost'}
              size="icon-sm"
              className="size-9 pointer-coarse:size-11"
              disabled={busy}
              aria-current={page === value ? 'page' : undefined}
              onClick={() => onPageChange(value)}
            >
              {value + 1}
            </Button>
          </span>
        ))}
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-9 pointer-coarse:size-11"
          disabled={busy || (page + 1) * pageSize >= total}
          aria-label={t('next')}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </nav>
  );
}
