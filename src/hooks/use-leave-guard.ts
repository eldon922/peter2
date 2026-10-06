'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

import { armLeaveGuard, type LeaveGuard } from '@/lib/leave-guard';

/**
 * While `dirty`, leaving the page asks for confirmation (tab close, links
 * inside the app, the Back button). Returns:
 *   - `release()` — call and await before navigating away on purpose;
 *   - `confirmLeave()` — for an in-page "leave" button: asks when there is
 *     something to lose, and returns whether to go ahead.
 */
export function useLeaveGuard(dirty: boolean, message: string) {
  const router = useRouter();
  const guardRef = useRef<LeaveGuard | null>(null);
  // Read at prompt time so a language change doesn't rebuild the guard.
  const messageRef = useRef(message);
  useEffect(() => {
    messageRef.current = message;
  });

  useEffect(() => {
    if (!dirty) return;
    const guard = armLeaveGuard(() => messageRef.current, (url) => router.push(url));
    guardRef.current = guard;
    return () => {
      void guard.release();
      guardRef.current = null;
    };
  }, [dirty, router]);

  const release = useCallback(async () => {
    await guardRef.current?.release();
  }, []);

  const confirmLeave = useCallback(
    () => !guardRef.current || window.confirm(messageRef.current),
    []
  );

  return { release, confirmLeave };
}
