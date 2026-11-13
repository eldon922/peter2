'use client';

import { useEffect, useRef, useState } from 'react';
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
  const [jump, setJump] = useState('');
  const container = useRef<HTMLElement>(null);
  const range = useRef<HTMLSpanElement>(null);
  const navigation = useRef<HTMLDivElement>(null);
  const goTo = useRef<HTMLFormElement>(null);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const [pageWindow, setPageWindow] = useState<'full' | 'nearby' | 'current'>(
    'current'
  );
  const [showGoTo, setShowGoTo] = useState(false);
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (
        !container.current ||
        !range.current ||
        !navigation.current ||
        !goTo.current
      )
        return;
      const width = container.current.clientWidth - 16;
      const buttonWidth =
        navigation.current.querySelector('button')?.getBoundingClientRect()
          .width ?? 36;
      const choices = [
        [...new Set([0, pages - 1, page - 1, page, page + 1])]
          .filter((n) => n >= 0 && n < pages)
          .sort((a, b) => a - b),
        [page - 1, page, page + 1].filter((n) => n >= 0 && n < pages),
        [page],
      ];
      const needed = (numbers: number[]) =>
        (numbers.length + 2) * buttonWidth +
        (numbers.length + 1) * 4 +
        numbers.filter((n, i) => i > 0 && n - numbers[i - 1] > 1).length * 16;
      const available = width - range.current.scrollWidth - 8;
      const choice = choices.findIndex(
        (numbers) => needed(numbers) <= available
      );
      setPageWindow(
        choice === 0 ? 'full' : choice === 1 ? 'nearby' : 'current'
      );
      const sideWidth = (width - needed(choices[0])) / 2 - 8;
      setShowGoTo(
        sideWidth >=
          Math.max(range.current.scrollWidth, goTo.current.scrollWidth)
      );
    });
    for (const element of [
      container.current,
      range.current,
      navigation.current,
      goTo.current,
    ]) {
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [page, pages]);
  const rangeText = t('range', {
    from: total ? page * pageSize + 1 : 0,
    to: Math.min(total, (page + 1) * pageSize),
    total,
  });
  const visiblePages = Array.from(
    new Set(
      pageWindow === 'current'
        ? [page]
        : pageWindow === 'nearby'
          ? [page - 1, page, page + 1]
          : [0, pages - 1, page - 1, page, page + 1]
    )
  )
    .filter((value) => value >= 0 && value < pages)
    .sort((a, b) => a - b);
  return (
    <nav
      ref={container}
      aria-label={t('label')}
      style={{
        gridTemplateColumns: showGoTo
          ? 'minmax(0,1fr) auto minmax(0,1fr)'
          : 'max-content minmax(0,1fr)',
      }}
      className="border-border text-muted-foreground relative grid min-w-0 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-t px-2 py-3 text-xs"
    >
      <span
        ref={range}
        aria-live="polite"
        aria-atomic="true"
        className="w-max whitespace-nowrap tabular-nums"
        title={rangeText}
      >
        {rangeText}
      </span>
      <div
        ref={navigation}
        className={`flex w-max gap-1 ${showGoTo ? 'justify-self-center' : 'justify-self-end'}`}
      >
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
          <span key={value} className="flex shrink-0 items-center gap-1">
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
      <form
        ref={goTo}
        aria-hidden={!showGoTo}
        inert={!showGoTo}
        style={{
          visibility: showGoTo ? 'visible' : 'hidden',
          position: showGoTo ? 'static' : 'absolute',
          right: 8,
        }}
        className="flex w-max items-center gap-1 justify-self-end"
        onSubmit={(event) => {
          event.preventDefault();
          const target = Number(jump);
          if (
            Number.isInteger(target) &&
            target >= 1 &&
            target <= pages &&
            !busy
          ) {
            onPageChange(target - 1);
            setJump('');
          }
        }}
      >
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={pages}
          step={1}
          required
          value={jump}
          disabled={busy || !total}
          onChange={(event) => setJump(event.target.value)}
          aria-label={t('goToPage')}
          placeholder={String(page + 1)}
          className="bg-background h-9 w-12 rounded-md border px-1 text-center tabular-nums"
        />
        <span className="whitespace-nowrap tabular-nums">/ {pages}</span>
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          disabled={busy || !total}
          className="h-9 px-2"
        >
          {t('go')}
        </Button>
      </form>
    </nav>
  );
}
