import type { Order } from '@shango/contracts';

/** Operational thresholds for the Admin exception view (WEB-002 hypotheses, not PO policy). */
export const SEARCHING_TOO_LONG_SECONDS = 120;
export const DRIVER_GPS_STALE_SECONDS = 60;

export type OrderException =
  | { kind: 'searching-long'; seconds: number }
  | { kind: 'search-ending'; seconds: number }
  | { kind: 'gps-stale'; seconds: number }
  | { kind: 'gps-missing' };

const ACTIVE = new Set(['ASSIGNED', 'AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT']);
const seconds = (from: string, now: number) =>
  Math.max(0, Math.round((now - Date.parse(from)) / 1000));

/** Exceptions an operator should look at; empty for healthy or finished orders. */
export function orderExceptions(order: Order, now: number): OrderException[] {
  const found: OrderException[] = [];
  if (order.status === 'SEARCHING') {
    const waited = seconds(order.createdAt, now);
    if (waited >= SEARCHING_TOO_LONG_SECONDS)
      found.push({ kind: 'searching-long', seconds: waited });
    const left = Math.round((Date.parse(order.searchDeadline) - now) / 1000);
    if (left > 0 && left <= 60) found.push({ kind: 'search-ending', seconds: left });
  }
  if (ACTIVE.has(order.status)) {
    if (!order.driverLocation) found.push({ kind: 'gps-missing' });
    else {
      const age = seconds(order.driverLocation.lastSeenAt, now);
      if (age >= DRIVER_GPS_STALE_SECONDS) found.push({ kind: 'gps-stale', seconds: age });
    }
  }
  return found;
}

export function exceptionLabel(exception: OrderException) {
  switch (exception.kind) {
    case 'searching-long':
      return `Tìm tài xế ${Math.floor(exception.seconds / 60)} phút`;
    case 'search-ending':
      return `Sắp hết hạn tìm (${exception.seconds}s)`;
    case 'gps-stale':
      return `GPS tài xế cũ ${exception.seconds}s`;
    case 'gps-missing':
      return 'Chưa có GPS tài xế';
  }
}

export function summarize(orders: Order[], now: number) {
  let searching = 0;
  let gps = 0;
  for (const order of orders) {
    const kinds = orderExceptions(order, now).map((item) => item.kind);
    if (kinds.includes('searching-long') || kinds.includes('search-ending')) searching += 1;
    if (kinds.includes('gps-stale') || kinds.includes('gps-missing')) gps += 1;
  }
  return { searching, gps };
}
