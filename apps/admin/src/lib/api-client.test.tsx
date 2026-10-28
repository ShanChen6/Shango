import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApi } from '@shango/api-client';
import type { Session } from '@shango/contracts';
const session: Session = {
  accessToken: 'old-access',
  refreshToken: 'old-refresh',
  user: { id: 'driver-1', phone: '+84901234567', role: 'driver', displayName: null },
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());
describe('private document HTTP transport', () => {
  it('lets fetch set multipart boundary and never puts authentication into a URL', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ document: { id: 'doc-1' }, profile: {} }, 201));
    vi.stubGlobal('fetch', fetch);
    const api = createApi('http://local/api/v1', { get: async () => session, set: async () => {} });
    await api.uploadDriverDocument(
      'identity_front',
      '2026-10-28T00:00:00Z',
      new Blob(['image'], { type: 'image/png' }),
    );
    const [url, options] = fetch.mock.calls[0]!;
    expect(url).toBe('http://local/api/v1/drivers/me/documents');
    expect(options.headers).toEqual({ Authorization: 'Bearer old-access' });
    expect(options.body).toBeInstanceOf(FormData);
    expect(options.body.get('kind')).toBe('identity_front');
    expect(options.body.get('expectedUpdatedAt')).toBe('2026-10-28T00:00:00Z');
  });
  it('refreshes an expired session then returns binary image content', async () => {
    let stored: Session | null = session;
    const next = { ...session, accessToken: 'new-access', refreshToken: 'new-refresh' };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ message: 'Expired' }, 401))
      .mockResolvedValueOnce(json(next))
      .mockResolvedValueOnce(
        new Response('private-image', { headers: { 'Content-Type': 'image/jpeg' } }),
      );
    vi.stubGlobal('fetch', fetch);
    const api = createApi('http://local/api/v1', {
      get: async () => stored,
      set: async (value) => {
        stored = value;
      },
    });
    const blob = await api.documentContent('doc-1');
    expect(await blob.text()).toBe('private-image');
    expect(stored?.accessToken).toBe('new-access');
    expect(fetch.mock.calls[2]![1].headers.Authorization).toBe('Bearer new-access');
    expect(fetch.mock.calls[2]![0]).not.toContain('accessToken');
  });
  it('retries the same multipart payload after refresh without JSON encoding it', async () => {
    let stored: Session | null = session;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(json({ ...session, accessToken: 'next' }))
      .mockResolvedValueOnce(json({ document: { id: 'new' }, profile: {} }, 201));
    vi.stubGlobal('fetch', fetch);
    const api = createApi('http://local/api/v1', {
      get: async () => stored,
      set: async (value) => {
        stored = value;
      },
    });
    await api.uploadDriverDocument(
      'driver_license',
      '2026-10-28T00:00:00Z',
      new Blob(['image'], { type: 'image/png' }),
    );
    expect(fetch.mock.calls[2]![1].body).toBe(fetch.mock.calls[0]![1].body);
    expect(fetch.mock.calls[2]![1].headers).not.toHaveProperty('Content-Type');
  });
});
