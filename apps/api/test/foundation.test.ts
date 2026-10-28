import { describe, expect, it } from 'vitest';
import { environmentSchema } from '../src/config';
import { opaqueHash } from '../src/auth';
import { parse, phoneSchema } from '../src/validation';

const environment = {
  DATABASE_URL: 'postgresql://localhost/shango',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'a'.repeat(40),
  OTP_SECRET: 'b'.repeat(40),
  OTP_PROVIDER: 'development',
  CORS_ORIGINS: 'http://localhost:5173',
};
describe('release safeguards', () => {
  it('refuses production until real SMS is implemented', () => {
    expect(environmentSchema.safeParse({ ...environment, NODE_ENV: 'production' }).success).toBe(
      false,
    );
  });
  it('rejects shared signing secrets', () => {
    expect(
      environmentSchema.safeParse({ ...environment, OTP_SECRET: environment.JWT_SECRET }).success,
    ).toBe(false);
  });
  it('does not expose input secrets in validation errors', () => {
    const parsed = environmentSchema.safeParse({ ...environment, JWT_SECRET: 'sensitive-value' });
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(JSON.stringify(parsed.error.issues)).not.toContain('sensitive-value');
  });
});
describe('authentication input', () => {
  it('requires canonical international phone numbers', () => {
    expect(parse(phoneSchema, '+84901234567')).toBe('+84901234567');
    for (const value of ['0901234567', '+0', '+84 901234567', "'+84901234567"])
      expect(() => parse(phoneSchema, value)).toThrow();
  });
  it('stores an irreversible digest of opaque session tokens', () => {
    const token = 'unique-test-session-token';
    expect(opaqueHash(token)).toHaveLength(64);
    expect(opaqueHash(token)).not.toContain(token);
  });
});
