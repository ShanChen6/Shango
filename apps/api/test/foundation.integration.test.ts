import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomInt } from 'node:crypto';
import { AppModule } from '../src/app';
import { Database, Cache } from '../src/database';

// Use a dedicated migrated test database and Redis DB. Never runs as part of unit tests.
describe('foundation integration', () => {
  let app: INestApplication;
  let database: Database;
  let cache: Cache;
  let base: string;
  const ids: string[] = [];
  const phones: string[] = [];
  beforeAll(async () => {
    if (process.env.NODE_ENV !== 'test')
      throw new Error('Set NODE_ENV=test with dedicated test DB/Redis');
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api/v1');
    await app.listen(0, '127.0.0.1');
    base = `${await app.getUrl()}/api/v1`;
    database = app.get(Database);
    cache = app.get(Cache);
  });
  afterAll(async () => {
    if (database && ids.length) {
      await database.pool.query(
        'DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[]) OR entity_id = ANY($1::uuid[])',
        [ids],
      );
      await database.pool.query('DELETE FROM driver_locations WHERE driver_id = ANY($1::uuid[])', [
        ids,
      ]);
      await database.pool.query('DELETE FROM driver_profiles WHERE user_id = ANY($1::uuid[])', [
        ids,
      ]);
      await database.pool.query('DELETE FROM auth_sessions WHERE user_id = ANY($1::uuid[])', [ids]);
      await database.pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
    }
    if (cache) {
      // Remove only keys created for test identities, not other Redis data.
      const { createHmac } = await import('node:crypto');
      const digest = (value: string) =>
        createHmac('sha256', process.env.OTP_SECRET!).update(value).digest('hex');
      const keys = phones.flatMap((phone) => [
        `otp:phone:${digest(phone)}`,
        `otp:cooldown:${digest(phone)}`,
        `otp:challenge:${digest(phone)}`,
      ]);
      keys.push(`otp:ip:${digest('127.0.0.1')}`, `otp:verify:ip:${digest('127.0.0.1')}`);
      if (keys.length) await cache.redis.del(...keys);
    }
    if (app) await app.close();
  });
  async function call(path: string, method = 'GET', body?: unknown, token?: string) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      data: response.status === 204 ? null : await response.json(),
    };
  }
  async function signIn(role: 'driver' | 'customer') {
    const phone = `+849${randomInt(10000000, 99999999)}`;
    phones.push(phone);
    const challenge = await call('/auth/otp/request', 'POST', { phone, role });
    expect(challenge.status).toBe(200);
    const result = await call('/auth/otp/verify', 'POST', { phone, code: challenge.data.devCode });
    expect(result.status).toBe(200);
    ids.push(result.data.user.id);
    return { ...result.data, phone, code: challenge.data.devCode };
  }
  it('reports dependency readiness', async () => {
    expect((await call('/health/ready')).status).toBe(200);
  });
  it('consumes OTP once, rotates refresh once and revokes access on logout', async () => {
    const session = await signIn('customer');
    expect(
      (await call('/auth/otp/verify', 'POST', { phone: session.phone, code: session.code })).status,
    ).toBe(401);
    const refreshed = await Promise.all([
      call('/auth/refresh', 'POST', { refreshToken: session.refreshToken }),
      call('/auth/refresh', 'POST', { refreshToken: session.refreshToken }),
    ]);
    expect(refreshed.map((value) => value.status).sort()).toEqual([200, 401]);
    const active = refreshed.find((value) => value.status === 200)!.data;
    expect((await call('/auth/me', 'GET', undefined, active.accessToken)).status).toBe(200);
    expect((await call('/auth/logout', 'POST', undefined, active.accessToken)).status).toBe(204);
    expect((await call('/auth/me', 'GET', undefined, active.accessToken)).status).toBe(401);
    expect(
      (await call('/auth/refresh', 'POST', { refreshToken: active.refreshToken })).status,
    ).toBe(401);
  });
  it('rejects elevated public registration and unauthorized admin access', async () => {
    expect(
      (await call('/auth/otp/request', 'POST', { phone: '+84901234567', role: 'admin' })).status,
    ).toBe(400);
    const session = await signIn('customer');
    expect((await call('/admin/drivers', 'GET', undefined, session.accessToken)).status).toBe(403);
    expect(
      (
        await call(
          '/drivers/me',
          'POST',
          { vehiclePlate: 'TEST-001', vehicleType: 'motorcycle' },
          session.accessToken,
        )
      ).status,
    ).toBe(403);
  });
  it('limits guesses and enforces request cooldown', async () => {
    const phone = `+849${randomInt(10000000, 99999999)}`;
    phones.push(phone);
    const challenge = await call('/auth/otp/request', 'POST', { phone, role: 'customer' });
    expect((await call('/auth/otp/request', 'POST', { phone, role: 'customer' })).status).toBe(429);
    for (let index = 0; index < 5; index++)
      expect((await call('/auth/otp/verify', 'POST', { phone, code: '000000' })).status).toBe(401);
    expect(
      (await call('/auth/otp/verify', 'POST', { phone, code: challenge.data.devCode })).status,
    ).toBe(401);
  });
  it('requires driver approval and prevents concurrent stale reviews', async () => {
    const driver = await signIn('driver');
    const admin = await signIn('customer');
    await database.pool.query("UPDATE users SET role='admin' WHERE id=$1", [admin.user.id]);
    const profile = await call(
      '/drivers/me',
      'POST',
      { vehiclePlate: 'TEST-002', vehicleType: 'motorcycle' },
      driver.accessToken,
    );
    expect(profile.status).toBe(201);
    expect(
      (await call('/drivers/me/availability', 'PATCH', { available: true }, driver.accessToken))
        .status,
    ).toBe(403);
    const reviews = await Promise.all([
      call(
        `/admin/drivers/${driver.user.id}/review`,
        'PATCH',
        { status: 'approved', expectedUpdatedAt: profile.data.updatedAt },
        admin.accessToken,
      ),
      call(
        `/admin/drivers/${driver.user.id}/review`,
        'PATCH',
        { status: 'rejected', reason: 'Test rejection', expectedUpdatedAt: profile.data.updatedAt },
        admin.accessToken,
      ),
    ]);
    expect(reviews.map((value) => value.status).sort()).toEqual([200, 409]);
    const audit = await database.pool.query('SELECT * FROM audit_logs WHERE entity_id=$1', [
      driver.user.id,
    ]);
    expect(audit.rowCount).toBe(1);
  });
  it('finds nearby drivers in meters using PostGIS', async () => {
    const driver = await signIn('driver');
    await call(
      '/drivers/me',
      'POST',
      { vehiclePlate: 'TEST-GEO', vehicleType: 'motorcycle' },
      driver.accessToken,
    );
    await database.pool.query(
      `INSERT INTO driver_locations(driver_id,position,is_available,last_seen_at)
      VALUES($1,ST_SetSRID(ST_MakePoint(106.7,10.77),4326)::geography,true,now())`,
      [driver.user.id],
    );
    const result = await database.pool.query(
      `SELECT driver_id FROM driver_locations
      WHERE driver_id=$1 AND ST_DWithin(position,ST_SetSRID(ST_MakePoint(106.701,10.771),4326)::geography,1000)`,
      [driver.user.id],
    );
    expect(result.rowCount).toBe(1);
    const distant = await database.pool.query(
      `SELECT driver_id FROM driver_locations
      WHERE driver_id=$1 AND ST_DWithin(position,ST_SetSRID(ST_MakePoint(107.7,11.77),4326)::geography,1000)`,
      [driver.user.id],
    );
    expect(distant.rowCount).toBe(0);
  });
});
