'use client';

import { useEffect, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import {
  resolveAudience,
  resolvedCount,
  type AudienceConfig,
  type ResolvedAudience,
} from '@/lib/broadcasts/audience';

// Quick successive changes (tapping several tags) only resolve the last one.
const DEBOUNCE_MS = 300;

/**
 * Resolves the wizard's audience. A result is only trusted if it was
 * computed for the audience object currently on screen, so a slow lookup
 * for an earlier selection can never overwrite a newer one.
 */
export function useAudience(audience: AudienceConfig) {
  const [result, setResult] = useState<{
    audience: AudienceConfig;
    resolved: ResolvedAudience;
    failed: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      resolveAudience(createClient(), audience)
        .then((resolved) => {
          if (!cancelled) setResult({ audience, resolved, failed: false });
        })
        .catch(() => {
          if (!cancelled) setResult({ audience, resolved: null, failed: true });
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [audience]);

  const current = result?.audience === audience ? result : null;
  return {
    resolved: current?.resolved ?? null,
    count: resolvedCount(current?.resolved ?? null),
    loading: current === null,
    failed: current?.failed ?? false,
  };
}
