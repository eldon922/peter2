export async function register() {
  // Production server only: `next dev` or a build must not touch live data.
  if (
    process.env.NEXT_RUNTIME !== 'nodejs' ||
    process.env.NODE_ENV !== 'production' ||
    process.env.NEXT_PHASE === 'phase-production-build'
  ) {
    return;
  }
  const bootedAt = new Date();

  try {
    const { supabaseAdmin } = await import('@/lib/flows/admin-client');
    const { failInterruptedBroadcasts } = await import('@/lib/broadcasts/interrupted');
    // Before the server takes requests, so a send started after boot is never
    // mistaken for one lost in the restart. Capped so a slow database can't
    // hold the app back.
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      failInterruptedBroadcasts(supabaseAdmin(), bootedAt),
      new Promise((resolve) => {
        timer = setTimeout(resolve, 10_000);
      }),
    ]);
    clearTimeout(timer);
  } catch (error) {
    console.error('[startup] could not check for interrupted broadcasts:', error);
  }

  // Not awaited: it only needs to happen eventually.
  void import('@/lib/cron/setup').then(({ setupCronJobs }) => setupCronJobs());
}
