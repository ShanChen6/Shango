#!/usr/bin/env node
// WEB-010 load test: N simulated drivers (Socket.IO GPS + auto-accept + deliver) and M customers
// placing orders against a real API + PostgreSQL/PostGIS + Redis.
//
// Test environments only. Creates fixtures directly in the dedicated test DB (phones +8491999…)
// and signs access tokens with the test JWT secret, then deletes everything it created.
//
//   NODE_ENV=test DATABASE_URL=… JWT_SECRET=… API_URL=http://127.0.0.1:3000 \
//     node tests/load/dispatch-load.mjs --drivers 100 --orders 50
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import { io } from 'socket.io-client';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce(
      (pairs, value, index, all) =>
        value.startsWith('--') ? [...pairs, [value.slice(2), all[index + 1]]] : pairs,
      [],
    ),
);
const DRIVERS = Number(args.drivers ?? 50);
const ORDERS = Number(args.orders ?? 25);
const CUSTOMERS = Math.max(1, Math.ceil(ORDERS / 3));
const SPACING_MS = Number(args.spacing ?? 100);
const API = (process.env.API_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const CENTER = { longitude: 105.8342, latitude: 21.0278 };
if (process.env.NODE_ENV !== 'test')
  throw new Error('Refusing to run: set NODE_ENV=test with a dedicated test DB');
for (const key of ['DATABASE_URL', 'JWT_SECRET'])
  if (!process.env[key]) throw new Error(`Missing ${key}`);

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const timings = { rest: [], locationAck: [], assign: [], deliveredTotal: [], offerEvent: [] };
const errors = new Map();
const fail = (label) => errors.set(label, (errors.get(label) ?? 0) + 1);
const pct = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]);
};

async function call(token, path, method = 'GET', body) {
  const started = performance.now();
  const response = await fetch(`${API}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  timings.rest.push(performance.now() - started);
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (response.status >= 500)
    fail(`${method} ${path.split('/').slice(0, 3).join('/')} ${response.status}`);
  return { status: response.status, data };
}

async function account(role, index) {
  const phone = `+8491999${String(role === 'driver' ? index : 50000 + index).padStart(5, '0')}`;
  const user = (
    await db.query(
      `INSERT INTO users (phone, role, display_name) VALUES ($1, $2, $3)
       ON CONFLICT (phone) DO UPDATE SET role = EXCLUDED.role RETURNING id`,
      [phone, role, `Load ${role} ${index}`],
    )
  ).rows[0];
  const sessionId = randomUUID();
  await db.query(
    `INSERT INTO auth_sessions (id, user_id, refresh_hash, expires_at) VALUES ($1, $2, $3, now() + interval '1 hour')`,
    [sessionId, user.id, createHash('sha256').update(randomBytes(32)).digest('hex')],
  );
  if (role === 'driver')
    await db.query(
      `INSERT INTO driver_profiles (user_id, vehicle_plate, vehicle_type, status) VALUES ($1, $2, 'motorcycle', 'approved')
       ON CONFLICT (user_id) DO UPDATE SET status = 'approved'`,
      [user.id, `LT-${index}`],
    );
  const token = jwt.sign({ sid: sessionId }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    subject: user.id,
    jwtid: randomUUID(),
    issuer: 'shango',
    audience: 'shango-apps',
    expiresIn: '15m',
  });
  return { id: user.id, token };
}

const jitter = (meters) => (Math.random() - 0.5) * 2 * (meters / 111_000);

async function startDriver(driver, stats) {
  const socket = io(API, {
    path: '/socket.io',
    auth: { token: driver.token },
    transports: ['websocket'],
    reconnection: true,
  });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  let sequence = 0;
  const position = {
    longitude: CENTER.longitude + jitter(3000),
    latitude: CENTER.latitude + jitter(3000),
  };
  const sendFix = async () => {
    sequence += 1;
    const started = performance.now();
    const ack = await socket
      .timeout(5000)
      .emitWithAck('driver:location', {
        ...position,
        accuracy: 15,
        sequence,
        recordedAt: new Date().toISOString(),
      })
      .catch(() => ({ accepted: false, reason: 'timeout' }));
    timings.locationAck.push(performance.now() - started);
    if (!ack.accepted) fail(`location ${ack.reason}`);
  };
  await sendFix();
  const availability = await call(driver.token, '/drivers/me/availability', 'PATCH', {
    available: true,
  });
  if (availability.status !== 200) fail(`availability ${availability.status}`);
  const timer = setInterval(() => void sendFix(), 5000);
  let busy = false;
  socket.on('offer.updated', async (event) => {
    if (event.status !== 'pending' || busy) return;
    busy = true;
    stats.offerSeen.set(event.orderId, performance.now());
    try {
      const accepted = await call(
        driver.token,
        `/drivers/me/offers/${event.offerId}/accept`,
        'POST',
      );
      if (accepted.status !== 200) return;
      let order = accepted.data;
      for (const status of ['AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED']) {
        await sleep(200);
        const next = await call(driver.token, `/drivers/me/orders/${order.id}/status`, 'POST', {
          status,
          expectedVersion: order.version,
        });
        if (next.status !== 200) {
          fail(`advance ${next.status}`);
          return;
        }
        order = next.data;
      }
    } finally {
      busy = false;
    }
  });
  return () => {
    clearInterval(timer);
    socket.disconnect();
  };
}

async function main() {
  console.log(`Setting up ${DRIVERS} drivers and ${CUSTOMERS} customers…`);
  const drivers = [];
  for (let index = 0; index < DRIVERS; index += 1) drivers.push(await account('driver', index));
  const customers = [];
  for (let index = 0; index < CUSTOMERS; index += 1)
    customers.push(await account('customer', index));
  const stats = { offerSeen: new Map() };
  const stops = [];
  for (const driver of drivers) stops.push(await startDriver(driver, stats));
  console.log('Drivers online. Placing orders…');

  const created = new Map();
  const started = performance.now();
  await Promise.all(
    Array.from({ length: ORDERS }, async (_, index) => {
      const customer = customers[index % customers.length];
      await sleep(index * SPACING_MS);
      const stop = (label) => ({
        position: {
          longitude: CENTER.longitude + jitter(2000),
          latitude: CENTER.latitude + jitter(2000),
        },
        address: `Load ${label} ${index}`,
        contactName: 'Load Test',
        contactPhone: '0900000000',
      });
      const quote = await call(customer.token, '/orders/quote', 'POST', {
        vehicleType: 'motorcycle',
        pickup: stop('A'),
        dropoff: stop('B'),
      });
      if (quote.status !== 200) return fail(`quote ${quote.status}`);
      const order = await call(customer.token, '/orders', 'POST', { quoteId: quote.data.id });
      if (order.status !== 201) return fail(`create ${order.status}`);
      created.set(order.data.id, { at: performance.now(), customer });
    }),
  );

  const deadline = performance.now() + 60_000;
  const done = new Set();
  while (performance.now() < deadline && done.size < created.size) {
    const rows = (
      await db.query(
        `SELECT o.id, o.status, min(e.created_at) FILTER (WHERE e.status = 'ASSIGNED') AS assigned_at,
                min(e.created_at) FILTER (WHERE e.status = 'SEARCHING') AS created_at,
                min(e.created_at) FILTER (WHERE e.status = 'DELIVERED') AS delivered_at
         FROM orders o JOIN order_events e ON e.order_id = o.id WHERE o.id = ANY($1::uuid[]) GROUP BY o.id`,
        [[...created.keys()]],
      )
    ).rows;
    for (const row of rows)
      if (row.status === 'DELIVERED' && !done.has(row.id)) {
        done.add(row.id);
        timings.assign.push(new Date(row.assigned_at) - new Date(row.created_at));
        timings.deliveredTotal.push(new Date(row.delivered_at) - new Date(row.created_at));
      }
    await sleep(500);
  }
  for (const [orderId, seenAt] of stats.offerSeen) {
    const order = created.get(orderId);
    if (order) timings.offerEvent.push(seenAt - order.at);
  }
  const elapsed = Math.round((performance.now() - started) / 1000);
  for (const stop of stops) stop();

  const doubles = (
    await db.query(
      `SELECT count(*)::int AS n FROM (SELECT driver_id FROM orders WHERE id = ANY($1::uuid[]) AND driver_id IS NOT NULL
         AND status IN ('ASSIGNED','AT_PICKUP','PICKED_UP','IN_TRANSIT') GROUP BY driver_id HAVING count(*) > 1) d`,
      [[...created.keys()]],
    )
  ).rows[0].n;
  const report = {
    drivers: DRIVERS,
    orders: ORDERS,
    created: created.size,
    delivered: done.size,
    elapsedSeconds: elapsed,
    concurrentActiveOrdersPerDriverViolations: doubles,
    restMs: {
      count: timings.rest.length,
      p50: pct(timings.rest, 50),
      p95: pct(timings.rest, 95),
      max: pct(timings.rest, 100),
    },
    locationAckMs: {
      count: timings.locationAck.length,
      p50: pct(timings.locationAck, 50),
      p95: pct(timings.locationAck, 95),
    },
    createdToOfferEventMs: { p50: pct(timings.offerEvent, 50), p95: pct(timings.offerEvent, 95) },
    createdToAssignedMs: {
      p50: pct(timings.assign, 50),
      p95: pct(timings.assign, 95),
      max: pct(timings.assign, 100),
    },
    createdToDeliveredMs: {
      p50: pct(timings.deliveredTotal, 50),
      p95: pct(timings.deliveredTotal, 95),
    },
    errors: Object.fromEntries(errors),
  };
  console.log(JSON.stringify(report, null, 2));
  await cleanup();
  await db.end();
  process.exit(done.size === created.size && created.size === ORDERS && doubles === 0 ? 0 : 1);
}

async function cleanup() {
  const ids = (await db.query(`SELECT id FROM users WHERE phone LIKE '+8491999%'`)).rows.map(
    (row) => row.id,
  );
  if (!ids.length) return;
  const orders = (
    await db.query(
      'SELECT id FROM orders WHERE customer_id = ANY($1::uuid[]) OR driver_id = ANY($1::uuid[])',
      [ids],
    )
  ).rows.map((r) => r.id);
  const offers = (
    await db.query(
      'SELECT id FROM order_offers WHERE order_id = ANY($1::uuid[]) OR driver_id = ANY($2::uuid[])',
      [orders, ids],
    )
  ).rows.map((r) => r.id);
  await db.query('DELETE FROM outbox_events WHERE aggregate_id = ANY($1::uuid[])', [
    [...orders, ...offers],
  ]);
  await db.query('DELETE FROM order_offers WHERE id = ANY($1::uuid[])', [offers]);
  await db.query('DELETE FROM order_events WHERE order_id = ANY($1::uuid[])', [orders]);
  await db.query('DELETE FROM orders WHERE id = ANY($1::uuid[])', [orders]);
  await db.query('DELETE FROM order_quotes WHERE customer_id = ANY($1::uuid[])', [ids]);
  await db.query('DELETE FROM driver_locations WHERE driver_id = ANY($1::uuid[])', [ids]);
  await db.query('DELETE FROM driver_profiles WHERE user_id = ANY($1::uuid[])', [ids]);
  await db.query('DELETE FROM auth_sessions WHERE user_id = ANY($1::uuid[])', [ids]);
  await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
}

main().catch(async (error) => {
  console.error(error);
  await cleanup().catch(() => undefined);
  await db.end();
  process.exit(1);
});
