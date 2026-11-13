import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  draft: null as null | { id: string; meta_template_id: string | null },
  update: vi.fn(),
  eq: vi.fn(),
  is: vi.fn(),
  upsert: vi.fn(),
}));
vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.auth,
  UnauthorizedError: class extends Error {},
  ForbiddenError: class extends Error {},
  toErrorResponse: vi.fn(),
}));
import { POST } from './route';
const id = '11111111-1111-4111-8111-111111111111';
const body = {
  draft_id: id,
  name: 'edited_draft',
  language: 'en_US',
  category: 'Utility',
  body_text: 'Hello',
};
beforeEach(() => {
  vi.stubEnv('WHATSAPP_TEMPLATES_DRY_RUN', 'true');
  mocks.draft = { id, meta_template_id: null };
  const query = {
    select: () => query,
    eq: (...args: unknown[]) => {
      mocks.eq(...args);
      return query;
    },
    is: (...args: unknown[]) => {
      mocks.is(...args);
      return query;
    },
    maybeSingle: async () => ({ data: mocks.draft, error: null }),
    update: (row: unknown) => {
      mocks.update(row);
      return query;
    },
    upsert: (row: unknown) => {
      mocks.upsert(row);
      return query;
    },
    single: async () => ({ data: { id, ...body }, error: null }),
  };
  mocks.auth.mockResolvedValue({
    supabase: { from: () => query },
    accountId: 'account-a',
    userId: 'admin-b',
  });
});
afterEach(() => vi.unstubAllEnvs());
function submit() {
  return POST(
    new Request('https://example.test/api/whatsapp/templates/submit', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  );
}
it('updates the selected account draft instead of inserting a duplicate when another admin edits it', async () => {
  expect((await submit()).status).toBe(200);
  expect(mocks.eq).toHaveBeenCalledWith('account_id', 'account-a');
  expect(mocks.eq).toHaveBeenCalledWith('id', id);
  expect(mocks.is).toHaveBeenCalledWith('meta_template_id', null);
  expect(mocks.update).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'edited_draft', account_id: 'account-a' })
  );
  expect(mocks.upsert).not.toHaveBeenCalled();
});
it('rejects a draft outside the account or no longer present', async () => {
  mocks.draft = null;
  expect((await submit()).status).toBe(404);
  expect(mocks.update).not.toHaveBeenCalled();
});
it('requires the edit endpoint for a submitted Meta template', async () => {
  mocks.draft = { id, meta_template_id: 'meta-1' };
  expect((await submit()).status).toBe(400);
  expect(mocks.update).not.toHaveBeenCalled();
});
