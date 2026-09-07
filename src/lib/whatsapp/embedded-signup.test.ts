import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  exchangeCodeForToken,
  getEmbeddedSignupEnv,
  listWabaPhoneNumbers,
  resolveWabaIdFromToken,
} from './embedded-signup';

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Every call goes out as a GET, so normalise the URL the same way. */
function requestedUrl(mock: ReturnType<typeof vi.fn>, call = 0): URL {
  const target = mock.mock.calls[call][0];
  return new URL(target instanceof URL ? target.toString() : String(target));
}

describe('exchangeCodeForToken', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(okResponse({ access_token: 'BISU_TOKEN' }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exchanges the code at /oauth/access_token with the app credentials', async () => {
    const token = await exchangeCodeForToken({
      code: 'CODE_123',
      appId: 'APP_ID',
      appSecret: 'APP_SECRET',
    });

    expect(token).toBe('BISU_TOKEN');
    const url = requestedUrl(fetchMock);
    expect(url.pathname).toContain('/oauth/access_token');
    expect(url.searchParams.get('client_id')).toBe('APP_ID');
    expect(url.searchParams.get('client_secret')).toBe('APP_SECRET');
    expect(url.searchParams.get('code')).toBe('CODE_123');
  });

  it('sends no redirect_uri — Embedded Signup codes are rejected with one', async () => {
    await exchangeCodeForToken({ code: 'C', appId: 'A', appSecret: 'S' });
    expect(requestedUrl(fetchMock).searchParams.has('redirect_uri')).toBe(false);
  });

  it('surfaces the Meta error message rather than a bare status', async () => {
    fetchMock.mockResolvedValue(
      errorResponse(400, {
        error: { message: 'This authorization code has been used.', code: 100 },
      }),
    );

    await expect(
      exchangeCodeForToken({ code: 'C', appId: 'A', appSecret: 'S' }),
    ).rejects.toThrow(/authorization code has been used/);
  });

  it('rejects a 200 that carries no token', async () => {
    fetchMock.mockResolvedValue(okResponse({ not_a_token: true }));
    await expect(
      exchangeCodeForToken({ code: 'C', appId: 'A', appSecret: 'S' }),
    ).rejects.toThrow(/no access_token/);
  });
});

describe('resolveWabaIdFromToken', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the WABA id off the whatsapp_business_management granular scope', async () => {
    fetchMock.mockResolvedValue(
      okResponse({
        data: {
          granular_scopes: [
            { scope: 'whatsapp_business_messaging', target_ids: ['OTHER'] },
            { scope: 'whatsapp_business_management', target_ids: ['WABA_1'] },
          ],
        },
      }),
    );

    const wabaId = await resolveWabaIdFromToken({
      accessToken: 'tok',
      appId: 'APP_ID',
      appSecret: 'APP_SECRET',
    });

    expect(wabaId).toBe('WABA_1');
    const url = requestedUrl(fetchMock);
    expect(url.pathname).toContain('/debug_token');
    expect(url.searchParams.get('input_token')).toBe('tok');
    // App access token in the app-id|app-secret short form.
    expect(url.searchParams.get('access_token')).toBe('APP_ID|APP_SECRET');
  });

  it('returns null instead of throwing when the scope is absent', async () => {
    fetchMock.mockResolvedValue(okResponse({ data: { granular_scopes: [] } }));
    await expect(
      resolveWabaIdFromToken({ accessToken: 't', appId: 'A', appSecret: 'S' }),
    ).resolves.toBeNull();
  });

  it('returns null instead of throwing when debug_token errors', async () => {
    fetchMock.mockResolvedValue(errorResponse(400, { error: { message: 'nope' } }));
    await expect(
      resolveWabaIdFromToken({ accessToken: 't', appId: 'A', appSecret: 'S' }),
    ).resolves.toBeNull();
  });
});

describe('listWabaPhoneNumbers', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests platform_type — the field that identifies a coexistence number', async () => {
    fetchMock.mockResolvedValue(
      okResponse({
        data: [
          {
            id: 'PNID_1',
            display_phone_number: '+1 555 0100',
            platform_type: 'SMB_APP',
          },
        ],
      }),
    );

    const numbers = await listWabaPhoneNumbers({
      wabaId: 'WABA_1',
      accessToken: 'tok',
    });

    expect(numbers).toHaveLength(1);
    expect(numbers[0].platform_type).toBe('SMB_APP');
    const url = requestedUrl(fetchMock);
    expect(url.pathname).toContain('/WABA_1/phone_numbers');
    expect(url.searchParams.get('fields')).toContain('platform_type');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  });

  it('returns an empty list when the WABA has no numbers yet', async () => {
    fetchMock.mockResolvedValue(okResponse({}));
    await expect(
      listWabaPhoneNumbers({ wabaId: 'W', accessToken: 't' }),
    ).resolves.toEqual([]);
  });

  it('surfaces Meta errors', async () => {
    fetchMock.mockResolvedValue(
      errorResponse(403, { error: { message: 'Insufficient permission', code: 200 } }),
    );
    await expect(
      listWabaPhoneNumbers({ wabaId: 'W', accessToken: 't' }),
    ).rejects.toThrow(/Insufficient permission/);
  });
});

describe('getEmbeddedSignupEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns null unless all three vars are set — this is what gates the button', () => {
    vi.stubEnv('META_APP_ID', 'APP_ID');
    vi.stubEnv('META_APP_SECRET', 'APP_SECRET');
    vi.stubEnv('NEXT_PUBLIC_META_ES_CONFIG_ID', '');
    expect(getEmbeddedSignupEnv()).toBeNull();

    vi.stubEnv('NEXT_PUBLIC_META_ES_CONFIG_ID', 'CONFIG_ID');
    expect(getEmbeddedSignupEnv()).toEqual({
      appId: 'APP_ID',
      appSecret: 'APP_SECRET',
      configId: 'CONFIG_ID',
    });
  });
});
