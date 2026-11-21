import { describe, expect, it } from 'vitest';
import { environmentSchema } from '../src/config';
import { corsOptions } from '../src/http';
import {
  challengeMarker,
  clearRefreshCookie,
  csrfToken,
  csrfValid,
  originAllowed,
  parseAllowedOrigins,
  readCookie,
  REFRESH_COOKIE,
  refreshCookie,
  registrationRole,
  roleAllowed,
} from '../src/web-auth-policy';

const environment = {
  DATABASE_URL: 'postgresql://localhost/shango',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'a'.repeat(40),
  OTP_SECRET: 'b'.repeat(40),
  OTP_PROVIDER: 'development',
  CORS_ORIGINS: 'http://localhost:5173',
};
const token = 'r'.repeat(64);

describe('web auth configuration', () => {
  it('is disabled by default and needs a dedicated CSRF secret when enabled', () => {
    const parsed = environmentSchema.parse(environment);
    expect(parsed.WEB_AUTH_ENABLED).toBe('false');
    expect(environmentSchema.safeParse({ ...environment, WEB_AUTH_ENABLED: 'true' }).success).toBe(
      false,
    );
    expect(
      environmentSchema.safeParse({
        ...environment,
        WEB_AUTH_ENABLED: 'true',
        CSRF_SECRET: environment.JWT_SECRET,
      }).success,
    ).toBe(false);
    expect(
      environmentSchema.safeParse({
        ...environment,
        WEB_AUTH_ENABLED: 'true',
        CSRF_SECRET: 'c'.repeat(40),
      }).success,
    ).toBe(true);
  });
  it('accepts only exact HTTPS origins, with plain HTTP limited to localhost', () => {
    expect(parseAllowedOrigins('https://customer.example.vn, http://127.0.0.1:5174')).toEqual([
      'https://customer.example.vn',
      'http://127.0.0.1:5174',
    ]);
    for (const bad of [
      '*',
      'https://*.example.vn',
      'null',
      'http://customer.example.vn',
      'https://customer.example.vn/',
      'https://customer.example.vn/app',
      'https://user:pass@customer.example.vn',
      'https://a.example.vn,https://a.example.vn',
      'not a url',
    ])
      expect(() => parseAllowedOrigins(bad), bad).toThrow();
    expect(environmentSchema.safeParse({ ...environment, CORS_ORIGINS: '*' }).success).toBe(false);
  });
  it('builds credentialed CORS with a minimal preflight surface', () => {
    const options = corsOptions({ CORS_ORIGINS: 'https://admin.example.vn' });
    expect(options).toMatchObject({ origin: ['https://admin.example.vn'], credentials: true });
    expect(options.allowedHeaders).toEqual(['Authorization', 'Content-Type', 'X-CSRF-Token']);
  });
});

describe('web auth origin policy', () => {
  const allowed = ['https://driver.example.vn'];
  it('matches exact origins only', () => {
    expect(originAllowed(allowed, 'https://driver.example.vn', true)).toBe(true);
    for (const origin of [
      'https://evil.driver.example.vn',
      'https://driver.example.vn.evil.vn',
      'null',
      'http://driver.example.vn',
    ])
      expect(originAllowed(allowed, origin, true)).toBe(false);
  });
  it('requires Origin on state-changing calls but tolerates same-origin GET', () => {
    expect(originAllowed(allowed, undefined, true)).toBe(false);
    expect(originAllowed(allowed, undefined, false)).toBe(true);
  });
});

describe('web auth cookie and CSRF', () => {
  it('uses a host-only secure cookie and clears it with identical attributes', () => {
    const set = refreshCookie(token, 2592000.7);
    expect(set).toBe(
      `${REFRESH_COOKIE}=${token}; Max-Age=2592000; Path=/; Secure; HttpOnly; SameSite=Lax`,
    );
    expect(set).not.toMatch(/Domain/i);
    expect(clearRefreshCookie()).toBe(
      `${REFRESH_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`,
    );
  });
  it('reads exactly one well-formed refresh cookie', () => {
    expect(readCookie(`a=1; ${REFRESH_COOKIE}=${token}`, REFRESH_COOKIE)).toBe(token);
    expect(readCookie(undefined, REFRESH_COOKIE)).toBeNull();
    expect(
      readCookie(`${REFRESH_COOKIE}=${token}; ${REFRESH_COOKIE}=${token}`, REFRESH_COOKIE),
    ).toBeNull();
    expect(readCookie(`${REFRESH_COOKIE}=short`, REFRESH_COOKIE)).toBeNull();
    expect(readCookie(`${REFRESH_COOKIE}=${'x'.repeat(40)};%00`, REFRESH_COOKIE)).toBe(
      'x'.repeat(40),
    );
  });
  it('binds CSRF tokens to a session and compares safely', () => {
    const secret = 'c'.repeat(40);
    const value = csrfToken(secret, 'session-a');
    expect(csrfValid(secret, 'session-a', value)).toBe(true);
    expect(csrfValid(secret, 'session-b', value)).toBe(false);
    expect(csrfValid('d'.repeat(40), 'session-a', value)).toBe(false);
    for (const bad of [undefined, '', value.slice(1), ['x'], 'x'.repeat(500)])
      expect(csrfValid(secret, 'session-a', bad)).toBe(false);
  });
});

describe('web auth app/role mapping', () => {
  it('derives public registration from app and never registers Admin', () => {
    expect(registrationRole('customer')).toBe('customer');
    expect(registrationRole('driver')).toBe('driver');
    expect(registrationRole('admin')).toBeNull();
  });
  it('isolates roles per app', () => {
    expect(roleAllowed('customer', 'customer')).toBe(true);
    expect(roleAllowed('customer', 'driver')).toBe(false);
    expect(roleAllowed('driver', 'admin')).toBe(false);
    for (const role of ['admin', 'dispatcher', 'accountant'])
      expect(roleAllowed('admin', role)).toBe(true);
    expect(roleAllowed('admin', 'customer')).toBe(false);
  });
  it('keeps web challenge markers distinct from legacy public roles', () => {
    expect(challengeMarker('customer')).toBe('web:customer');
    expect(['customer', 'driver']).not.toContain(challengeMarker('driver'));
  });
});
