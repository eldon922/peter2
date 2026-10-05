'use client';

import { useCallback, useState } from 'react';
import type { Dialog } from '@base-ui/react/dialog';

import { useBackLayer } from '@/hooks/use-back-layer';

type RootProps = Dialog.Root.Props;

/**
 * Makes a Dialog/Sheet close on the browser Back button. Works whether the
 * caller controls `open` or leaves it to the trigger.
 */
export function useBackClosable({
  open,
  defaultOpen,
  onOpenChange,
}: Pick<RootProps, 'open' | 'defaultOpen' | 'onOpenChange'>) {
  const [inner, setInner] = useState(defaultOpen ?? false);
  const controlled = open !== undefined;
  const isOpen = controlled ? open : inner;

  const change = useCallback<NonNullable<RootProps['onOpenChange']>>(
    (next, details) => {
      if (!controlled) setInner(next);
      onOpenChange?.(next, details);
    },
    [controlled, onOpenChange],
  );

  useBackLayer(isOpen, () =>
    // No event details exist for a Back press.
    change(false, undefined as unknown as Parameters<typeof change>[1]),
  );

  return { open: isOpen, onOpenChange: change };
}
