'use client';

import { useRef, type ComponentProps } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Input } from './input';
import { cn } from '@/lib/utils';

export function SearchInput({
  value,
  onClear,
  loading = false,
  className,
  onKeyDown,
  ...props
}: Omit<ComponentProps<'input'>, 'value' | 'type' | 'ref'> & {
  value: string;
  onClear: () => void;
  loading?: boolean;
}) {
  const t = useTranslations('Search');
  const input = useRef<HTMLInputElement>(null);
  function clear() {
    onClear();
    input.current?.focus();
  }
  return (
    <div className="relative min-w-0">
      <Search
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2"
        aria-hidden
      />
      <Input
        {...props}
        ref={input}
        type="search"
        value={value}
        aria-label={props['aria-label'] ?? props.placeholder}
        className={cn(
          '[&::-webkit-search-cancel-button]:appearance-none',
          className,
          'pl-9',
          value && 'pr-10',
          loading && (value ? 'pr-18' : 'pr-10')
        )}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (!event.defaultPrevented && event.key === 'Escape' && value) {
            event.preventDefault();
            event.stopPropagation();
            clear();
          }
        }}
      />
      {loading && (
        <Loader2
          role="status"
          aria-label={t('loading')}
          className={cn(
            'text-muted-foreground pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 animate-spin',
            value ? 'right-11' : 'right-3'
          )}
        />
      )}
      {value && (
        <button
          type="button"
          disabled={props.disabled}
          aria-label={t('clear')}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg outline-none focus-visible:ring-2 disabled:opacity-50"
          onMouseDown={(event) => event.preventDefault()}
          onClick={clear}
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
}
