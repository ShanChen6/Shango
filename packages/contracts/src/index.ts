export type Role = 'customer' | 'driver' | 'admin' | 'dispatcher' | 'accountant';
export type PublicRole = Extract<Role, 'customer' | 'driver'>;
export interface User {
  id: string;
  phone: string;
  role: Role;
  displayName: string | null;
}
export interface Session {
  accessToken: string;
  refreshToken: string;
  user: User;
}
export interface UserProfile extends User {
  version: number;
  updatedAt: string;
}
export type AuditAction = 'user.profile.updated' | 'driver.review' | 'admin.bootstrap';
export interface AuditEntry {
  id: string;
  actorId: string;
  actorDisplayName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}
export interface AuditFilters {
  action?: AuditAction;
  actorId?: string;
  entityId?: string;
  from?: string;
  to?: string;
}
export interface AuditPage {
  items: AuditEntry[];
  nextCursor: string | null;
}
export interface OtpRequest {
  phone: string;
  role: PublicRole;
}
export interface OtpChallenge {
  expiresIn: number;
  devCode?: string;
}
export type DriverStatus = 'pending' | 'approved' | 'rejected';
export interface DriverProfile {
  userId: string;
  vehiclePlate: string;
  vehicleType: string;
  status: DriverStatus;
  rejectionReason: string | null;
  updatedAt: string;
}
export interface DriverReviewItem extends DriverProfile {
  phone: string;
  displayName: string | null;
}
export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
export type OrderStatus =
  | 'SEARCHING'
  | 'ASSIGNED'
  | 'AT_PICKUP'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'EXPIRED';
export interface Coordinate {
  longitude: number;
  latitude: number;
}
export interface TrackingUpdate {
  orderId: string;
  position: Coordinate;
  sequence: number;
  recordedAt: string;
}
export interface MapPlace {
  id: string;
  label: string;
  position: Coordinate;
}
export interface MapSearch {
  items: MapPlace[];
  provider: 'nominatim';
}
export interface MapConfig {
  region: {
    id: string;
    name: string;
    bounds: { west: number; south: number; east: number; north: number };
    center: Coordinate;
  };
  geocodingConfigured: boolean;
  routingConfigured: boolean;
  searchMode: 'submit-only';
  attribution: string;
  attributionUrl: string;
  routingProfile: 'driving-unverified-for-motorcycles';
}
export interface MapRoute {
  distanceMeters: number;
  durationSeconds: number;
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  provider: 'osrm';
  profile: 'driving';
  motorcycleValidated: false;
}
