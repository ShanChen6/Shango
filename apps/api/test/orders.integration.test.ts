import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createServer, type Server as HttpServer } from 'node:http';
import { createHmac, randomInt } from 'node:crypto';
import { io as connect, type Socket } from 'socket.io-client';
import { AppModule } from '../src/app';
import { Cache, Database } from '../src/database';
import { configureHttp } from '../src/http';
import { loadConfig } from '../src/config';
import { DispatchService } from '../src/orders';
import { RealtimeGateway } from '../src/realtime';

// Dedicated migrated test DB/Redis only; removes every fixture it creates.
const ENV = {
  ORDERS_ENABLED: 'true',
  DISPATCH_TICK_MS: '0',
  DISPATCH_OFFER_SECONDS: '20',
  TARIFF_MOTORCYCLE_BASE_VND: '15000',
  TARIFF_MOTORCYCLE_PER_KM_VND: '5000',
  TARIFF_CAR_BASE_VND: '',
  TARIFF_CAR_PER_KM_VND: '',
};
const HOAN_KIEM = { longitude: 105.852, latitude: 21.028 };
const NEAR = { longitude: 105.853, latitude: 21.029 };
const FAR = { longitude: 105.87, latitude: 21.04 };
const VAN_MIEU = { longitude: 105.8355, latitude: 21.0293 };

function stop(position: { longitude: number; latitude: number }, address: string) {
  return {
    position,
    address,
    contactName: 'Nguyễn An',
    contactPhone: '0901234567',
    note: 'Gọi trước',
  };
}

describe('orders, dispatch and realtime (WEB-009)', () => {
  let app: INestApplication;
  let database: Database;
  let cache: Cache;
  let dispatch: DispatchService;
  let gateway: RealtimeGateway;
  let base: string;
  let root: string;
  let osrm: HttpServer;
  const previous: Record<string, string | undefined> = {};
  const phones: string[] = [];
  const sockets: Socket[] = [];

  beforeAll(async () => {
    if (process.env.NODE_ENV !== 'test') throw new Error('Use dedicated test database and Redis');
    osrm = createServer((_request, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          code: 'Ok',
          routes: [
            {
              distance: 3200,
              duration: 600,
              geometry: {
                type: 'LineString',
                coordinates: [
                  [105.852, 21.028],
                  [105.8355, 21.0293],
                ],
              },
            },
          ],
        }),
      );
    });
    await new Promise<void>((resolve) => osrm.listen(0, '127.0.0.1', resolve));
    const address = osrm.address();
    for (const [key, value] of Object.entries({
      ...ENV,
      OSRM_BASE_URL: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`,
    })) {
      previous[key] = process.env[key];
      if (value === '') delete process.env[key];
      else process.env[key] = value;
    }
    app = await NestFactory.create(AppModule, { logger: false });
    configureHttp(app, loadConfig());
    await app.listen(0, '127.0.0.1');
    root = await app.getUrl();
    base = `${root}/api/v1`;
    database = app.get(Database);
    cache = app.get(Cache);
    dispatch = app.get(DispatchService);
    gateway = app.get(RealtimeGateway);
  });

  beforeEach(async () => {
    // Keep stale SEARCHING orders from other runs from consuming this suite's drivers.
    await database.pool.query(
      `UPDATE orders SET search_deadline = now() - interval '1 second' WHERE status = 'SEARCHING'
       AND customer_id NOT IN (SELECT id FROM users WHERE phone = ANY($1))`,
      [phones],
    );
    await dispatch.tick();
    await gateway.publishOutbox();
  });

  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    if (database && phones.length) {
      const ids = (
        await database.pool.query<{ id: string }>('SELECT id FROM users WHERE phone = ANY($1)', [
          phones,
        ])
      ).rows.map((row) => row.id);
      const orders = (
        await database.pool.query<{ id: string }>(
          'SELECT id FROM orders WHERE customer_id = ANY($1::uuid[]) OR driver_id = ANY($1::uuid[])',
          [ids],
        )
      ).rows.map((row) => row.id);
      const offers = (
        await database.pool.query<{ id: string }>(
          'SELECT id FROM order_offers WHERE order_id = ANY($1::uuid[]) OR driver_id = ANY($2::uuid[])',
          [orders, ids],
        )
      ).rows.map((row) => row.id);
      await database.pool.query('DELETE FROM outbox_events WHERE aggregate_id = ANY($1::uuid[])', [
        [...orders, ...offers],
      ]);
      await database.pool.query('DELETE FROM order_offers WHERE id = ANY($1::uuid[])', [offers]);
      await database.pool.query('DELETE FROM order_events WHERE order_id = ANY($1::uuid[])', [
        orders,
      ]);
      await database.pool.query('DELETE FROM orders WHERE id = ANY($1::uuid[])', [orders]);
      await database.pool.query('DELETE FROM order_quotes WHERE customer_id = ANY($1::uuid[])', [
        ids,
      ]);
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
      const digest = (value: string) =>
        createHmac('sha256', process.env.OTP_SECRET!).update(value).digest('hex');
      await cache.redis.del(
        ...phones.flatMap((phone) => [
          `otp:phone:${digest(phone)}`,
          `otp:cooldown:${digest(phone)}`,
          `otp:challenge:${digest(phone)}`,
        ]),
        `otp:ip:${digest('127.0.0.1')}`,
        `otp:verify:ip:${digest('127.0.0.1')}`,
      );
    }
    if (app) await app.close();
    await new Promise((resolve) => osrm?.close(resolve));
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  async function call(path: string, method = 'GET', body?: unknown, token?: string) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      data: response.status === 204 ? null : await response.json().catch(() => null),
    };
  }

  async function signIn(role: 'customer' | 'driver') {
    const phone = `+849${randomInt(10000000, 99999999)}`;
    phones.push(phone);
    const challenge = await call('/auth/otp/request', 'POST', { phone, role });
    const verified = await call('/auth/otp/verify', 'POST', {
      phone,
      code: challenge.data.devCode,
    });
    expect(verified.status).toBe(200);
    return { token: verified.data.accessToken as string, id: verified.data.user.id as string };
  }

  async function approvedDriver(position: { longitude: number; latitude: number }) {
    const driver = await signIn('driver');
    await database.pool.query(
      `INSERT INTO driver_profiles (user_id, vehicle_plate, vehicle_type, status) VALUES ($1, $2, 'motorcycle', 'approved')`,
      [driver.id, `29A-${randomInt(10000, 99999)}`],
    );
    expect((await fix(driver.token, position, 1)).data).toEqual({ accepted: true });
    expect(
      (await call('/drivers/me/availability', 'PATCH', { available: true }, driver.token)).status,
    ).toBe(200);
    return driver;
  }

  /** Sends a fix, clearing the per-driver throttle first (throttling has its own test). */
  async function fix(
    token: string,
    position: { longitude: number; latitude: number },
    sequence: number,
    recordedAt = new Date(),
    throttle = false,
  ) {
    if (!throttle) {
      const { sub } = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString());
      await cache.redis.del(`gps:throttle:${sub}`);
    }
    return call(
      '/drivers/me/location',
      'POST',
      { ...position, accuracy: 12, sequence, recordedAt: recordedAt.toISOString() },
      token,
    );
  }

  async function order(token: string) {
    const quote = await call(
      '/orders/quote',
      'POST',
      {
        vehicleType: 'motorcycle',
        pickup: stop(HOAN_KIEM, 'Hồ Hoàn Kiếm'),
        dropoff: stop(VAN_MIEU, 'Văn Miếu'),
      },
      token,
    );
    expect(quote.status).toBe(200);
    const created = await call('/orders', 'POST', { quoteId: quote.data.id }, token);
    expect(created.status).toBe(201);
    return { quote: quote.data, order: created.data };
  }

  function socketFor(token: string, extraHeaders: Record<string, string> = {}) {
    const socket = connect(root, {
      path: '/socket.io',
      auth: { token },
      transports: ['websocket'],
      extraHeaders,
      reconnection: false,
    });
    sockets.push(socket);
    return socket;
  }
  const connected = (socket: Socket) =>
    new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
  const nextEvent = <T>(socket: Socket, event: string, match: (value: T) => boolean = () => true) =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), 3000);
      const handler = (value: T) => {
        if (!match(value)) return;
        clearTimeout(timer);
        socket.off(event, handler);
        resolve(value);
      };
      socket.on(event, handler);
    });

  it('quotes in integer VND from the routed distance and validates region/tariff', async () => {
    const customer = await signIn('customer');
    const outside = await call(
      '/orders/quote',
      'POST',
      {
        vehicleType: 'motorcycle',
        pickup: stop({ longitude: 106.7, latitude: 10.77 }, 'TP HCM'),
        dropoff: stop(VAN_MIEU, 'Văn Miếu'),
      },
      customer.token,
    );
    expect(outside.status).toBe(422);
    const car = await call(
      '/orders/quote',
      'POST',
      {
        vehicleType: 'car',
        pickup: stop(HOAN_KIEM, 'A'.repeat(5)),
        dropoff: stop(VAN_MIEU, 'Văn Miếu'),
      },
      customer.token,
    );
    expect(car.status).toBe(503);
    const { quote, order: created } = await order(customer.token);
    expect(quote).toMatchObject({
      priceVnd: 31000,
      distanceMeters: 3200,
      pricingApproved: false,
      tariffVersion: 'pilot-unapproved',
    });
    expect(created).toMatchObject({
      status: 'SEARCHING',
      version: 1,
      priceVnd: 31000,
      driver: null,
    });
    expect(created.stops.pickup.contactPhone).toBe('+84901234567');

    const again = await call('/orders', 'POST', { quoteId: quote.id }, customer.token);
    expect(again.data.id).toBe(created.id);
    const stranger = await signIn('customer');
    expect((await call('/orders', 'POST', { quoteId: quote.id }, stranger.token)).status).toBe(404);
    expect((await call(`/orders/${created.id}`, 'GET', undefined, stranger.token)).status).toBe(
      404,
    );
    const driver = await signIn('driver');
    expect((await call('/orders/quote', 'POST', {}, driver.token)).status).toBe(403);

    await database.pool.query(
      `UPDATE order_quotes SET expires_at = now() - interval '1 second' WHERE customer_id = $1`,
      [customer.id],
    );
    const fresh = await call(
      '/orders/quote',
      'POST',
      {
        vehicleType: 'motorcycle',
        pickup: stop(HOAN_KIEM, 'Hồ Hoàn Kiếm'),
        dropoff: stop(VAN_MIEU, 'Văn Miếu'),
      },
      customer.token,
    );
    await database.pool.query(
      `UPDATE order_quotes SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [fresh.data.id],
    );
    expect((await call('/orders', 'POST', { quoteId: fresh.data.id }, customer.token)).status).toBe(
      409,
    );
    expect(
      (await call(`/orders/${created.id}/cancel`, 'POST', { expectedVersion: 1 }, customer.token))
        .data.status,
    ).toBe('CANCELLED');
  });

  it('validates driver fixes and requires fresh GPS before going available', async () => {
    const driver = await signIn('driver');
    await database.pool.query(
      `INSERT INTO driver_profiles (user_id, vehicle_plate, vehicle_type, status) VALUES ($1, '29A-00001', 'motorcycle', 'approved')`,
      [driver.id],
    );
    expect(
      (await call('/drivers/me/availability', 'PATCH', { available: true }, driver.token)).status,
    ).toBe(409);
    expect((await fix(driver.token, HOAN_KIEM, 1, new Date(Date.now() - 60_000))).data).toEqual({
      accepted: false,
      reason: 'stale',
    });
    expect((await fix(driver.token, HOAN_KIEM, 2)).data).toEqual({ accepted: true });
    expect((await fix(driver.token, NEAR, 3, new Date(Date.now() - 10_000))).data).toEqual({
      accepted: false,
      reason: 'out-of-order',
    });
    expect(
      (await call('/drivers/me/availability', 'PATCH', { available: true }, driver.token)).data,
    ).toEqual({ available: true });
    expect((await call('/drivers/me/presence', 'GET', undefined, driver.token)).data).toMatchObject(
      { available: true, fresh: true },
    );
    await database.pool.query(
      `UPDATE driver_locations SET last_seen_at = now() - interval '31 seconds' WHERE driver_id = $1`,
      [driver.id],
    );
    expect((await call('/drivers/me/presence', 'GET', undefined, driver.token)).data.fresh).toBe(
      false,
    );
    expect(
      (await call('/drivers/me/availability', 'PATCH', { available: false }, driver.token)).data,
    ).toEqual({ available: false });
  });

  it('offers sequentially to the nearest driver, assigns once and streams realtime updates', async () => {
    const near = await approvedDriver(NEAR);
    const far = await approvedDriver(FAR);
    const customer = await signIn('customer');
    const { order: created } = await order(customer.token);

    const customerSocket = socketFor(customer.token);
    await connected(customerSocket);
    const subscribed = await customerSocket.emitWithAck('order:subscribe', { orderId: created.id });
    expect(subscribed.order).toMatchObject({ id: created.id, version: 1, status: 'SEARCHING' });
    const nearSocket = socketFor(near.token);
    await connected(nearSocket);

    const offeredNear = nextEvent<{ status: string; offerId: string }>(
      nearSocket,
      'offer.updated',
      (value) => value.status === 'pending',
    );
    expect((await dispatch.tick()).offered).toBeGreaterThanOrEqual(1);
    await gateway.publishOutbox();
    const firstOffer = await offeredNear;
    const offerView = (await call('/drivers/me/offers/current', 'GET', undefined, near.token)).data
      .offer;
    expect(offerView).toMatchObject({
      id: firstOffer.offerId,
      orderId: created.id,
      priceVnd: 31000,
    });
    expect(JSON.stringify(offerView)).not.toContain('+8490');
    expect(
      (await call('/drivers/me/offers/current', 'GET', undefined, far.token)).data.offer,
    ).toBeNull();
    expect((await call(`/orders/${created.id}`, 'GET', undefined, near.token)).status).toBe(404);

    expect(
      (
        await call(
          `/drivers/me/offers/${firstOffer.offerId}/decline`,
          'POST',
          undefined,
          near.token,
        )
      ).status,
    ).toBe(204);
    await dispatch.tick();
    const farOffer = (await call('/drivers/me/offers/current', 'GET', undefined, far.token)).data
      .offer;
    expect(farOffer.orderId).toBe(created.id);
    expect(
      (await call(`/drivers/me/offers/${firstOffer.offerId}/accept`, 'POST', undefined, near.token))
        .status,
    ).toBe(409);
    await dispatch.tick();
    expect(
      (await call('/drivers/me/offers/current', 'GET', undefined, near.token)).data.offer,
    ).toBeNull();

    const assignedEvent = nextEvent<{ version: number; status: string }>(
      customerSocket,
      'order.updated',
      (value) => value.status === 'ASSIGNED',
    );
    const accepts = await Promise.all([
      call(`/drivers/me/offers/${farOffer.id}/accept`, 'POST', undefined, far.token),
      call(`/drivers/me/offers/${farOffer.id}/accept`, 'POST', undefined, far.token),
    ]);
    expect(accepts.map((value) => value.status).sort()).toEqual([200, 409]);
    await gateway.publishOutbox();
    expect(await assignedEvent).toMatchObject({
      orderId: created.id,
      version: 2,
      status: 'ASSIGNED',
    });

    const assigned = (await call(`/orders/${created.id}`, 'GET', undefined, customer.token)).data;
    expect(assigned).toMatchObject({
      status: 'ASSIGNED',
      driverId: far.id,
      driver: { id: far.id },
    });
    expect(assigned.driverLocation).toMatchObject({
      longitude: FAR.longitude,
      latitude: FAR.latitude,
    });
    expect(
      (await call(`/orders/${created.id}/cancel`, 'POST', { expectedVersion: 2 }, customer.token))
        .status,
    ).toBe(409);

    const live = nextEvent<{ orderId: string; longitude: number }>(
      customerSocket,
      'order.location',
    );
    expect((await fix(far.token, NEAR, 2)).data).toEqual({ accepted: true });
    expect(await live).toMatchObject({ orderId: created.id, longitude: NEAR.longitude });

    const advance = (status: string, expectedVersion: number) =>
      call(
        `/drivers/me/orders/${created.id}/status`,
        'POST',
        { status, expectedVersion },
        far.token,
      );
    expect((await advance('PICKED_UP', 2)).status).toBe(409);
    expect((await advance('AT_PICKUP', 1)).status).toBe(409);
    expect((await advance('AT_PICKUP', 2)).data.status).toBe('AT_PICKUP');
    expect((await advance('PICKED_UP', 3)).data.status).toBe('PICKED_UP');
    expect(
      (
        await call(
          `/drivers/me/orders/${created.id}/status`,
          'POST',
          { status: 'IN_TRANSIT', expectedVersion: 4 },
          near.token,
        )
      ).status,
    ).toBe(404);
    expect((await advance('IN_TRANSIT', 4)).data.status).toBe('IN_TRANSIT');
    expect(
      (await call('/drivers/me/orders/current', 'GET', undefined, far.token)).data.order.id,
    ).toBe(created.id);
    const delivered = await advance('DELIVERED', 5);
    expect(delivered.data).toMatchObject({ status: 'DELIVERED', version: 6, driverLocation: null });
    expect(
      (await call('/drivers/me/orders/current', 'GET', undefined, far.token)).data.order,
    ).toBeNull();

    const history = await database.pool.query(
      'SELECT version, status FROM order_events WHERE order_id = $1 ORDER BY version',
      [created.id],
    );
    expect(history.rows.map((row) => row.status)).toEqual([
      'SEARCHING',
      'ASSIGNED',
      'AT_PICKUP',
      'PICKED_UP',
      'IN_TRANSIT',
      'DELIVERED',
    ]);
    const timeline = await call(`/orders/${created.id}/events`, 'GET', undefined, customer.token);
    expect(timeline.status).toBe(200);
    expect(
      timeline.data.items.map((item: { status: string; actor: string }) => [
        item.status,
        item.actor,
      ]),
    ).toEqual([
      ['SEARCHING', 'customer'],
      ['ASSIGNED', 'driver'],
      ['AT_PICKUP', 'driver'],
      ['PICKED_UP', 'driver'],
      ['IN_TRANSIT', 'driver'],
      ['DELIVERED', 'driver'],
    ]);
    expect(JSON.stringify(timeline.data)).not.toContain(far.id);
    expect((await call(`/orders/${created.id}/events`, 'GET', undefined, near.token)).status).toBe(
      404,
    );
    const stranger = await signIn('customer');
    expect(
      (await call(`/orders/${created.id}/events`, 'GET', undefined, stranger.token)).status,
    ).toBe(404);
    await call('/drivers/me/availability', 'PATCH', { available: false }, near.token);
    await call('/drivers/me/availability', 'PATCH', { available: false }, far.token);
  });

  it('lets staff cancel after assignment with audit, frees the driver and expires unmatched orders', async () => {
    const driver = await approvedDriver(NEAR);
    const customer = await signIn('customer');
    const admin = await signIn('customer');
    await database.pool.query(`UPDATE users SET role = 'dispatcher' WHERE id = $1`, [admin.id]);
    const { order: created } = await order(customer.token);
    await dispatch.tick();
    const offer = (await call('/drivers/me/offers/current', 'GET', undefined, driver.token)).data
      .offer;
    expect(
      (await call(`/drivers/me/offers/${offer.id}/accept`, 'POST', undefined, driver.token)).status,
    ).toBe(200);

    expect(
      (
        await call(
          `/admin/orders/${created.id}/cancel`,
          'POST',
          { expectedVersion: 1, reason: 'Khách gọi hủy' },
          admin.token,
        )
      ).status,
    ).toBe(409);
    const cancelled = await call(
      `/admin/orders/${created.id}/cancel`,
      'POST',
      { expectedVersion: 2, reason: 'Khách gọi hủy' },
      admin.token,
    );
    expect(cancelled.data).toMatchObject({ status: 'CANCELLED', cancelReason: 'Khách gọi hủy' });
    const staffTimeline = await call(`/orders/${created.id}/events`, 'GET', undefined, admin.token);
    expect(staffTimeline.data.items.at(-1)).toMatchObject({
      status: 'CANCELLED',
      actor: 'staff',
      actorId: admin.id,
      reason: 'Khách gọi hủy',
    });
    const customerTimeline = await call(
      `/orders/${created.id}/events`,
      'GET',
      undefined,
      customer.token,
    );
    expect(customerTimeline.data.items.at(-1)).toMatchObject({
      status: 'CANCELLED',
      actor: 'staff',
    });
    expect(customerTimeline.data.items.at(-1)).not.toHaveProperty('actorId');
    expect(
      (
        await call(
          `/admin/orders/${created.id}/cancel`,
          'POST',
          { expectedVersion: 2, reason: 'x' },
          customer.token,
        )
      ).status,
    ).toBe(403);
    const audit = await database.pool.query(
      `SELECT 1 FROM audit_logs WHERE entity_id = $1 AND action = 'order.cancelled'`,
      [created.id],
    );
    expect(audit.rowCount).toBe(1);
    expect(
      (await call('/drivers/me/orders/current', 'GET', undefined, driver.token)).data.order,
    ).toBeNull();
    const listed = await call('/admin/orders?status=CANCELLED', 'GET', undefined, admin.token);
    expect(listed.data.items.some((item: { id: string }) => item.id === created.id)).toBe(true);

    const { order: lonely } = await order(customer.token);
    await call('/drivers/me/availability', 'PATCH', { available: false }, driver.token);
    await database.pool.query(
      `UPDATE orders SET search_deadline = now() - interval '1 second' WHERE id = $1`,
      [lonely.id],
    );
    expect((await dispatch.tick()).expiredOrders).toBeGreaterThanOrEqual(1);
    expect(
      (await call(`/orders/${lonely.id}`, 'GET', undefined, customer.token)).data,
    ).toMatchObject({ status: 'EXPIRED', version: 2 });
  });

  it('authenticates sockets, checks Origin and authorizes order subscriptions', async () => {
    const anonymous = socketFor('not-a-token');
    await expect(connected(anonymous)).rejects.toThrow();
    const customer = await signIn('customer');
    const evil = socketFor(customer.token, { Origin: 'https://evil.example' });
    await expect(connected(evil)).rejects.toThrow();
    const owner = await signIn('customer');
    const { order: created } = await order(owner.token);
    const intruder = socketFor(customer.token);
    await connected(intruder);
    expect(await intruder.emitWithAck('order:subscribe', { orderId: created.id })).toEqual({
      error: 'not_found',
    });
    expect(await intruder.emitWithAck('driver:location', { longitude: 1 })).toEqual({
      accepted: false,
      reason: 'forbidden',
    });
    await call(`/orders/${created.id}/cancel`, 'POST', { expectedVersion: 1 }, owner.token);
  });

  it('stores at most one fix per driver per second', async () => {
    const driver = await signIn('driver');
    await database.pool.query(
      `INSERT INTO driver_profiles (user_id, vehicle_plate, vehicle_type, status) VALUES ($1, '29A-00009', 'motorcycle', 'approved')`,
      [driver.id],
    );
    const now = Date.now();
    expect((await fix(driver.token, HOAN_KIEM, 1, new Date(now - 500), true)).data).toEqual({
      accepted: true,
    });
    expect((await fix(driver.token, NEAR, 2, new Date(now), true)).data).toEqual({
      accepted: false,
      reason: 'throttled',
    });
    const stored = await database.pool.query(
      `SELECT ST_X(position::geometry) AS lng FROM driver_locations WHERE driver_id = $1`,
      [driver.id],
    );
    expect(stored.rows[0].lng).toBeCloseTo(HOAN_KIEM.longitude, 6);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect((await fix(driver.token, NEAR, 3, new Date(), true)).data).toEqual({ accepted: true });
  });

  it('keeps orders closed while the pilot flag is off', async () => {
    const customer = await signIn('customer');
    process.env.ORDERS_ENABLED = 'false';
    try {
      expect((await call('/orders/quote', 'POST', {}, customer.token)).status).toBe(503);
    } finally {
      process.env.ORDERS_ENABLED = 'true';
    }
  });

  it('limits quotes and orders to active service area polygons (SG-015)', async () => {
    const box = (west: number, south: number, east: number, north: number) => ({
      type: 'Polygon' as const,
      coordinates: [
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south],
        ],
      ],
    });
    const original = (
      await database.pool.query<{
        id: string;
        version: number;
        name: string;
        area: string;
        active: boolean;
        updated_by: string | null;
        updated_at: string;
      }>(
        `SELECT id, version, name, area, active, updated_by, updated_at FROM service_areas WHERE code = 'hanoi-pilot'`,
      )
    ).rows[0]!;
    const staff = await signIn('customer');
    await database.pool.query(`UPDATE users SET role = 'dispatcher' WHERE id = $1`, [staff.id]);
    const admin = await signIn('customer');
    await database.pool.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [admin.id]);
    const customer = await signIn('customer');
    const quote = (pickup: { longitude: number; latitude: number }, dropoff = VAN_MIEU) =>
      call(
        '/orders/quote',
        'POST',
        {
          vehicleType: 'motorcycle',
          pickup: stop(pickup, 'Điểm A'),
          dropoff: stop(dropoff, 'Điểm B'),
        },
        customer.token,
      );
    const save = (body: Record<string, unknown>, token = admin.token) =>
      call(`/admin/service-areas/${original.id}`, 'PUT', body, token);
    try {
      const listed = await call('/admin/service-areas', 'GET', undefined, staff.token);
      expect(listed.status).toBe(200);
      const area = listed.data.items.find((item: { id: string }) => item.id === original.id);
      expect(area).toMatchObject({ code: 'hanoi-pilot', active: true, version: original.version });
      expect(area.geometry.type).toBe('MultiPolygon');
      expect(area.areaKm2).toBeGreaterThan(1000);
      expect((await call('/admin/service-areas', 'GET', undefined, customer.token)).status).toBe(
        403,
      );

      const small = {
        name: 'Nội thành thử nghiệm',
        active: true,
        geometry: box(105.8, 21.0, 105.9, 21.06),
        expectedVersion: original.version,
      };
      expect((await save(small, staff.token)).status).toBe(403);
      expect((await save({ ...small, expectedVersion: original.version + 9 })).status).toBe(409);
      const bowtie = {
        type: 'Polygon',
        coordinates: [
          [
            [105.8, 21.0],
            [105.9, 21.06],
            [105.9, 21.0],
            [105.8, 21.06],
            [105.8, 21.0],
          ],
        ],
      };
      const invalid = await save({ ...small, geometry: bowtie });
      expect(invalid.status).toBe(422);
      expect(invalid.data.message).toMatch(/Polygon không hợp lệ: Self-intersection/);
      expect((await save({ ...small, geometry: box(106.5, 10.7, 106.8, 10.9) })).status).toBe(400);
      const open = { type: 'Polygon', coordinates: [small.geometry.coordinates[0]!.slice(0, 4)] };
      expect((await save({ ...small, geometry: open })).status).toBe(400);
      expect((await save({ ...small, active: false })).data.message).toBe(
        'Phải còn ít nhất một vùng phục vụ đang bật.',
      );

      const saved = await save(small);
      expect(saved.status).toBe(200);
      expect(saved.data).toMatchObject({
        name: 'Nội thành thử nghiệm',
        version: original.version + 1,
        vertices: 5,
        updatedBy: admin.id,
      });

      // Inside the discovery rectangle but outside the polygon.
      const outsidePickup = await quote({ longitude: 105.5, latitude: 21.2 });
      expect(outsidePickup.status).toBe(422);
      expect(outsidePickup.data.message).toBe('Điểm lấy hàng nằm ngoài vùng phục vụ');
      const outsideDropoff = await quote(HOAN_KIEM, { longitude: 105.5, latitude: 21.2 });
      expect(outsideDropoff.data.message).toBe('Điểm giao hàng nằm ngoài vùng phục vụ');
      const inside = await quote(HOAN_KIEM);
      expect(inside.status).toBe(200);

      // Shrinking the area after a quote blocks creating the order from that quote.
      const shrunk = await save({
        ...small,
        geometry: box(105.845, 21.0, 105.9, 21.06),
        expectedVersion: original.version + 1,
      });
      expect(shrunk.status).toBe(200);
      const blocked = await call('/orders', 'POST', { quoteId: inside.data.id }, customer.token);
      expect(blocked.status).toBe(422);
      expect(blocked.data.message).toBe('Điểm giao hàng nằm ngoài vùng phục vụ');

      const versions = await call(
        `/admin/service-areas/${original.id}/versions`,
        'GET',
        undefined,
        staff.token,
      );
      expect(versions.data.items.slice(0, 3).map((v: { version: number }) => v.version)).toEqual([
        original.version + 2,
        original.version + 1,
        original.version,
      ]);
      const audit = await database.pool.query(
        `SELECT metadata FROM audit_logs WHERE action = 'service_area.updated' AND actor_id = $1 ORDER BY id`,
        [admin.id],
      );
      expect(audit.rows.map((row) => row.metadata.toVersion)).toEqual([
        original.version + 1,
        original.version + 2,
      ]);
    } finally {
      await database.pool.query(
        `UPDATE service_areas SET version = $2, name = $3, area = $4, active = $5, updated_by = $6, updated_at = $7 WHERE id = $1`,
        [
          original.id,
          original.version,
          original.name,
          original.area,
          original.active,
          original.updated_by,
          original.updated_at,
        ],
      );
      await database.pool.query(
        'DELETE FROM service_area_versions WHERE area_id = $1 AND version > $2',
        [original.id, original.version],
      );
    }
  });
});
