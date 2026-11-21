import { describe, expect, it } from 'vitest';
import {
  customerMayCancel,
  driverMayAdvance,
  judgeFix,
  normalizeContactPhone,
  ORDER_STATUSES,
  priceVnd,
  quoteRequestSchema,
  staffMayCancel,
  tariffFor,
} from '../src/orders-policy';
import { environmentSchema } from '../src/config';

const env = {
  DATABASE_URL: 'postgresql://localhost/shango',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'a'.repeat(40),
  OTP_SECRET: 'b'.repeat(40),
  OTP_PROVIDER: 'development',
  CORS_ORIGINS: 'http://localhost:5173',
};
const stop = {
  position: { longitude: 105.852, latitude: 21.028 },
  address: 'Hồ Hoàn Kiếm, Hà Nội',
  contactName: '  Nguyễn   An ',
  contactPhone: '090 123 4567',
};

describe('order state machine', () => {
  it('lets the driver advance exactly one step at a time', () => {
    expect(driverMayAdvance('ASSIGNED', 'AT_PICKUP')).toBe(true);
    expect(driverMayAdvance('AT_PICKUP', 'PICKED_UP')).toBe(true);
    expect(driverMayAdvance('PICKED_UP', 'IN_TRANSIT')).toBe(true);
    expect(driverMayAdvance('IN_TRANSIT', 'DELIVERED')).toBe(true);
    expect(driverMayAdvance('ASSIGNED', 'DELIVERED')).toBe(false);
    expect(driverMayAdvance('SEARCHING', 'ASSIGNED')).toBe(false);
    expect(driverMayAdvance('DELIVERED', 'IN_TRANSIT')).toBe(false);
    expect(driverMayAdvance('PICKED_UP', 'CANCELLED')).toBe(false);
  });
  it('limits cancellation: customer only while searching, staff until pickup', () => {
    expect(ORDER_STATUSES.filter(customerMayCancel)).toEqual(['SEARCHING']);
    expect(ORDER_STATUSES.filter(staffMayCancel)).toEqual(['SEARCHING', 'ASSIGNED', 'AT_PICKUP']);
  });
});

describe('pilot tariff', () => {
  it('needs both base and per-km for the vehicle type', () => {
    const config = environmentSchema.parse({
      ...env,
      TARIFF_MOTORCYCLE_BASE_VND: '15000',
      TARIFF_MOTORCYCLE_PER_KM_VND: '5000',
    });
    expect(tariffFor(config, 'motorcycle')).toEqual({
      version: 'pilot-unapproved',
      vehicleType: 'motorcycle',
      baseVnd: 15000,
      perKmVnd: 5000,
    });
    expect(tariffFor(config, 'car')).toBeNull();
  });
  it('prices in integer VND rounded up to 1,000', () => {
    const tariff = {
      version: 't',
      vehicleType: 'motorcycle' as const,
      baseVnd: 15000,
      perKmVnd: 5000,
    };
    expect(priceVnd(tariff, 3200)).toBe(31000);
    expect(priceVnd(tariff, 3201)).toBe(32000);
    expect(priceVnd(tariff, 0.4)).toBe(16000);
    expect(Number.isInteger(priceVnd(tariff, 12345.6))).toBe(true);
    expect(() => priceVnd(tariff, 0)).toThrow();
    expect(() => priceVnd(tariff, Number.NaN)).toThrow();
  });
  it('rejects malformed tariff configuration', () => {
    expect(environmentSchema.safeParse({ ...env, TARIFF_CAR_BASE_VND: '-1' }).success).toBe(false);
    expect(environmentSchema.safeParse({ ...env, TARIFF_CAR_PER_KM_VND: '1.5' }).success).toBe(
      false,
    );
    expect(environmentSchema.parse(env).ORDERS_ENABLED).toBe('false');
  });
});

describe('quote input validation', () => {
  it('normalizes contacts and strips nothing unexpected', () => {
    const parsed = quoteRequestSchema.parse({
      vehicleType: 'motorcycle',
      pickup: stop,
      dropoff: stop,
    });
    expect(parsed.pickup).toMatchObject({
      contactName: 'Nguyễn An',
      contactPhone: '+84901234567',
      detail: '',
      note: '',
    });
  });
  it('rejects bad phones, control characters, unknown fields and non-finite coordinates', () => {
    const bad = [
      { ...stop, contactPhone: '12345' },
      { ...stop, address: 'Hà Nội\u0007' },
      { ...stop, confirmed: true },
      { ...stop, position: { longitude: Number.POSITIVE_INFINITY, latitude: 21 } },
    ];
    for (const pickup of bad)
      expect(
        quoteRequestSchema.safeParse({ vehicleType: 'motorcycle', pickup, dropoff: stop }).success,
      ).toBe(false);
    expect(normalizeContactPhone('+1 (415) 555-0123')).toBe('+14155550123');
  });
});

describe('GPS fix validation', () => {
  const now = Date.parse('2026-11-21T10:00:00Z');
  it('accepts recent, accurate fixes', () => {
    expect(judgeFix({ accuracy: 15, recordedAt: '2026-11-21T09:59:55Z' }, now)).toBe('ok');
  });
  it('rejects stale, future and inaccurate fixes', () => {
    expect(judgeFix({ accuracy: 15, recordedAt: '2026-11-21T09:59:29Z' }, now)).toBe('stale');
    expect(judgeFix({ accuracy: 15, recordedAt: '2026-11-21T10:00:06Z' }, now)).toBe('future');
    expect(judgeFix({ accuracy: 201, recordedAt: '2026-11-21T10:00:00Z' }, now)).toBe('inaccurate');
  });
});
