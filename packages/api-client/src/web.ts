import type { Role, User } from '@shango/contracts';

export type WebApp = 'customer' | 'driver' | 'admin';
export type WebSession = { accessToken: string; csrfToken: string; user: User };

export class WebApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = 'WEB_API_ERROR',
    public readonly requestId?: string,
  ) {
    super(message);
  }
}

type WebApiOptions = {
  app: WebApp;
  allowedRoles: readonly Role[];
  fetch?: typeof fetch;
  onSessionInvalid?: () => void;
};

export type WebRequestInit = RequestInit & {
  retryOnAuth?: boolean;
  responseType?: 'json' | 'blob';
};

export function createWebApi(baseUrl: string, options: WebApiOptions) {
  const root = baseUrl.replace(/\/$/, '');
  const fetcher = options.fetch ?? fetch;
  let session: WebSession | null = null;
  let refreshInFlight: Promise<WebSession> | null = null;

  const clearSession = () => {
    session = null;
    options.onSessionInvalid?.();
  };

  async function parse<T>(response: Response, responseType: 'json' | 'blob' = 'json'): Promise<T> {
    if (response.status === 204) return undefined as T;
    if (response.ok && responseType === 'blob') return (await response.blob()) as T;
    const body = (await response.json().catch(() => null)) as
      ({ message?: string; code?: string } & T) | null;
    if (!response.ok) {
      throw new WebApiError(
        response.status,
        body?.message ?? 'Không thể xử lý yêu cầu',
        body?.code ?? 'WEB_API_ERROR',
        response.headers.get('X-Request-Id') ?? undefined,
      );
    }
    return body as T;
  }

  async function send<T>(
    path: string,
    init: RequestInit = {},
    csrfToken?: string,
    responseType: 'json' | 'blob' = 'json',
  ) {
    const multipart = typeof FormData !== 'undefined' && init.body instanceof FormData;
    const response = await fetcher(`${root}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(init.body && !multipart ? { 'Content-Type': 'application/json' } : {}),
        ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        ...init.headers,
      },
    });
    return parse<T>(response, responseType);
  }

  function accept(value: WebSession) {
    if (!options.allowedRoles.includes(value.user.role)) {
      clearSession();
      throw new WebApiError(403, 'Tài khoản không thuộc ứng dụng này', 'ROLE_MISMATCH');
    }
    session = value;
    return value;
  }

  async function refresh() {
    if (!refreshInFlight) {
      refreshInFlight = (async () => {
        const csrf = await send<{ csrfToken: string }>('/auth/web/csrf');
        const value = await send<WebSession>(
          '/auth/web/refresh',
          { method: 'POST' },
          csrf.csrfToken,
        );
        return accept(value);
      })()
        .catch((error) => {
          clearSession();
          throw error;
        })
        .finally(() => {
          refreshInFlight = null;
        });
    }
    return refreshInFlight;
  }

  async function request<T>(path: string, init: WebRequestInit = {}) {
    if (!session) await refresh();
    const first = session as WebSession;
    const { retryOnAuth, responseType, ...requestInit } = init;
    try {
      return await send<T>(
        path,
        {
          ...requestInit,
          headers: { Authorization: `Bearer ${first.accessToken}`, ...requestInit.headers },
        },
        undefined,
        responseType,
      );
    } catch (error) {
      if (!(error instanceof WebApiError) || error.status !== 401) throw error;
      const method = (requestInit.method ?? 'GET').toUpperCase();
      const safeToReplay = ['GET', 'HEAD', 'OPTIONS'].includes(method) || retryOnAuth === true;
      if (!safeToReplay) throw error;
      const latest = session;
      if (latest && latest.accessToken !== first.accessToken) {
        return send<T>(
          path,
          {
            ...requestInit,
            headers: { Authorization: `Bearer ${latest.accessToken}`, ...requestInit.headers },
          },
          undefined,
          responseType,
        );
      }
      const updated = await refresh();
      return send<T>(
        path,
        {
          ...requestInit,
          headers: { Authorization: `Bearer ${updated.accessToken}`, ...requestInit.headers },
        },
        undefined,
        responseType,
      );
    }
  }

  return {
    getSession: () => session,
    requestOtp: (phone: string) =>
      send<{ expiresIn: number; devCode?: string }>('/auth/web/otp/request', {
        method: 'POST',
        body: JSON.stringify({ phone, app: options.app }),
      }),
    verifyOtp: async (phone: string, code: string) =>
      accept(
        await send<WebSession>('/auth/web/otp/verify', {
          method: 'POST',
          body: JSON.stringify({ phone, code, app: options.app }),
        }),
      ),
    bootstrap: refresh,
    request,
    logout: async () => {
      const csrf = session?.csrfToken;
      try {
        if (csrf) await send('/auth/web/logout', { method: 'POST' }, csrf);
      } finally {
        clearSession();
      }
    },
    clearSession,
  };
}
