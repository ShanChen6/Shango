import type {
  DriverProfile,
  DriverReviewItem,
  OtpChallenge,
  Page,
  PublicRole,
  Session,
  User,
  Coordinate,
  MapConfig,
  MapPlace,
  MapSearch,
  MapRoute,
} from '@shango/contracts';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
type SessionStore = {
  get: () => Promise<Session | null>;
  set: (session: Session | null) => Promise<void>;
};
export function createApi(baseUrl: string, store: SessionStore) {
  let refreshInFlight: Promise<Session> | null = null;
  const root = baseUrl.replace(/\/$/, '');
  async function send<T>(path: string, method: string, body: unknown, token?: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`${root}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (response.status === 204) return undefined as T;
      const data: unknown = await response.json();
      if (!response.ok) {
        const message =
          data && typeof data === 'object' && 'message' in data
            ? String(data.message)
            : 'Không thể xử lý yêu cầu';
        throw new ApiError(response.status, message);
      }
      return data as T;
    } finally {
      clearTimeout(timer);
    }
  }
  async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const session = await store.get();
    try {
      return await send<T>(path, method, body, session?.accessToken);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401 || !session) throw error;
      const latest = await store.get();
      // A concurrent request may already have rotated the session.
      if (latest && latest.accessToken !== session.accessToken)
        return send<T>(path, method, body, latest.accessToken);
      if (!refreshInFlight) {
        refreshInFlight = send<Session>('/auth/refresh', 'POST', {
          refreshToken: session.refreshToken,
        })
          .then(async (updated) => {
            await store.set(updated);
            return updated;
          })
          .catch(async (failure) => {
            if (failure instanceof ApiError && failure.status === 401) await store.set(null);
            throw failure;
          })
          .finally(() => {
            refreshInFlight = null;
          });
      }
      const updated = await refreshInFlight;
      return send<T>(path, method, body, updated.accessToken);
    }
  }
  return {
    requestOtp: (phone: string, role: PublicRole) =>
      send<OtpChallenge>('/auth/otp/request', 'POST', { phone, role }),
    verifyOtp: async (phone: string, code: string) => {
      const session = await send<Session>('/auth/otp/verify', 'POST', { phone, code });
      await store.set(session);
      return session;
    },
    me: () => request<User>('/auth/me'),
    mapConfig: () => request<MapConfig>('/maps/config'),
    searchPlaces: (q: string) => request<MapSearch>(`/maps/search?${new URLSearchParams({ q })}`),
    reversePlace: (position: Coordinate) =>
      request<{ item: MapPlace; requestedPosition: Coordinate; provider: 'nominatim' }>(
        `/maps/reverse?${new URLSearchParams({ longitude: String(position.longitude), latitude: String(position.latitude) })}`,
      ),
    mapRoute: (pickup: Coordinate, dropoff: Coordinate) =>
      request<MapRoute>(
        `/maps/route?${new URLSearchParams({ pickupLng: String(pickup.longitude), pickupLat: String(pickup.latitude), dropoffLng: String(dropoff.longitude), dropoffLat: String(dropoff.latitude) })}`,
      ),
    logout: async () => {
      try {
        await request('/auth/logout', 'POST');
      } finally {
        await store.set(null);
      }
    },
    driverProfile: () => request<DriverProfile | null>('/drivers/me'),
    submitDriver: (vehiclePlate: string, vehicleType: string) =>
      request<DriverProfile>('/drivers/me', 'POST', { vehiclePlate, vehicleType }),
    drivers: (page: number, status = '') =>
      request<Page<DriverReviewItem>>(
        `/admin/drivers?page=${page}${status ? `&status=${status}` : ''}`,
      ),
    reviewDriver: (
      id: string,
      status: 'approved' | 'rejected',
      expectedUpdatedAt: string,
      reason?: string,
    ) =>
      request<DriverProfile>(`/admin/drivers/${id}/review`, 'PATCH', {
        status,
        expectedUpdatedAt,
        reason,
      }),
  };
}
