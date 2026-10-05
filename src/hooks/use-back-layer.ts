'use client';

import { useCallback, useEffect, useRef } from 'react';

import { pushLayer, type HistoryLayer } from '@/lib/history-layers';

/**
 * While `active`, the browser Back button calls `onPop` (to close the
 * overlay) instead of leaving the page. Returns a function that closes
 * the overlay the same way — use it for in-app "back"/close buttons that
 * change the URL, so history stays consistent.
 */
export function useBackLayer(active: boolean, onPop: () => void): () => void {
  const onPopRef = useRef(onPop);
  useEffect(() => {
    onPopRef.current = onPop;
  });
  const layerRef = useRef<HistoryLayer | null>(null);

  useEffect(() => {
    if (!active) return;
    const layer = pushLayer(() => onPopRef.current());
    layerRef.current = layer;
    return () => {
      layer.remove();
      layerRef.current = null;
    };
  }, [active]);

  return useCallback(() => {
    if (layerRef.current) layerRef.current.pop();
    else onPopRef.current();
  }, []);
}
