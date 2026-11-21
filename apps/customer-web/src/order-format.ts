import type { Order, OrderStatus, QuoteRequest, VehicleType } from '@shango/contracts';
import type { DeliveryStop } from './delivery-draft';

export const statusLabels: Record<OrderStatus, string> = {
  SEARCHING: 'Đang tìm tài xế',
  ASSIGNED: 'Tài xế đang đến điểm lấy',
  AT_PICKUP: 'Tài xế đã đến điểm lấy',
  PICKED_UP: 'Đã lấy hàng',
  IN_TRANSIT: 'Đang giao',
  DELIVERED: 'Đã giao',
  CANCELLED: 'Đã hủy',
  EXPIRED: 'Không tìm được tài xế',
};
export const progressSteps: OrderStatus[] = [
  'SEARCHING',
  'ASSIGNED',
  'AT_PICKUP',
  'PICKED_UP',
  'IN_TRANSIT',
  'DELIVERED',
];
export const ACTIVE_STATUSES: OrderStatus[] = ['ASSIGNED', 'AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT'];
export const vehicleLabels: Record<VehicleType, string> = { motorcycle: 'Xe máy', car: 'Ô tô' };

const vnd = new Intl.NumberFormat('vi-VN');
export const formatVnd = (value: number) => `${vnd.format(value)} ₫`;
export const formatKm = (meters: number) => `${(meters / 1000).toFixed(1)} km`;
export const formatMinutes = (seconds: number) => `${Math.max(1, Math.ceil(seconds / 60))} phút`;

/** Maps the confirmed memory-only draft to the server contract; the server re-validates all of it. */
export function toQuoteRequest(
  stops: { pickup: DeliveryStop; dropoff: DeliveryStop },
  vehicleType: VehicleType,
): QuoteRequest {
  const map = (stop: DeliveryStop) => ({
    position: stop.position!,
    address: stop.label.trim(),
    detail: stop.addressDetails.trim(),
    contactName: stop.contactName,
    contactPhone: stop.contactPhone,
    note: stop.note.trim(),
  });
  return { vehicleType, pickup: map(stops.pickup), dropoff: map(stops.dropoff) };
}

/** Never let an older snapshot overwrite a newer one (events and refetches can race). */
export function newerOrder(current: Order | undefined, next: Order) {
  return !current || next.version >= current.version ? next : current;
}

export function ageSeconds(iso: string | null | undefined, now: number) {
  if (!iso) return null;
  return Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
}
