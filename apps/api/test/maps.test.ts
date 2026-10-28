import { describe, expect, it } from 'vitest';
import { environmentSchema } from '../src/config';
import { insideHanoi } from '../src/maps';

const environment = {
  DATABASE_URL: 'postgresql://localhost/shango',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'a'.repeat(40),
  OTP_SECRET: 'b'.repeat(40),
  OTP_PROVIDER: 'development',
  CORS_ORIGINS: 'http://localhost:5173',
};
describe('map provider configuration', () => {
  it('requires explicit opt-in for the public geocoder', () => {
    const input = { ...environment, NOMINATIM_BASE_URL: 'https://nominatim.openstreetmap.org' };
    expect(environmentSchema.safeParse(input).success).toBe(false);
    expect(environmentSchema.safeParse({ ...input, NOMINATIM_PUBLIC_OPT_IN: 'true' }).success).toBe(
      true,
    );
  });
  it('rejects non-http URLs, credentials, invalid URLs and the public routing demo', () => {
    for (const url of [
      'not-a-url',
      'file:///tmp/maps',
      'https://secret:password@maps.example',
      'https://maps.example?q=secret',
    ]) {
      expect(environmentSchema.safeParse({ ...environment, NOMINATIM_BASE_URL: url }).success).toBe(
        false,
      );
    }
    expect(
      environmentSchema.safeParse({
        ...environment,
        OSRM_BASE_URL: 'https://router.project-osrm.org',
      }).success,
    ).toBe(false);
  });
  it('accepts independently hosted providers without public opt-in', () => {
    expect(
      environmentSchema.safeParse({
        ...environment,
        NOMINATIM_BASE_URL: 'http://localhost:8088',
        OSRM_BASE_URL: 'http://localhost:5000',
      }).success,
    ).toBe(true);
  });
});
describe('Hanoi discovery rectangle', () => {
  it('accepts Hanoi points and rejects Ho Chi Minh City or swapped coordinates', () => {
    expect(insideHanoi({ longitude: 105.852, latitude: 21.028 })).toBe(true);
    expect(insideHanoi({ longitude: 106.7, latitude: 10.77 })).toBe(false);
    expect(insideHanoi({ longitude: 21.028, latitude: 105.852 })).toBe(false);
  });
});
