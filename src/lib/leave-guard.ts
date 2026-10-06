// ============================================================
// "Are you sure you want to leave?" for a page with unsaved work.
//
// Covers the three ways of leaving:
//   - closing / reloading the tab (the browser's own prompt),
//   - clicking a link inside the app (a confirm dialog),
//   - the browser Back button (a confirm dialog).
// Leaving on purpose from code (after sending, after saving) calls
// `release()` first so nothing prompts.
// ============================================================

import { pushLayer, type HistoryLayer } from '@/lib/history-layers';

export interface LeaveGuard {
  /** Stop guarding and tidy history. Safe to call more than once. */
  release: () => Promise<void>;
}

export function armLeaveGuard(
  getMessage: () => string,
  navigate: (url: string) => void
): LeaveGuard {
  let layer: HistoryLayer | null = null;
  let released: Promise<void> | null = null;

  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    e.preventDefault();
    e.returnValue = '';
  };

  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!link || link.target === '_blank' || link.hasAttribute('download')) return;

    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    // Same page (e.g. a hash link) isn't leaving.
    if (url.pathname === window.location.pathname && url.search === window.location.search) return;

    // Handled here either way, so the link's own navigation doesn't run.
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(getMessage())) return;
    void release().then(() => navigate(url.pathname + url.search + url.hash));
  };

  // Back was pressed and our history entry is already gone: stay (put the
  // entry back) or really go back.
  const onBack = () => {
    if (window.confirm(getMessage())) {
      stopListening();
      layer = null;
      window.history.back();
    } else {
      layer = pushLayer(onBack);
    }
  };

  function stopListening() {
    window.removeEventListener('beforeunload', onBeforeUnload);
    document.removeEventListener('click', onClick, true);
  }

  function release(): Promise<void> {
    if (released) return released;
    stopListening();
    const rewound = layer?.remove() ?? false;
    layer = null;
    released = rewound
      ? new Promise<void>((resolve) =>
          window.addEventListener('popstate', () => resolve(), { once: true })
        )
      : Promise.resolve();
    return released;
  }

  window.addEventListener('beforeunload', onBeforeUnload);
  document.addEventListener('click', onClick, true);
  layer = pushLayer(onBack);

  return { release };
}
