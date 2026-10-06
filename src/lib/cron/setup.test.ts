import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => ({ rpc }) }));

import { setupCronJobs } from './setup';

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', ' https://crm.example.com/ ');
  vi.stubEnv('AUTOMATION_CRON_SECRET', 'shh');
  rpc.mockReset();
  rpc.mockResolvedValue({ error: null });
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('setupCronJobs', () => {
  it('asks the database to schedule the job with the app url and secret', async () => {
    await setupCronJobs();

    expect(rpc).toHaveBeenCalledWith('setup_cron_jobs', {
      app_url: 'https://crm.example.com/',
      cron_secret: 'shh',
    });
  });

  it.each(['NEXT_PUBLIC_SITE_URL', 'AUTOMATION_CRON_SECRET'])(
    'does nothing without %s',
    async (name) => {
      vi.stubEnv(name, '');

      await setupCronJobs();

      expect(rpc).not.toHaveBeenCalled();
    }
  );

  it('does not throw when the migration is missing', async () => {
    rpc.mockResolvedValue({ error: { message: 'function not found' } });
    await expect(setupCronJobs()).resolves.toBeUndefined();
  });

  it('does not throw when the call itself fails', async () => {
    rpc.mockRejectedValue(new Error('network down'));
    await expect(setupCronJobs()).resolves.toBeUndefined();
  });
});
