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
export type AuditAction =
  | 'user.profile.updated'
  | 'driver.review'
  | 'admin.bootstrap'
  | 'driver.document.uploaded'
  | 'driver.document.viewed'
  | 'driver.review.reopened';
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
export type DocumentKind =
  'identity_front' | 'identity_back' | 'driver_license' | 'vehicle_registration';
export interface DriverDocument {
  id: string;
  driverId: string;
  kind: DocumentKind;
  contentType: 'image/jpeg';
  byteSize: number;
  createdAt: string;
}
export interface DriverDocuments {
  items: DriverDocument[];
  profile: DriverProfile;
  requiredKinds: DocumentKind[];
  viewedIds: string[];
}
export interface DocumentUpload {
  document: DriverDocument;
  profile: DriverProfile;
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

// ----- WEB-009 orders, dispatch and realtime -----
export type VehicleType = 'motorcycle' | 'car';
export interface OrderStopInput {
  position: Coordinate;
  address: string;
  detail?: string;
  contactName: string;
  contactPhone: string;
  note?: string;
}
export interface OrderStop extends OrderStopInput {
  detail: string;
  note: string;
}
export interface QuoteRequest {
  vehicleType: VehicleType;
  pickup: OrderStopInput;
  dropoff: OrderStopInput;
}
export interface Quote {
  id: string;
  vehicleType: VehicleType;
  distanceMeters: number;
  durationSeconds: number;
  /** Integer VND. */
  priceVnd: number;
  tariffVersion: string;
  /** Pilot tariffs are not PO-approved pricing. */
  pricingApproved: false;
  expiresAt: string;
  routeGeometry: MapRoute['geometry'];
}
export interface OrderDriver {
  id: string;
  displayName: string | null;
  vehiclePlate: string;
  vehicleType: VehicleType;
}
export interface DriverLastLocation extends Coordinate {
  accuracy: number | null;
  recordedAt: string | null;
  lastSeenAt: string;
}
export interface Order {
  id: string;
  status: OrderStatus;
  version: number;
  vehicleType: VehicleType;
  stops: { pickup: OrderStop; dropoff: OrderStop };
  distanceMeters: number;
  durationSeconds: number;
  priceVnd: number;
  tariffVersion: string;
  searchDeadline: string;
  cancelReason: string | null;
  customerId: string;
  driverId: string | null;
  createdAt: string;
  updatedAt: string;
  driver: OrderDriver | null;
  driverLocation: DriverLastLocation | null;
}
export interface DriverOffer {
  id: string;
  orderId: string;
  expiresAt: string;
  pickupDistanceMeters: number;
  vehicleType: VehicleType;
  distanceMeters: number;
  durationSeconds: number;
  priceVnd: number;
  pickup: { address: string };
  dropoff: { address: string };
}
export interface DriverPresence {
  available: boolean;
  lastSeenAt: string | null;
  accuracy: number | null;
  fresh: boolean;
}
export interface LocationFix extends Coordinate {
  accuracy: number;
  sequence: number;
  recordedAt: string;
}
export type LocationResult = { accepted: true } | { accepted: false; reason: string };
export interface OrderUpdatedEvent {
  eventId: string;
  orderId: string;
  version: number;
  status: OrderStatus;
}
export interface OfferUpdatedEvent {
  eventId: string;
  offerId: string;
  orderId: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired' | 'withdrawn';
}
export interface OrderLocationEvent extends Coordinate {
  orderId: string;
  accuracy: number;
  recordedAt: string;
}
export interface OrderEvent {
  version: number;
  status: OrderStatus;
  at: string;
  reason: string | null;
  actor: 'customer' | 'driver' | 'staff' | 'system';
  /** Only returned to admin/dispatcher. */
  actorId?: string | null;
}

/** SG-015: GeoJSON coordinates are [longitude, latitude]. */
export type AreaGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };
export interface ServiceArea {
  id: string;
  code: string;
  name: string;
  active: boolean;
  version: number;
  geometry: AreaGeometry;
  areaKm2: number;
  vertices: number;
  updatedAt: string;
  updatedBy: string | null;
}
export interface ServiceAreaVersion {
  version: number;
  name: string;
  active: boolean;
  vertices: number;
  areaKm2: number;
  changedAt: string;
  changedBy: string | null;
}
export interface ServiceAreaUpdate {
  name: string;
  active: boolean;
  geometry: AreaGeometry;
  expectedVersion: number;
}
export interface ActiveServiceArea {
  id: string;
  name: string;
  version: number;
  geometry: AreaGeometry;
}
