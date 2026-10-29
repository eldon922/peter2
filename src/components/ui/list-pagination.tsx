'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from './button';

export function useListPage(total: number, pageSize: number, filterKey: string) {
  const [selection, setSelection] = useState({ key: filterKey, page: 0 });
  const page = selection.key === filterKey ? Math.min(selection.page, Math.max(0, Math.ceil(total / pageSize) - 1)) : 0;
  return { page, setPage: (page: number) => setSelection({ key: filterKey, page }) };
}

export function ListPagination({ page, pageSize, total, onPageChange, busy = false }: {
  page: number; pageSize: number; total: number; onPageChange: (page: number) => void; busy?: boolean;
}) {
  const t = useTranslations('Pagination');
  return <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
    <span>{t('range', { from: total ? page * pageSize + 1 : 0, to: Math.min(total, (page + 1) * pageSize), total })}</span>
    <div className="flex gap-1">
      <Button variant="ghost" size="icon-sm" disabled={busy || page === 0} aria-label={t('previous')} onClick={() => onPageChange(page - 1)}><ChevronLeft className="size-4" /></Button>
      <Button variant="ghost" size="icon-sm" disabled={busy || (page + 1) * pageSize >= total} aria-label={t('next')} onClick={() => onPageChange(page + 1)}><ChevronRight className="size-4" /></Button>
    </div>
  </div>;
}
