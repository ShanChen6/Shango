import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createServer, type Server } from 'node:http';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { AppModule } from '../src/app';
import { Cache, Database } from '../src/database';

describe('maps integration with real Redis and local HTTP providers', () => {
  let app: INestApplication;
  let upstream: Server;
  let database: Database;
  let cache: Cache;
  let base: string;
  let provider: string;
  let providerHash: string;
  let userId: string;
  let token: string;
  const urls: string[] = [];
  const original = { geocoder: process.env.NOMINATIM_BASE_URL, routing: process.env.OSRM_BASE_URL };
  let mode: 'ok' | 'no-route' = 'ok';
  beforeAll(async () => {
    if (process.env.NODE_ENV !== 'test') throw new Error('Use dedicated test database and Redis');
    upstream = createServer((request, response) => {
      const url = new URL(request.url!, provider);
      urls.push(url.href);
      response.setHeader('Content-Type', 'application/json');
      if (!request.headers['user-agent']?.includes('ShanGo')) {
        response.writeHead(400).end('{}');
        return;
      }
      if (url.pathname === '/search') {
        const q = url.searchParams.get('q');
        if (q === 'provider slow') {
          setTimeout(() => response.end('{}'), 5500).unref();
          return;
        }
        if (q === 'provider oversized') {
          response.end(JSON.stringify({ payload: 'x'.repeat(1024 * 1024 + 1) }));
          return;
        }
        if (q === 'malformed response') {
          response.end(JSON.stringify([{ place_id: 1, lat: 'not-a-number' }]));
          return;
        }
        if (q === 'provider unavailable') {
          response.writeHead(503).end('{}');
          return;
        }
        if (q === 'provider throttled') {
          response.writeHead(429).end('{}');
          return;
        }
        response.end(
          JSON.stringify([
            { place_id: 1, display_name: 'Hồ Hoàn Kiếm, Hà Nội', lon: '105.852', lat: '21.028' },
            { place_id: 2, display_name: 'Outside rectangle', lon: '106.7', lat: '10.77' },
          ]),
        );
        return;
      }
      if (url.pathname === '/reverse') {
        response.end(
          JSON.stringify({
            place_id: 3,
            display_name: 'Địa chỉ gần pin',
            lon: '105.853',
            lat: '21.029',
          }),
        );
        return;
      }
      if (url.pathname.startsWith('/route/v1/driving/')) {
        response.end(
          JSON.stringify(
            mode === 'no-route'
              ? { code: 'NoRoute' }
              : {
                  code: 'Ok',
                  routes: [
                    {
                      distance: 4200,
                      duration: 840,
                      geometry: {
                        type: 'LineString',
                        coordinates: [
                          [105.852, 21.028],
                          [105.84, 21.03],
                          [105.834, 21.04],
                        ],
                      },
                    },
                  ],
                },
          ),
        );
        return;
      }
      response.writeHead(404).end('{}');
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const address = upstream.address();
    if (!address || typeof address === 'string') throw new Error('Fixture unavailable');
    provider = `http://127.0.0.1:${address.port}`;
    providerHash = createHash('sha256').update(provider).digest('hex');
    process.env.NOMINATIM_BASE_URL = provider;
    process.env.OSRM_BASE_URL = provider;
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api/v1');
    await app.listen(0, '127.0.0.1');
    base = `${await app.getUrl()}/api/v1`;
    database = app.get(Database);
    cache = app.get(Cache);
    userId = randomUUID();
    const sessionId = randomUUID();
    await database.pool.query("INSERT INTO users(id,phone,role) VALUES($1,$2,'customer')", [
      userId,
      `+849${randomInt(10000000, 99999999)}`,
    ]);
    await database.pool.query(
      "INSERT INTO auth_sessions(id,user_id,refresh_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [sessionId, userId, createHash('sha256').update(randomUUID()).digest('hex')],
    );
    token = jwt.sign({ sid: sessionId }, process.env.JWT_SECRET!, {
      subject: userId,
      issuer: 'shango',
      audience: 'shango-apps',
      expiresIn: '15m',
      algorithm: 'HS256',
    });
  });
  beforeEach(async () => {
    mode = 'ok';
    // Only fixture-origin keys are reset; never bypass a real provider's throttle.
    await cache.redis.del(
      `maps:geocoder:lock:${providerHash}`,
      `maps:geocoder:cooldown:${providerHash}`,
    );
  });
  afterAll(async () => {
    if (cache) {
      const keys = [...new Set(urls)].map(
        (url) => `maps:cache:v1:${createHash('sha256').update(url).digest('hex')}`,
      );
      keys.push(
        `maps:geocoder:lock:${providerHash}`,
        `maps:geocoder:cooldown:${providerHash}`,
        `maps:user:${userId}`,
      );
      await cache.redis.del(...keys);
    }
    if (database && userId) {
      await database.pool.query('DELETE FROM auth_sessions WHERE user_id=$1', [userId]);
      await database.pool.query('DELETE FROM users WHERE id=$1', [userId]);
    }
    if (app) await app.close();
    if (upstream)
      await new Promise<void>((resolve, reject) =>
        upstream.close((error) => (error ? reject(error) : resolve())),
      );
    if (original.geocoder === undefined) delete process.env.NOMINATIM_BASE_URL;
    else process.env.NOMINATIM_BASE_URL = original.geocoder;
    if (original.routing === undefined) delete process.env.OSRM_BASE_URL;
    else process.env.OSRM_BASE_URL = original.routing;
  });
  async function call(path: string, authorized = true) {
    const response = await fetch(`${base}${path}`, {
      headers: authorized ? { Authorization: `Bearer ${token}` } : {},
    });
    return { status: response.status, data: await response.json() };
  }
  const search = (q: string) => call(`/maps/search?${new URLSearchParams({ q })}`);
  const route = (longitude = 105.852) =>
    call(`/maps/route?pickupLng=${longitude}&pickupLat=21.028&dropoffLng=105.834&dropoffLat=21.04`);
  it('requires authentication and never discloses provider URLs in config', async () => {
    expect((await call('/maps/config', false)).status).toBe(401);
    const result = await call('/maps/config');
    expect(result.status).toBe(200);
    expect(result.data.region.name).toBe('Hà Nội');
    expect(result.data.searchMode).toBe('submit-only');
    expect(JSON.stringify(result.data)).not.toContain(provider);
  });
  it('bounds search to Hanoi and caches equivalent queries', async () => {
    const count = urls.length;
    const first = await search('Hồ Hoàn Kiếm');
    expect(first.status).toBe(200);
    expect(first.data.items).toHaveLength(1);
    expect(first.data.items[0].position).toEqual({ longitude: 105.852, latitude: 21.028 });
    const request = new URL(urls.at(-1)!);
    expect(request.searchParams.get('countrycodes')).toBe('vn');
    expect(request.searchParams.get('bounded')).toBe('1');
    expect(request.searchParams.get('viewbox')).toBe('105.3,21.4,106.05,20.55');
    expect((await search('  HỒ   HOÀN KIẾM  ')).status).toBe(200);
    expect(urls.length - count).toBe(1);
  });
  it('admits only one uncached geocoding request at a time across clients', async () => {
    const count = urls.length;
    const results = await Promise.all([search('Hồ Tây test'), search('Văn Miếu test')]);
    expect(results.map((value) => value.status).sort()).toEqual([200, 429]);
    expect(urls.length - count).toBe(1);
  });
  it('keeps requested coordinates distinct from the nearest address', async () => {
    const result = await call('/maps/reverse?longitude=105.852&latitude=21.028');
    expect(result.status).toBe(200);
    expect(result.data.requestedPosition).toEqual({ longitude: 105.852, latitude: 21.028 });
    expect(result.data.item.position).toEqual({ longitude: 105.853, latitude: 21.029 });
  });
  it('rejects out-of-region, swapped and unrecognized inputs before provider calls', async () => {
    const count = urls.length;
    expect((await call('/maps/reverse?longitude=106.7&latitude=10.77')).status).toBe(400);
    expect((await call('/maps/reverse?longitude=21.028&latitude=105.852')).status).toBe(400);
    expect((await call('/maps/search?q=ok')).status).toBe(400);
    expect((await call('/maps/search?q=Hanoi&url=http://untrusted.example')).status).toBe(400);
    expect(urls.length).toBe(count);
  });
  it('normalizes real routing response and never invents a price', async () => {
    const count = urls.length;
    const result = await route();
    expect(result.status).toBe(200);
    expect(result.data.distanceMeters).toBe(4200);
    expect(result.data.durationSeconds).toBe(840);
    expect(result.data.motorcycleValidated).toBe(false);
    expect(result.data).not.toHaveProperty('price');
    expect(new URL(urls.at(-1)!).pathname).toContain('105.852,21.028;105.834,21.04');
    expect((await route()).data.geometry.type).toBe('LineString');
    expect(urls.length - count).toBe(1);
  });
  it('returns no-route instead of a straight-line fallback', async () => {
    mode = 'no-route';
    const result = await route(105.82);
    expect(result.status).toBe(404);
    expect(result.data).not.toHaveProperty('distanceMeters');
  });
  it('rejects malformed provider data and propagates throttling safely', async () => {
    expect((await search('malformed response')).status).toBe(502);
    await cache.redis.del(`maps:geocoder:cooldown:${providerHash}`);
    expect((await search('provider throttled')).status).toBe(429);
    await cache.redis.del(`maps:geocoder:cooldown:${providerHash}`);
    expect((await search('provider unavailable')).status).toBe(502);
  });
  it('reports missing providers without attempting any network request', async () => {
    delete process.env.NOMINATIM_BASE_URL;
    delete process.env.OSRM_BASE_URL;
    try {
      const settings = await call('/maps/config');
      expect(settings.data.geocodingConfigured).toBe(false);
      const count = urls.length;
      expect((await search('Thiếu nhà cung cấp')).status).toBe(503);
      expect((await route()).status).toBe(503);
      expect(urls.length).toBe(count);
    } finally {
      process.env.NOMINATIM_BASE_URL = provider;
      process.env.OSRM_BASE_URL = provider;
    }
  });
  it('bounds provider response size and timeout, then releases the geocoder lease', async () => {
    expect((await search('provider oversized')).status).toBe(502);
    await cache.redis.del(`maps:geocoder:cooldown:${providerHash}`);
    expect((await search('provider slow')).status).toBe(502);
    expect(await cache.redis.exists(`maps:geocoder:lock:${providerHash}`)).toBe(0);
  }, 10000);
});
