import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createHmac, randomInt } from 'node:crypto';
import { AppModule } from '../src/app';
import { Cache, Database } from '../src/database';
import { configureHttp } from '../src/http';
import { loadConfig } from '../src/config';
import { REFRESH_COOKIE } from '../src/web-auth-policy';

// Dedicated migrated test DB/Redis only. Creates and removes its own fixtures.
const ORIGIN = 'http://localhost:5173';

type Call = {
  method?: string;
  body?: unknown;
  cookie?: string;
  csrf?: string;
  origin?: string | null;
  bearer?: string;
};

describe('web cookie auth integration (ADR-002)', () => {
  let app: INestApplication;
  let database: Database;
  let cache: Cache;
  let base: string;
  const phones: string[] = [];
  const previous = { enabled: process.env.WEB_AUTH_ENABLED, secret: process.env.CSRF_SECRET };

  beforeAll(async () => {
    if (process.env.NODE_ENV !== 'test')
      throw new Error('Set NODE_ENV=test with dedicated test DB/Redis');
    process.env.WEB_AUTH_ENABLED = 'true';
    process.env.CSRF_SECRET ??= 'ci-only-csrf-secret-not-for-production-777777';
    if (
      !loadConfig()
        .CORS_ORIGINS.split(',')
        .map((v) => v.trim())
        .includes(ORIGIN)
    )
      throw new Error(`CORS_ORIGINS must include ${ORIGIN} for this suite`);
    app = await NestFactory.create(AppModule, { logger: false });
    configureHttp(app, loadConfig());
    await app.listen(0, '127.0.0.1');
    base = `${await app.getUrl()}/api/v1`;
    database = app.get(Database);
    cache = app.get(Cache);
  });

  afterAll(async () => {
    if (database && phones.length) {
      const ids = (
        await database.pool.query<{ id: string }>('SELECT id FROM users WHERE phone = ANY($1)', [
          phones,
        ])
      ).rows.map((row) => row.id);
      if (ids.length) {
        await database.pool.query(
          'DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[]) OR entity_id = ANY($1::uuid[])',
          [ids],
        );
        await database.pool.query('DELETE FROM auth_sessions WHERE user_id = ANY($1::uuid[])', [
          ids,
        ]);
        await database.pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
      }
    }
    if (cache) {
      const digest = (value: string) =>
        createHmac('sha256', process.env.OTP_SECRET!).update(value).digest('hex');
      const keys = phones.flatMap((phone) => [
        `otp:phone:${digest(phone)}`,
        `otp:cooldown:${digest(phone)}`,
        `otp:challenge:${digest(phone)}`,
      ]);
      keys.push(`otp:ip:${digest('127.0.0.1')}`, `otp:verify:ip:${digest('127.0.0.1')}`);
      await cache.redis.del(...keys);
    }
    if (app) await app.close();
    if (previous.enabled === undefined) delete process.env.WEB_AUTH_ENABLED;
    else process.env.WEB_AUTH_ENABLED = previous.enabled;
    if (previous.secret === undefined) delete process.env.CSRF_SECRET;
  });

  async function call(path: string, options: Call = {}) {
    const origin = options.origin === undefined ? ORIGIN : options.origin;
    const response = await fetch(`${base}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(origin ? { Origin: origin } : {}),
        ...(options.cookie ? { Cookie: `${REFRESH_COOKIE}=${options.cookie}` } : {}),
        ...(options.csrf ? { 'X-CSRF-Token': options.csrf } : {}),
        ...(options.bearer ? { Authorization: `Bearer ${options.bearer}` } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const setCookies = response.headers.getSetCookie();
    const refresh = setCookies.find((value) => value.startsWith(`${REFRESH_COOKIE}=`));
    const cookie = refresh?.slice(REFRESH_COOKIE.length + 1).split(';')[0] ?? null;
    return {
      status: response.status,
      headers: response.headers,
      setCookie: refresh ?? null,
      cookie,
      data: response.status === 204 ? null : await response.json().catch(() => null),
    };
  }

  function newPhone() {
    const phone = `+849${randomInt(10000000, 99999999)}`;
    phones.push(phone);
    return phone;
  }

  async function signIn(app: 'customer' | 'driver' | 'admin', phone = newPhone()) {
    const challenge = await call('/auth/web/otp/request', { method: 'POST', body: { phone, app } });
    expect(challenge.status).toBe(200);
    const verified = await call('/auth/web/otp/verify', {
      method: 'POST',
      body: { phone, code: challenge.data.devCode, app },
    });
    return { ...verified, phone };
  }

  it('creates a web session with a host-only HttpOnly cookie and no refresh token in JSON', async () => {
    const session = await signIn('customer');
    expect(session.status).toBe(200);
    expect(session.data.user.role).toBe('customer');
    expect(Object.keys(session.data).sort()).toEqual(['accessToken', 'csrfToken', 'user']);
    expect(JSON.stringify(session.data)).not.toContain(session.cookie!);
    expect(session.setCookie).toMatch(
      /; Max-Age=2592000; Path=\/; Secure; HttpOnly; SameSite=Lax$/,
    );
    expect(session.setCookie).not.toMatch(/Domain=/i);
    expect(session.headers.get('cache-control')).toBe('no-store');
    expect(
      (await call('/auth/me', { bearer: session.data.accessToken, origin: null })).status,
    ).toBe(200);
    const csrf = await call('/auth/web/csrf', { cookie: session.cookie!, origin: null });
    expect(csrf).toMatchObject({ status: 200, data: { csrfToken: session.data.csrfToken } });
  });

  it('rotates on refresh, rejects missing/foreign CSRF without side effects and allows one concurrent winner', async () => {
    const first = await signIn('driver');
    const other = await signIn('customer');
    const cookie = first.cookie!;
    expect((await call('/auth/web/refresh', { method: 'POST', cookie })).status).toBe(403);
    expect(
      (await call('/auth/web/refresh', { method: 'POST', cookie, csrf: other.data.csrfToken }))
        .status,
    ).toBe(403);
    expect((await call('/auth/web/csrf', { cookie })).status).toBe(200);

    const rotated = await call('/auth/web/refresh', {
      method: 'POST',
      cookie,
      csrf: first.data.csrfToken,
    });
    expect(rotated.status).toBe(200);
    expect(rotated.cookie).not.toBe(cookie);
    expect(rotated.data.user.role).toBe('driver');
    expect(rotated.setCookie).toMatch(/HttpOnly; SameSite=Lax$/);
    expect(
      (await call('/auth/web/refresh', { method: 'POST', cookie, csrf: first.data.csrfToken }))
        .status,
    ).toBe(401);

    const race = await Promise.all([
      call('/auth/web/refresh', {
        method: 'POST',
        cookie: rotated.cookie!,
        csrf: rotated.data.csrfToken,
      }),
      call('/auth/web/refresh', {
        method: 'POST',
        cookie: rotated.cookie!,
        csrf: rotated.data.csrfToken,
      }),
    ]);
    expect(race.map((value) => value.status).sort()).toEqual([200, 401]);
    expect(race.find((value) => value.status === 401)!.setCookie).toBeNull();
  });

  it('logout validates CSRF before revoking, then clears the cookie and access', async () => {
    const session = await signIn('customer');
    const cookie = session.cookie!;
    const rejected = await call('/auth/web/logout', { method: 'POST', cookie, csrf: 'wrong' });
    expect(rejected.status).toBe(403);
    expect(rejected.setCookie).toBeNull();
    expect((await call('/auth/web/csrf', { cookie })).status).toBe(200);

    const done = await call('/auth/web/logout', {
      method: 'POST',
      cookie,
      csrf: session.data.csrfToken,
    });
    expect(done.status).toBe(204);
    expect(done.setCookie).toBe(
      `${REFRESH_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`,
    );
    expect(
      (await call('/auth/me', { bearer: session.data.accessToken, origin: null })).status,
    ).toBe(401);
    expect((await call('/auth/web/csrf', { cookie })).status).toBe(401);
    const again = await call('/auth/web/logout', { method: 'POST', cookie });
    expect(again.status).toBe(204);
    expect(again.setCookie).toContain('Max-Age=0');
  });

  it('enforces exact Origin and credentialed CORS', async () => {
    const phone = newPhone();
    for (const origin of [
      null,
      'null',
      'http://evil.localhost:5173',
      'http://localhost:5173.evil.vn',
      'https://localhost:5173',
    ])
      expect(
        (
          await call('/auth/web/otp/request', {
            method: 'POST',
            body: { phone, app: 'customer' },
            origin,
          })
        ).status,
        String(origin),
      ).toBe(403);
    const preflight = await fetch(`${base}/auth/web/refresh`, {
      method: 'OPTIONS',
      headers: {
        Origin: ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'x-csrf-token',
      },
    });
    expect(preflight.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(preflight.headers.get('access-control-allow-credentials')).toBe('true');
    const evil = await fetch(`${base}/auth/web/csrf`, {
      headers: { Origin: 'https://evil.example' },
    });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
    expect(evil.status).toBe(403);
  });

  it('rejects mixed credentials and keeps legacy/web transports isolated', async () => {
    const web = await signIn('customer');
    const legacyPhone = newPhone();
    const legacyChallenge = await call('/auth/otp/request', {
      method: 'POST',
      body: { phone: legacyPhone, role: 'customer' },
      origin: null,
    });
    const legacy = await call('/auth/otp/verify', {
      method: 'POST',
      body: { phone: legacyPhone, code: legacyChallenge.data.devCode },
      origin: null,
    });
    expect(legacy.status).toBe(200);

    const legacyWithCookie = await fetch(`${base}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `${REFRESH_COOKIE}=${web.cookie}` },
      body: JSON.stringify({ refreshToken: legacy.data.refreshToken }),
    });
    expect(legacyWithCookie.status).toBe(400);
    expect(
      (
        await call('/auth/refresh', {
          method: 'POST',
          body: { refreshToken: web.cookie },
          origin: null,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await call('/auth/web/refresh', {
          method: 'POST',
          cookie: web.cookie!,
          csrf: web.data.csrfToken,
          bearer: web.data.accessToken,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call('/auth/web/refresh', {
          method: 'POST',
          cookie: web.cookie!,
          csrf: web.data.csrfToken,
          body: { refreshToken: legacy.data.refreshToken },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call('/auth/web/refresh', {
          method: 'POST',
          cookie: legacy.data.refreshToken,
          csrf: web.data.csrfToken,
        })
      ).status,
    ).toBe(401);

    // A web challenge cannot be redeemed on the legacy endpoint and vice versa.
    const crossPhone = newPhone();
    const webChallenge = await call('/auth/web/otp/request', {
      method: 'POST',
      body: { phone: crossPhone, app: 'driver' },
    });
    expect(
      (
        await call('/auth/otp/verify', {
          method: 'POST',
          body: { phone: crossPhone, code: webChallenge.data.devCode },
          origin: null,
        })
      ).status,
    ).toBe(401);
  });

  it('derives roles from app, blocks wrong-app logins before any session and never registers Admin', async () => {
    const driver = await signIn('driver');
    const before = await database.pool.query(
      'SELECT count(*)::int AS n FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE u.phone = $1',
      [driver.phone],
    );
    await cache.redis.del(
      `otp:cooldown:${createHmac('sha256', process.env.OTP_SECRET!).update(driver.phone).digest('hex')}`,
    );
    const wrongApp = await signIn('customer', driver.phone);
    expect(wrongApp.status).toBe(401);
    expect(wrongApp.setCookie).toBeNull();
    const after = await database.pool.query(
      'SELECT count(*)::int AS n FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE u.phone = $1',
      [driver.phone],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);

    const stranger = newPhone();
    const adminChallenge = await call('/auth/web/otp/request', {
      method: 'POST',
      body: { phone: stranger, app: 'admin' },
    });
    expect(adminChallenge.status).toBe(200);
    const adminAttempt = await call('/auth/web/otp/verify', {
      method: 'POST',
      body: { phone: stranger, code: adminChallenge.data.devCode, app: 'admin' },
    });
    expect(adminAttempt.status).toBe(401);
    expect(adminAttempt.data.message).toBe(wrongApp.data.message);
    expect(
      (await database.pool.query('SELECT 1 FROM users WHERE phone = $1', [stranger])).rowCount,
    ).toBe(0);

    const staffPhone = newPhone();
    await database.pool.query(`INSERT INTO users (phone, role) VALUES ($1, 'dispatcher')`, [
      staffPhone,
    ]);
    const staff = await signIn('admin', staffPhone);
    expect(staff.status).toBe(200);
    expect(staff.data.user.role).toBe('dispatcher');
    expect(
      (
        await call('/auth/web/otp/request', {
          method: 'POST',
          body: { phone: newPhone(), app: 'driver', role: 'admin' },
        })
      ).status,
    ).toBe(400);
  });

  it('refuses refresh after the account is blocked', async () => {
    const session = await signIn('customer');
    await database.pool.query(`UPDATE users SET status = 'blocked' WHERE phone = $1`, [
      session.phone,
    ]);
    expect(
      (
        await call('/auth/web/refresh', {
          method: 'POST',
          cookie: session.cookie!,
          csrf: session.data.csrfToken,
        })
      ).status,
    ).toBe(401);
  });

  it('returns 503 and clears the cookie when the flag is off, without touching legacy auth', async () => {
    process.env.WEB_AUTH_ENABLED = 'false';
    try {
      const disabled = await call('/auth/web/csrf', { cookie: 'x'.repeat(64) });
      expect(disabled.status).toBe(503);
      expect(disabled.setCookie).toContain('Max-Age=0');
      expect((await call('/health/live', { origin: null })).status).toBe(200);
    } finally {
      process.env.WEB_AUTH_ENABLED = 'true';
    }
  });
});
