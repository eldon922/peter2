export function register() {
  // Production server only: `next dev` or a build must not replace the live job.
  if (
    process.env.NEXT_RUNTIME !== 'nodejs' ||
    process.env.NODE_ENV !== 'production' ||
    process.env.NEXT_PHASE === 'phase-production-build'
  ) {
    return;
  }
  // Not awaited: register must finish before the server takes requests.
  void import('@/lib/cron/setup').then(({ setupCronJobs }) => setupCronJobs());
}

export const onRequestError: import('next').Instrumentation.onRequestError = (
  error,
  request,
  context
) => {
  console.error(
    '[request-error]',
    request.method,
    request.path.split('?')[0],
    context.routePath,
    {
      message: error instanceof Error ? error.message : String(error),
      digest:
        error && typeof error === 'object' && 'digest' in error
          ? error.digest
          : undefined,
      stack: error instanceof Error ? error.stack : undefined,
    }
  );
};
