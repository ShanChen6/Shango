import { createApi, createWebApi } from '@shango/api-client';
import type {
  AuditFilters, AuditPage, Coordinate, DocumentKind, DocumentUpload, DriverDocuments,
  DriverProfile, DriverReviewItem, MapConfig, MapPlace, MapRoute, MapSearch, Page, PublicRole,
  Order, OrderStatus, Session, User, UserProfile,
} from '@shango/contracts';

export function createAdminWebApi(baseUrl: string, onSessionInvalid: () => void) {
  const invalidListeners = new Set<() => void>();
  const web = createWebApi(baseUrl, {
    app: 'admin',
    allowedRoles: ['admin', 'dispatcher', 'accountant'],
    onSessionInvalid: () => { onSessionInvalid(); invalidListeners.forEach(listener => listener()); },
  });
  const json = (body: unknown) => JSON.stringify(body);
  const asLegacySession = (value: Awaited<ReturnType<typeof web.bootstrap>>): Session => ({ accessToken: value.accessToken, refreshToken: '', user: value.user });
  const adapter = {
    requestOtp: (phone: string, _role: PublicRole) => web.requestOtp(phone),
    verifyOtp: async (phone: string, code: string): Promise<Session> => {
      return asLegacySession(await web.verifyOtp(phone, code));
    },
    me: () => web.request<User>('/auth/me'),
    profile: () => web.request<UserProfile>('/users/me'),
    updateProfile: (displayName: string, expectedVersion: number) =>
      web.request<UserProfile>('/users/me', { method: 'PATCH', body: json({ displayName, expectedVersion }), retryOnAuth: true }),
    auditLogs: (filters: AuditFilters = {}, cursor?: string) =>
      web.request<AuditPage>(`/admin/audit-logs?${new URLSearchParams({ ...filters, ...(cursor ? { cursor } : {}) })}`),
    mapConfig: () => web.request<MapConfig>('/maps/config'),
    searchPlaces: (q: string) => web.request<MapSearch>(`/maps/search?${new URLSearchParams({ q })}`),
    reversePlace: (position: Coordinate) =>
      web.request<{ item: MapPlace; requestedPosition: Coordinate; provider: 'nominatim' }>(`/maps/reverse?${new URLSearchParams({ longitude: String(position.longitude), latitude: String(position.latitude) })}`),
    mapRoute: (pickup: Coordinate, dropoff: Coordinate) =>
      web.request<MapRoute>(`/maps/route?${new URLSearchParams({ pickupLng: String(pickup.longitude), pickupLat: String(pickup.latitude), dropoffLng: String(dropoff.longitude), dropoffLat: String(dropoff.latitude) })}`),
    logout: web.logout,
    driverProfile: () => web.request<DriverProfile | null>('/drivers/me'),
    driverDocuments: () => web.request<DriverDocuments>('/drivers/me/documents'),
    adminDriverDocuments: (id: string) => web.request<DriverDocuments>(`/admin/drivers/${id}/documents`),
    documentContent: (id: string) => web.request<Blob>(`/driver-documents/${id}/content`, { responseType: 'blob' }),
    uploadDriverDocument: (kind: DocumentKind, expectedUpdatedAt: string, file: Blob | { uri: string; name: string; type: string }) => {
      const body = new FormData(); body.append('kind', kind); body.append('expectedUpdatedAt', expectedUpdatedAt); body.append('file', file as Blob);
      return web.request<DocumentUpload>('/drivers/me/documents', { method: 'POST', body });
    },
    submitDriver: (vehiclePlate: string, vehicleType: string) =>
      web.request<DriverProfile>('/drivers/me', { method: 'POST', body: json({ vehiclePlate, vehicleType }) }),
    drivers: (page: number, status = '') => web.request<Page<DriverReviewItem>>(`/admin/drivers?page=${page}${status ? `&status=${status}` : ''}`),
    reopenDriver: (id: string, expectedUpdatedAt: string, reason: string) =>
      web.request<DriverProfile>(`/admin/drivers/${id}/reopen`, { method: 'POST', body: json({ expectedUpdatedAt, reason }), retryOnAuth: true }),
    reviewDriver: (id: string, status: 'approved' | 'rejected', expectedUpdatedAt: string, reason?: string) =>
      web.request<DriverProfile>(`/admin/drivers/${id}/review`, { method: 'PATCH', body: json({ status, expectedUpdatedAt, reason }), retryOnAuth: true }),
    adminOrders: (status: OrderStatus | '' = '') => web.request<{ items: Order[] }>(`/admin/orders${status ? `?status=${status}` : ''}`),
    cancelOrder: (id: string, expectedVersion: number, reason: string) =>
      web.request<Order>(`/admin/orders/${id}/cancel`, { method: 'POST', body: json({ expectedVersion, reason }), retryOnAuth: true }),
  };
  return Object.assign(adapter as ReturnType<typeof createApi>, {
    bootstrap: async () => asLegacySession(await web.bootstrap()),
    subscribeSessionInvalid: (listener: () => void) => { invalidListeners.add(listener); return () => invalidListeners.delete(listener); },
  });
}
