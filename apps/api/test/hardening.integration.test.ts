import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createHmac, randomInt } from 'node:crypto';
import { io as connect, type Socket } from 'socket.io-client';
import { AppModule } from '../src/app';
import { Cache, Database } from '../src/database';
import { configureHttp } from '../src/http';
import { loadConfig } from '../src/config';
import { DispatchService } from '../src/orders';
import { RealtimeHub } from '../src/realtime-hub';

// Dedicated migrated test DB/Redis only; removes what it creates.
const TOKEN = 'metrics-token-for-tests-only-0123456789abcdef';
const digest = (value: string) =>
  createHmac('sha256', process.env.OTP_SECRET!).update(value).digest('hex');

async function start(env: Record<string, string>) {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  const app = await NestFactory.create(AppModule, { logger: false });
  configureHttp(app, loadConfig());
  await app.listen(0, '127.0.0.1');
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return { app, root: await app.getUrl() };
}

describe('WEB-010 hardening', () => {
  let primary: INestApplication;
  let secondary: INestApplication;
  let root: string;
  let rootB: string;
  let database: Database;
  let cache: Cache;
  const phones: string[] = [];
  const sockets: Socket[] = [];
  const outboxIds: string[] = [];

  beforeAll(async () => {
    if (process.env.NODE_ENV !== 'test') throw new Error('Use dedicated test database and Redis');
    ({ app: primary, root } = await start({
      METRICS_TOKEN: TOKEN,
      TRUST_PROXY_HOPS: '1',
      SOCKET_REDIS_ADAPTER: 'true',
    }));
    ({ app: secondary, root: rootB } = await start({ SOCKET_REDIS_ADAPTER: 'true' }));
    database = primary.get(Database);
    cache = primary.get(Cache);
  });

  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    if (database) {
      if (outboxIds.length)
        await database.pool.query('DELETE FROM outbox_events WHERE id = ANY($1::uuid[])', [
          outboxIds,
        ]);
      const ids = (
        await database.pool.query<{ id: string }>('SELECT id FROM users WHERE phone = ANY($1)', [
          phones,
        ])
      ).rows.map((r) => r.id);
      if (ids.length) {
        await database.pool.query('DELETE FROM auth_sessions WHERE user_id = ANY($1::uuid[])', [
          ids,
        ]);
        await database.pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
      }
    }
    if (cache)
      await cache.redis.del(
        ...phones.flatMap((p) => [
          `otp:phone:${digest(p)}`,
          `otp:cooldown:${digest(p)}`,
          `otp:challenge:${digest(p)}`,
        ]),
        `otp:ip:${digest('203.0.113.9')}`,
        `otp:ip:${digest('127.0.0.1')}`,
        `otp:verify:ip:${digest('127.0.0.1')}`,
      );
    await secondary?.close();
    await primary?.close();
  });

  const post = (base: string, path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/api/v1${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  it('exposes token-protected metrics without personal data', async () => {
    const phone = `+849${randomInt(10000000, 99999999)}`;
    phones.push(phone);
    await post(root, '/auth/otp/request', { phone, role: 'customer' });
    expect((await fetch(`${root}/api/v1/health/metrics`)).status).toBe(401);
    expect(
      (await fetch(`${root}/api/v1/health/metrics`, { headers: { Authorization: 'Bearer wrong' } }))
        .status,
    ).toBe(401);
    expect(
      (
        await fetch(`${rootB}/api/v1/health/metrics`, {
          headers: { Authorization: `Bearer ${TOKEN}` },
        })
      ).status,
    ).toBe(404);
    const response = await fetch(`${root}/api/v1/health/metrics`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.text();
    expect(text).toMatch(/shango_http_requests_total\{method="POST",status="2xx"\} \d+/);
    expect(text).toMatch(
      /shango_http_request_duration_seconds_bucket\{method="POST",le="\+Inf"\} \d+/,
    );
    expect(text).toMatch(/shango_outbox_pending \d+/);
    expect(text).toMatch(/shango_drivers_available_fresh \d+/);
    expect(text).not.toContain(phone);
    expect(text).not.toContain(phone.slice(1));
  });

  it('keys IP rate limits on X-Forwarded-For only from the trusted hop', async () => {
    const phone = `+849${randomInt(10000000, 99999999)}`;
    phones.push(phone);
    await cache.redis.del(`otp:ip:${digest('203.0.113.9')}`);
    expect(
      (
        await post(
          root,
          '/auth/otp/request',
          { phone, role: 'customer' },
          { 'X-Forwarded-For': '203.0.113.9' },
        )
      ).status,
    ).toBe(200);
    expect(await cache.redis.get(`otp:ip:${digest('203.0.113.9')}`)).toBe('1');
    // The secondary instance trusts no proxy: a spoofed header must not change the key.
    const other = `+849${randomInt(10000000, 99999999)}`;
    phones.push(other);
    await post(
      rootB,
      '/auth/otp/request',
      { phone: other, role: 'customer' },
      { 'X-Forwarded-For': '203.0.113.9' },
    );
    expect(await cache.redis.get(`otp:ip:${digest('203.0.113.9')}`)).toBe('1');
  });

  it('restricts development OTP to the staging allowlist', async () => {
    const allowed = `+849${randomInt(10000000, 99999999)}`;
    const stranger = `+849${randomInt(10000000, 99999999)}`;
    phones.push(allowed, stranger);
    process.env.OTP_DEV_PHONE_ALLOWLIST = allowed;
    try {
      const denied = await post(root, '/auth/otp/request', { phone: stranger, role: 'customer' });
      expect(denied.status).toBe(403);
      expect(JSON.stringify(await denied.json())).not.toContain('devCode');
      expect(
        (await post(root, '/auth/otp/request', { phone: allowed, role: 'customer' })).status,
      ).toBe(200);
    } finally {
      delete process.env.OTP_DEV_PHONE_ALLOWLIST;
    }
  });

  it('deletes only old published outbox rows', async () => {
    const rows = (
      await database.pool.query<{ id: string }>(
        `INSERT INTO outbox_events (event_type, aggregate_id, payload, published_at, created_at) VALUES
           ('test.old', gen_random_uuid(), '{}', now() - interval '100 hours', now() - interval '100 hours'),
           ('test.recent', gen_random_uuid(), '{}', now() - interval '1 hour', now() - interval '1 hour'),
           ('test.pending', gen_random_uuid(), '{}', NULL, now() - interval '100 hours')
         RETURNING id`,
      )
    ).rows.map((row) => row.id);
    outboxIds.push(...rows);
    await primary.get(DispatchService).cleanupOutbox();
    const left = await database.pool.query<{ event_type: string }>(
      'SELECT event_type FROM outbox_events WHERE id = ANY($1::uuid[]) ORDER BY event_type',
      [rows],
    );
    expect(left.rows.map((row) => row.event_type)).toEqual(['test.pending', 'test.recent']);
  });

  it('fans realtime events out across instances through the Redis adapter', async () => {
    const phone = `+849${randomInt(10000000, 99999999)}`;
    phones.push(phone);
    const challenge = await (
      await post(root, '/auth/otp/request', { phone, role: 'customer' })
    ).json();
    const session = await (
      await post(root, '/auth/otp/verify', { phone, code: challenge.devCode })
    ).json();
    const socket = connect(rootB, {
      path: '/socket.io',
      auth: { token: session.accessToken },
      transports: ['websocket'],
      reconnection: false,
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    const received = new Promise((resolve) => socket.once('order.updated', resolve));
    // Emitted on the primary instance; the socket lives on the secondary.
    primary.get(RealtimeHub).emit(`user:${session.user.id}`, 'order.updated', {
      orderId: 'x',
      version: 1,
      status: 'SEARCHING',
    });
    await expect(received).resolves.toMatchObject({ orderId: 'x', version: 1 });
  });
});
