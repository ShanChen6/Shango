import { z } from 'zod';
import type { Config } from './config';

/** Pure order/dispatch policy for WEB-009. No I/O so it can be unit tested. */
export const ORDER_STATUSES = [
  'SEARCHING',
  'ASSIGNED',
  'AT_PICKUP',
  'PICKED_UP',
  'IN_TRANSIT',
  'DELIVERED',
  'CANCELLED',
  'EXPIRED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const ACTIVE_DRIVER_STATUSES = ['ASSIGNED', 'AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT'] as const;
export const TERMINAL_STATUSES = ['DELIVERED', 'CANCELLED', 'EXPIRED'] as const;

/** Only the assigned driver advances these, one step at a time (architecture.md state machine). */
export const DRIVER_NEXT: Partial<Record<OrderStatus, OrderStatus>> = {
  ASSIGNED: 'AT_PICKUP',
  AT_PICKUP: 'PICKED_UP',
  PICKED_UP: 'IN_TRANSIT',
  IN_TRANSIT: 'DELIVERED',
};

export function driverMayAdvance(from: OrderStatus, to: OrderStatus) {
  return DRIVER_NEXT[from] === to;
}

/** Pilot policy (no fees): customers cancel only while searching. */
export function customerMayCancel(status: OrderStatus) {
  return status === 'SEARCHING';
}

/** Staff may cancel before pickup; after PICKED_UP an exception workflow (PO) is required. */
export function staffMayCancel(status: OrderStatus) {
  return status === 'SEARCHING' || status === 'ASSIGNED' || status === 'AT_PICKUP';
}

export type VehicleType = 'motorcycle' | 'car';
export type Tariff = {
  version: string;
  vehicleType: VehicleType;
  baseVnd: number;
  perKmVnd: number;
};

export function tariffFor(
  config: Pick<
    Config,
    | 'TARIFF_VERSION'
    | 'TARIFF_MOTORCYCLE_BASE_VND'
    | 'TARIFF_MOTORCYCLE_PER_KM_VND'
    | 'TARIFF_CAR_BASE_VND'
    | 'TARIFF_CAR_PER_KM_VND'
  >,
  vehicleType: VehicleType,
): Tariff | null {
  const base =
    vehicleType === 'car' ? config.TARIFF_CAR_BASE_VND : config.TARIFF_MOTORCYCLE_BASE_VND;
  const perKm =
    vehicleType === 'car' ? config.TARIFF_CAR_PER_KM_VND : config.TARIFF_MOTORCYCLE_PER_KM_VND;
  if (!base || !perKm) return null;
  return { version: config.TARIFF_VERSION, vehicleType, baseVnd: base, perKmVnd: perKm };
}

/** Integer VND: base + per-km on route meters, rounded up to the next 1,000 VND. */
export function priceVnd(tariff: Tariff, distanceMeters: number) {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) throw new Error('Invalid distance');
  const meters = Math.ceil(distanceMeters);
  const raw = tariff.baseVnd + Math.ceil((meters * tariff.perKmVnd) / 1000);
  return Math.ceil(raw / 1000) * 1000;
}

const NO_CONTROL = /^[^\p{Cc}]*$/u;
export function normalizeContactPhone(value: string) {
  const compact = value.replace(/[\s().-]/g, '');
  if (/^0\d{9}$/.test(compact)) return `+84${compact.slice(1)}`;
  return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : null;
}

const positionSchema = z
  .object({
    longitude: z.number().finite().min(-180).max(180),
    latitude: z.number().finite().min(-90).max(90),
  })
  .strict();

export const stopSchema = z
  .object({
    position: positionSchema,
    address: z.string().trim().min(3).max(300).regex(NO_CONTROL),
    detail: z.string().trim().max(200).regex(NO_CONTROL).default(''),
    contactName: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(NO_CONTROL)
      .transform((value) => value.replace(/\s+/g, ' ')),
    contactPhone: z
      .string()
      .max(30)
      .transform((value, context) => {
        const phone = normalizeContactPhone(value);
        if (!phone) context.addIssue({ code: 'custom', message: 'Invalid contact phone' });
        return phone ?? '';
      }),
    note: z.string().trim().max(500).regex(NO_CONTROL).default(''),
  })
  .strict();
export type Stop = z.infer<typeof stopSchema>;

export const quoteRequestSchema = z
  .object({
    vehicleType: z.enum(['motorcycle', 'car']),
    pickup: stopSchema,
    dropoff: stopSchema,
  })
  .strict();

/** Location fix accepted from the driver while the page is in the foreground. */
export const locationFixSchema = z
  .object({
    longitude: z.number().finite().min(-180).max(180),
    latitude: z.number().finite().min(-90).max(90),
    accuracy: z.number().finite().min(0).max(5000),
    sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    recordedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type LocationFix = z.infer<typeof locationFixSchema>;

export const MAX_FIX_AGE_MS = 30_000;
export const MAX_FIX_FUTURE_MS = 5_000;
export const MAX_FIX_ACCURACY_M = 200;
export const PRESENCE_FRESH_SECONDS = 30;

export type FixVerdict = 'ok' | 'stale' | 'future' | 'inaccurate';
export function judgeFix(
  fix: Pick<LocationFix, 'accuracy' | 'recordedAt'>,
  now: number,
): FixVerdict {
  const at = Date.parse(fix.recordedAt);
  if (at > now + MAX_FIX_FUTURE_MS) return 'future';
  if (now - at > MAX_FIX_AGE_MS) return 'stale';
  if (fix.accuracy > MAX_FIX_ACCURACY_M) return 'inaccurate';
  return 'ok';
}
