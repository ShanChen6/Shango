import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebApi, WebApiError, type WebSession } from '../src/web';

const user = { id: 'u1', phone: '+84900000000', role: 'customer' as const, displayName: null };
const session = (accessToken: string): WebSession => ({ accessToken, csrfToken: 'csrf-1', user });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.restoreAllMocks());

describe('createWebApi', () => {
  it('sends app identity during OTP login and keeps tokens in memory', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(session('access-1')));
    const api = createWebApi('https://api.example/api/v1', {
      app: 'customer', allowedRoles: ['customer'], fetch: fetcher,
    });

    await expect(api.verifyOtp('+84900000000', '123456')).resolves.toMatchObject({ user });
    const request = fetcher.mock.calls[0];
    expect(JSON.parse(String(request[1]?.body))).toEqual({
      phone: '+84900000000', code: '123456', app: 'customer',
    });
    expect(request[1]?.credentials).toBe('include');
    expect(api.getSession()?.accessToken).toBe('access-1');
  });

  it('rejects a wrong-role session before rendering protected routes', async () => {
    const invalidated = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      json({ ...session('access-1'), user: { ...user, role: 'driver' } }),
    );
    const api = createWebApi('/api/v1', {
      app: 'customer', allowedRoles: ['customer'], fetch: fetcher, onSessionInvalid: invalidated,
    });

    await expect(api.verifyOtp('+84900000000', '123456')).rejects.toMatchObject({
      status: 403, code: 'ROLE_MISMATCH',
    });
    expect(api.getSession()).toBeNull();
    expect(invalidated).toHaveBeenCalledOnce();
  });

  it('uses one refresh flight and retries concurrent 401 requests once', async () => {
    let protectedCalls = 0;
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/auth/web/csrf')) return json({ csrfToken: 'csrf-1' });
      if (url.endsWith('/auth/web/refresh')) return json(session(protectedCalls ? 'access-2' : 'access-1'));
      protectedCalls += 1;
      if (protectedCalls <= 2) return json({ message: 'expired' }, 401);
      return json({ ok: true });
    });
    const api = createWebApi('/api/v1', {
      app: 'customer', allowedRoles: ['customer'], fetch: fetcher,
    });
    await api.bootstrap();

    await expect(Promise.all([api.request('/one'), api.request('/two')])).resolves.toEqual([
      { ok: true }, { ok: true },
    ]);
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/auth/web/refresh'))).toHaveLength(2);
  });

  it('reuses a newly rotated token when a delayed 401 arrives', async () => {
    let protectedCalls = 0;
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/auth/web/csrf')) return json({ csrfToken: 'csrf-1' });
      if (url.endsWith('/auth/web/refresh')) return json(session(protectedCalls ? 'access-2' : 'access-1'));
      protectedCalls += 1;
      if (protectedCalls === 2) await new Promise(resolve => setTimeout(resolve, 10));
      if (String(new Headers(init?.headers).get('Authorization')).includes('access-1')) return json({ message: 'expired' }, 401);
      return json({ ok: true });
    });
    const api = createWebApi('/api/v1', { app: 'customer', allowedRoles: ['customer'], fetch: fetcher });
    await api.bootstrap();

    await expect(Promise.all([api.request('/one'), api.request('/two')])).resolves.toEqual([{ ok: true }, { ok: true }]);
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/auth/web/refresh'))).toHaveLength(2);
  });

  it('does not replay a non-idempotent mutation after 401', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json(session('access-1')))
      .mockResolvedValueOnce(json({ message: 'expired' }, 401));
    const api = createWebApi('/api/v1', { app: 'customer', allowedRoles: ['customer'], fetch: fetcher });
    await api.verifyOtp('+84900000000', '123456');

    await expect(api.request('/orders', { method: 'POST', body: '{}' })).rejects.toMatchObject({ status: 401 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('replays an explicitly classified mutation after auth refresh', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json(session('access-1')))
      .mockResolvedValueOnce(json({ message: 'expired' }, 401))
      .mockResolvedValueOnce(json({ csrfToken: 'csrf-2' }))
      .mockResolvedValueOnce(json(session('access-2')))
      .mockResolvedValueOnce(json({ updated: true }));
    const api = createWebApi('/api/v1', { app: 'customer', allowedRoles: ['customer'], fetch: fetcher });
    await api.verifyOtp('+84900000000', '123456');

    await expect(api.request('/profile', { method: 'PATCH', body: '{}', retryOnAuth: true })).resolves.toEqual({ updated: true });
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it('clears memory on logout even when the server returns an error', async () => {
    const invalidated = vi.fn();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(session('access-1')))
      .mockResolvedValueOnce(json({ message: 'network edge failed' }, 503));
    const api = createWebApi('/api/v1', {
      app: 'customer', allowedRoles: ['customer'], fetch: fetcher, onSessionInvalid: invalidated,
    });
    await api.verifyOtp('+84900000000', '123456');

    await expect(api.logout()).rejects.toBeInstanceOf(WebApiError);
    expect(api.getSession()).toBeNull();
    expect(invalidated).toHaveBeenCalledOnce();
  });
});
