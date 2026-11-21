import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Param,
  Patch,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { Cache, Database } from './database';
import { loadConfig } from './config';
import { AccessGuard, type AuthRequest, Roles } from './security';
import { parse } from './validation';
import { AuthService } from './auth';
import { insideHanoi, MapsService } from './maps';
import {
  ACTIVE_DRIVER_STATUSES,
  customerMayCancel,
  driverMayAdvance,
  judgeFix,
  locationFixSchema,
  ORDER_STATUSES,
  type OrderStatus,
  PRESENCE_FRESH_SECONDS,
  priceVnd,
  quoteRequestSchema,
  staffMayCancel,
  tariffFor,
} from './orders-policy';
import { RealtimeHub } from './realtime-hub';
import { Metrics } from './metrics';

const QUOTE_TTL_SECONDS = 600;
const LOCATION_MIN_INTERVAL_MS = 1_000;
const OFFER_BATCH = 50;
const OFFER_TICK_BUDGET_MS = 1_000;
const MAX_OPEN_ORDERS_PER_CUSTOMER = 3;
const ACTIVE = `('${ACTIVE_DRIVER_STATUSES.join("','")}')`;
const uuid = z.uuid();

export function ordersEnabled() {
  if (loadConfig().ORDERS_ENABLED !== 'true')
    throw new ServiceUnavailableException('Đơn hàng chưa được bật trên máy chủ này');
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

/** Full order view. Contact phones are only exposed to the customer, assigned driver and staff. */
export const ORDER_SELECT = `
  SELECT o.id, o.status, o.version, o.vehicle_type AS "vehicleType", o.stops,
    o.distance_m AS "distanceMeters", o.duration_s AS "durationSeconds",
    o.price_vnd::int AS "priceVnd", o.tariff->>'version' AS "tariffVersion",
    o.search_deadline AS "searchDeadline", o.cancel_reason AS "cancelReason",
    o.customer_id AS "customerId", o.driver_id AS "driverId",
    o.created_at AS "createdAt", o.updated_at AS "updatedAt",
    CASE WHEN o.driver_id IS NULL THEN NULL ELSE json_build_object(
      'id', d.user_id, 'displayName', du.display_name,
      'vehiclePlate', d.vehicle_plate, 'vehicleType', d.vehicle_type) END AS driver,
    CASE WHEN o.status IN ${ACTIVE} AND l.driver_id IS NOT NULL THEN json_build_object(
      'longitude', ST_X(l.position::geometry), 'latitude', ST_Y(l.position::geometry),
      'accuracy', l.accuracy_m, 'recordedAt', l.recorded_at, 'lastSeenAt', l.last_seen_at) END
      AS "driverLocation"
  FROM orders o
  LEFT JOIN driver_profiles d ON d.user_id = o.driver_id
  LEFT JOIN users du ON du.id = o.driver_id
  LEFT JOIN driver_locations l ON l.driver_id = o.driver_id`;

export type OrderRow = {
  id: string;
  status: OrderStatus;
  version: number;
  customerId: string;
  driverId: string | null;
  [key: string]: unknown;
};

@Injectable()
export class OrdersService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(RealtimeHub) private readonly hub: RealtimeHub,
    @Inject(Cache) private readonly cache: Cache,
  ) {}

  async snapshot(orderId: string, client: Pick<PoolClient, 'query'> = this.database.pool) {
    return (await client.query<OrderRow>(`${ORDER_SELECT} WHERE o.id = $1`, [orderId])).rows[0];
  }

  /** Viewer may read the order: owner customer, assigned driver or staff. */
  async readable(orderId: string, account: AuthRequest['account']) {
    const order = await this.snapshot(orderId);
    if (!order) return undefined;
    if (['admin', 'dispatcher'].includes(account.role)) return order;
    if (account.role === 'customer' && order.customerId === account.id) return order;
    if (account.role === 'driver' && order.driverId === account.id) return order;
    return undefined;
  }

  /** Writes history + outbox in the caller's transaction so events never outlive a rollback. */
  async recordTransition(
    client: PoolClient,
    order: {
      id: string;
      version: number;
      status: OrderStatus;
      customerId: string;
      driverId: string | null;
    },
    actorId: string | null,
    reason: string | null = null,
  ) {
    await client.query(
      `INSERT INTO order_events (order_id, version, status, actor_id, reason) VALUES ($1,$2,$3,$4,$5)`,
      [order.id, order.version, order.status, actorId, reason],
    );
    await client.query(
      `INSERT INTO outbox_events (event_type, aggregate_id, payload) VALUES ('order.updated', $1, $2)`,
      [
        order.id,
        JSON.stringify({
          orderId: order.id,
          version: order.version,
          status: order.status,
          customerId: order.customerId,
          driverId: order.driverId,
        }),
      ],
    );
  }

  async offerEvent(
    client: PoolClient,
    offer: { id: string; orderId: string; driverId: string; status: string },
  ) {
    await client.query(
      `INSERT INTO outbox_events (event_type, aggregate_id, payload) VALUES ('offer.updated', $1, $2)`,
      [
        offer.id,
        JSON.stringify({
          offerId: offer.id,
          orderId: offer.orderId,
          driverId: offer.driverId,
          status: offer.status,
        }),
      ],
    );
  }

  async withdrawOffers(client: PoolClient, orderId: string) {
    const rows = (
      await client.query<{ id: string; driver_id: string }>(
        `UPDATE order_offers SET status = 'withdrawn', responded_at = now()
         WHERE order_id = $1 AND status = 'pending' RETURNING id, driver_id`,
        [orderId],
      )
    ).rows;
    for (const row of rows)
      await this.offerEvent(client, {
        id: row.id,
        orderId,
        driverId: row.driver_id,
        status: 'withdrawn',
      });
  }

  /** Locks the order row; every mutation path locks order before offers to avoid deadlocks. */
  async lockOrder(client: PoolClient, orderId: string) {
    return (
      await client.query<{
        id: string;
        status: OrderStatus;
        version: number;
        customer_id: string;
        driver_id: string | null;
      }>(
        'SELECT id, status, version, customer_id, driver_id FROM orders WHERE id = $1 FOR UPDATE',
        [orderId],
      )
    ).rows[0];
  }

  async setStatus(
    client: PoolClient,
    order: { id: string; version: number; customer_id: string },
    status: OrderStatus,
    driverId: string | null,
    actorId: string | null,
    extra: { reason?: string; cancelledBy?: string } = {},
  ) {
    const version = order.version + 1;
    await client.query(
      `UPDATE orders SET status = $2, driver_id = $3, version = $4, updated_at = now(),
         cancel_reason = COALESCE($5, cancel_reason), cancelled_by = COALESCE($6, cancelled_by)
       WHERE id = $1`,
      [order.id, status, driverId, version, extra.reason ?? null, extra.cancelledBy ?? null],
    );
    await this.recordTransition(
      client,
      { id: order.id, version, status, customerId: order.customer_id, driverId },
      actorId,
      extra.reason ?? null,
    );
    return version;
  }

  async cancel(
    orderId: string,
    actor: AuthRequest['account'],
    expectedVersion: number,
    reason: string | null,
  ) {
    const staff = ['admin', 'dispatcher'].includes(actor.role);
    await this.database.transaction(async (client) => {
      const order = await this.lockOrder(client, orderId);
      if (!order || (!staff && order.customer_id !== actor.id)) throw new NotFoundException();
      if (order.version !== expectedVersion)
        throw new ConflictException('Đơn đã thay đổi. Tải lại trước khi hủy.');
      if (!(staff ? staffMayCancel(order.status) : customerMayCancel(order.status)))
        throw new ConflictException('Không thể hủy đơn ở trạng thái hiện tại');
      await this.withdrawOffers(client, order.id);
      await this.setStatus(client, order, 'CANCELLED', order.driver_id, actor.id, {
        reason: reason ?? (staff ? undefined : 'Khách hàng hủy khi đang tìm tài xế'),
        cancelledBy: actor.id,
      });
      if (staff)
        await client.query(
          `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
           VALUES ($1, 'order.cancelled', 'order', $2, $3)`,
          [actor.id, order.id, JSON.stringify({ from: order.status, reason })],
        );
    });
    return this.snapshot(orderId);
  }

  // ----- Driver presence -----

  async recordLocation(driverId: string, body: unknown) {
    ordersEnabled();
    const fix = parse(locationFixSchema, body);
    const verdict = judgeFix(fix, Date.now());
    if (verdict !== 'ok') return { accepted: false, reason: verdict };
    // At most one stored fix per driver per second, whatever the client does (socket or REST).
    const slot = await this.cache.redis.set(
      `gps:throttle:${driverId}`,
      '1',
      'PX',
      LOCATION_MIN_INTERVAL_MS,
      'NX',
    );
    if (!slot) return { accepted: false, reason: 'throttled' };
    const profile = (
      await this.database.pool.query<{ status: string }>(
        'SELECT status FROM driver_profiles WHERE user_id = $1',
        [driverId],
      )
    ).rows[0];
    if (profile?.status !== 'approved') throw new ForbiddenException('Driver approval required');
    // Order by device timestamp (bounded above); page reloads restart sequence numbers.
    const stored = await this.database.pool.query(
      `INSERT INTO driver_locations (driver_id, position, last_seen_at, sequence, accuracy_m, recorded_at)
       VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, now(), $4, $5, $6)
       ON CONFLICT (driver_id) DO UPDATE SET position = EXCLUDED.position, last_seen_at = now(),
         sequence = EXCLUDED.sequence, accuracy_m = EXCLUDED.accuracy_m, recorded_at = EXCLUDED.recorded_at
       WHERE driver_locations.recorded_at IS NULL OR driver_locations.recorded_at < EXCLUDED.recorded_at
       RETURNING driver_id`,
      [
        driverId,
        fix.longitude,
        fix.latitude,
        fix.sequence,
        Math.round(fix.accuracy),
        fix.recordedAt,
      ],
    );
    if (!stored.rowCount) return { accepted: false, reason: 'out-of-order' };
    const active = (
      await this.database.pool.query<{ id: string }>(
        `SELECT id FROM orders WHERE driver_id = $1 AND status IN ${ACTIVE}`,
        [driverId],
      )
    ).rows[0];
    // Live position is ephemeral: emitted to the order room, never part of the outbox.
    if (active)
      this.hub.emit(`order:${active.id}`, 'order.location', {
        orderId: active.id,
        longitude: fix.longitude,
        latitude: fix.latitude,
        accuracy: Math.round(fix.accuracy),
        recordedAt: fix.recordedAt,
      });
    return { accepted: true };
  }

  async presence(driverId: string) {
    const row = (
      await this.database.pool.query<{
        available: boolean;
        lastSeenAt: string;
        accuracy: number | null;
        fresh: boolean;
      }>(
        `SELECT is_available AS available, last_seen_at AS "lastSeenAt", accuracy_m AS accuracy,
           last_seen_at > now() - make_interval(secs => $2) AS fresh
         FROM driver_locations WHERE driver_id = $1`,
        [driverId, PRESENCE_FRESH_SECONDS],
      )
    ).rows[0];
    return row ?? { available: false, lastSeenAt: null, accuracy: null, fresh: false };
  }

  async setAvailability(driverId: string, available: boolean) {
    return this.database.transaction(async (client) => {
      const profile = (
        await client.query<{ status: string }>(
          'SELECT status FROM driver_profiles WHERE user_id = $1 FOR UPDATE',
          [driverId],
        )
      ).rows[0];
      if (available && profile?.status !== 'approved')
        throw new ForbiddenException('Driver approval required');
      if (available) {
        ordersEnabled();
        const updated = await client.query(
          `UPDATE driver_locations SET is_available = true WHERE driver_id = $1
           AND last_seen_at > now() - make_interval(secs => $2)`,
          [driverId, PRESENCE_FRESH_SECONDS],
        );
        if (!updated.rowCount)
          throw new ConflictException('Cần vị trí GPS mới (dưới 30 giây) trước khi bật sẵn sàng');
        return { available: true };
      }
      await client.query('UPDATE driver_locations SET is_available = false WHERE driver_id = $1', [
        driverId,
      ]);
      // Going offline releases any pending offer so dispatch can move on.
      const offers = (
        await client.query<{ id: string; order_id: string }>(
          `UPDATE order_offers SET status = 'withdrawn', responded_at = now()
           WHERE driver_id = $1 AND status = 'pending' RETURNING id, order_id`,
          [driverId],
        )
      ).rows;
      for (const offer of offers)
        await this.offerEvent(client, {
          id: offer.id,
          orderId: offer.order_id,
          driverId,
          status: 'withdrawn',
        });
      return { available: false };
    });
  }

  // ----- Offers and driver actions -----

  async currentOffer(driverId: string) {
    return (
      (
        await this.database.pool.query(
          `SELECT f.id, f.order_id AS "orderId", f.expires_at AS "expiresAt", f.distance_m AS "pickupDistanceMeters",
             o.vehicle_type AS "vehicleType", o.distance_m AS "distanceMeters",
             o.duration_s AS "durationSeconds", o.price_vnd::int AS "priceVnd",
             json_build_object('address', o.stops->'pickup'->>'address') AS pickup,
             json_build_object('address', o.stops->'dropoff'->>'address') AS dropoff
           FROM order_offers f JOIN orders o ON o.id = f.order_id
           WHERE f.driver_id = $1 AND f.status = 'pending' AND f.expires_at > now()`,
          [driverId],
        )
      ).rows[0] ?? null
    );
  }

  async respond(driverId: string, offerId: string, accept: boolean) {
    ordersEnabled();
    const ref = (
      await this.database.pool.query<{ order_id: string }>(
        'SELECT order_id FROM order_offers WHERE id = $1 AND driver_id = $2',
        [offerId, driverId],
      )
    ).rows[0];
    if (!ref) throw new NotFoundException();
    try {
      await this.database.transaction(async (client) => {
        const order = await this.lockOrder(client, ref.order_id);
        const offer = (
          await client.query<{ status: string; live: boolean }>(
            `SELECT status, expires_at > now() AS live FROM order_offers WHERE id = $1 FOR UPDATE`,
            [offerId],
          )
        ).rows[0];
        if (!order || !offer || offer.status !== 'pending' || !offer.live)
          throw new ConflictException('Đề nghị không còn hiệu lực');
        if (!accept) {
          await client.query(
            `UPDATE order_offers SET status = 'declined', responded_at = now() WHERE id = $1`,
            [offerId],
          );
          await this.offerEvent(client, {
            id: offerId,
            orderId: order.id,
            driverId,
            status: 'declined',
          });
          return;
        }
        if (order.status !== 'SEARCHING') throw new ConflictException('Đơn không còn tìm tài xế');
        const eligible = await client.query(
          `SELECT 1 FROM driver_profiles WHERE user_id = $1 AND status = 'approved'`,
          [driverId],
        );
        if (!eligible.rowCount) throw new ForbiddenException('Driver approval required');
        await client.query(
          `UPDATE order_offers SET status = 'accepted', responded_at = now() WHERE id = $1`,
          [offerId],
        );
        await this.offerEvent(client, {
          id: offerId,
          orderId: order.id,
          driverId,
          status: 'accepted',
        });
        await this.setStatus(client, order, 'ASSIGNED', driverId, driverId);
      });
    } catch (error) {
      // orders_driver_active_uidx: the driver already holds an active order.
      if (isUniqueViolation(error)) throw new ConflictException('Bạn đang có đơn chưa hoàn tất');
      throw error;
    }
    return accept ? this.snapshot(ref.order_id) : null;
  }

  async currentDriverOrder(driverId: string) {
    return (
      (
        await this.database.pool.query(
          `${ORDER_SELECT} WHERE o.driver_id = $1 AND o.status IN ${ACTIVE}`,
          [driverId],
        )
      ).rows[0] ?? null
    );
  }

  async advance(driverId: string, orderId: string, status: OrderStatus, expectedVersion: number) {
    ordersEnabled();
    await this.database.transaction(async (client) => {
      const order = await this.lockOrder(client, orderId);
      if (!order || order.driver_id !== driverId) throw new NotFoundException();
      if (order.version !== expectedVersion)
        throw new ConflictException('Đơn đã thay đổi. Tải lại trạng thái.');
      if (!driverMayAdvance(order.status, status))
        throw new ConflictException('Chuyển trạng thái không hợp lệ');
      await this.setStatus(client, order, status, driverId, driverId);
    });
    return this.snapshot(orderId);
  }
}

@Injectable()
export class QuoteService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(MapsService) private readonly maps: MapsService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(OrdersService) private readonly orders: OrdersService,
  ) {}

  async quote(customerId: string, body: unknown) {
    ordersEnabled();
    const input = parse(quoteRequestSchema, body);
    if (!insideHanoi(input.pickup.position) || !insideHanoi(input.dropoff.position))
      throw new UnprocessableEntityException('Điểm lấy/giao phải nằm trong vùng thử nghiệm Hà Nội');
    const tariff = tariffFor(loadConfig(), input.vehicleType);
    if (!tariff)
      throw new ServiceUnavailableException('Bảng giá chưa được cấu hình cho loại xe này');
    await this.auth.limit(`quote:user:${customerId}`, 30, 60);
    const route = await this.maps.route(input.pickup.position, input.dropoff.position);
    const distance = Math.max(1, Math.round(route.distanceMeters));
    const price = priceVnd(tariff, distance);
    const row = (
      await this.database.pool.query<{ id: string; expiresAt: string }>(
        `INSERT INTO order_quotes (customer_id, vehicle_type, stops, distance_m, duration_s, price_vnd, tariff, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(secs => $8))
         RETURNING id, expires_at AS "expiresAt"`,
        [
          customerId,
          input.vehicleType,
          JSON.stringify({ pickup: input.pickup, dropoff: input.dropoff }),
          distance,
          Math.round(route.durationSeconds),
          price,
          JSON.stringify(tariff),
          QUOTE_TTL_SECONDS,
        ],
      )
    ).rows[0]!;
    return {
      id: row.id,
      vehicleType: input.vehicleType,
      distanceMeters: distance,
      durationSeconds: Math.round(route.durationSeconds),
      priceVnd: price,
      tariffVersion: tariff.version,
      pricingApproved: false,
      expiresAt: row.expiresAt,
      routeGeometry: route.geometry,
    };
  }

  /** Idempotent per quote: retrying the same quote returns the same order. */
  async create(customerId: string, quoteId: string) {
    ordersEnabled();
    const id = await this.database.transaction(async (client) => {
      const quote = (
        await client.query<{
          id: string;
          vehicle_type: string;
          stops: {
            pickup: { position: { longitude: number; latitude: number } };
            dropoff: { position: { longitude: number; latitude: number } };
          };
          distance_m: number;
          duration_s: number;
          price_vnd: string;
          tariff: unknown;
          live: boolean;
        }>(
          `SELECT id, vehicle_type, stops, distance_m, duration_s, price_vnd, tariff, expires_at > now() AS live
           FROM order_quotes WHERE id = $1 AND customer_id = $2 FOR UPDATE`,
          [quoteId, customerId],
        )
      ).rows[0];
      if (!quote) throw new NotFoundException('Không tìm thấy báo giá');
      const existing = (
        await client.query<{ id: string }>('SELECT id FROM orders WHERE quote_id = $1', [quoteId])
      ).rows[0];
      if (existing) return existing.id;
      if (!quote.live) throw new ConflictException('Báo giá đã hết hạn. Hãy lấy báo giá mới.');
      const open = await client.query(
        `SELECT count(*)::int AS n FROM orders WHERE customer_id = $1 AND status NOT IN ('DELIVERED','CANCELLED','EXPIRED')`,
        [customerId],
      );
      if (open.rows[0].n >= MAX_OPEN_ORDERS_PER_CUSTOMER)
        throw new ConflictException('Bạn đang có quá nhiều đơn chưa hoàn tất');
      const { pickup, dropoff } = quote.stops;
      const created = (
        await client.query<{ id: string }>(
          `INSERT INTO orders (quote_id, customer_id, status, vehicle_type, pickup_position, dropoff_position,
             stops, distance_m, duration_s, price_vnd, tariff, search_deadline)
           VALUES ($1, $2, 'SEARCHING', $3,
             ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography,
             $8, $9, $10, $11, $12, now() + make_interval(secs => $13))
           RETURNING id`,
          [
            quote.id,
            customerId,
            quote.vehicle_type,
            pickup.position.longitude,
            pickup.position.latitude,
            dropoff.position.longitude,
            dropoff.position.latitude,
            JSON.stringify(quote.stops),
            quote.distance_m,
            quote.duration_s,
            quote.price_vnd,
            JSON.stringify(quote.tariff),
            loadConfig().DISPATCH_SEARCH_SECONDS,
          ],
        )
      ).rows[0]!;
      await this.orders.recordTransition(
        client,
        { id: created.id, version: 1, status: 'SEARCHING', customerId, driverId: null },
        customerId,
      );
      return created.id;
    });
    return this.orders.snapshot(id);
  }
}

/** Sequential offers: nearest fresh, available, approved driver; one pending offer per order. */
@Injectable()
export class DispatchService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastCleanup = 0;
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(Metrics) private readonly metrics: Metrics,
  ) {}

  onModuleInit() {
    const config = loadConfig();
    if (config.ORDERS_ENABLED !== 'true' || config.DISPATCH_TICK_MS === 0) return;
    this.timer = setInterval(() => {
      void this.tick().catch(() => console.error(JSON.stringify({ event: 'dispatch.tick.error' })));
    }, config.DISPATCH_TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    if (this.running) return { offered: 0, expiredOrders: 0, expiredOffers: 0 };
    this.running = true;
    try {
      const expiredOffers = await this.expireOffers();
      const expiredOrders = await this.expireOrders();
      const offered = await this.offerNext();
      this.metrics.inc('shango_dispatch_ticks_total');
      this.metrics.inc('shango_dispatch_offers_total', {}, offered);
      this.metrics.inc('shango_dispatch_offers_expired_total', {}, expiredOffers);
      this.metrics.inc('shango_orders_expired_total', {}, expiredOrders);
      if (Date.now() - this.lastCleanup > 3_600_000) {
        this.lastCleanup = Date.now();
        await this.cleanupOutbox();
      }
      return { offered, expiredOrders, expiredOffers };
    } finally {
      this.running = false;
    }
  }

  /** Published outbox rows are only a delivery log; keep them for a bounded window. */
  async cleanupOutbox() {
    const result = await this.database.pool.query(
      `DELETE FROM outbox_events WHERE id IN (
         SELECT id FROM outbox_events WHERE published_at IS NOT NULL
         AND published_at < now() - make_interval(hours => $1) LIMIT 5000)`,
      [loadConfig().OUTBOX_RETENTION_HOURS],
    );
    return result.rowCount ?? 0;
  }

  private async expireOffers() {
    return this.database.transaction(async (client) => {
      const rows = (
        await client.query<{ id: string; order_id: string; driver_id: string }>(
          `UPDATE order_offers SET status = 'expired', responded_at = now()
           WHERE id IN (SELECT id FROM order_offers WHERE status = 'pending' AND expires_at <= now()
                        FOR UPDATE SKIP LOCKED)
           RETURNING id, order_id, driver_id`,
        )
      ).rows;
      for (const row of rows)
        await this.orders.offerEvent(client, {
          id: row.id,
          orderId: row.order_id,
          driverId: row.driver_id,
          status: 'expired',
        });
      return rows.length;
    });
  }

  private async expireOrders() {
    const due = (
      await this.database.pool.query<{ id: string }>(
        `SELECT id FROM orders WHERE status = 'SEARCHING' AND search_deadline <= now() ORDER BY search_deadline LIMIT 50`,
      )
    ).rows;
    let count = 0;
    for (const { id } of due)
      await this.database.transaction(async (client) => {
        const order = (
          await client.query<{
            id: string;
            status: OrderStatus;
            version: number;
            customer_id: string;
          }>(
            `SELECT id, status, version, customer_id FROM orders WHERE id = $1 AND status = 'SEARCHING'
             AND search_deadline <= now() FOR UPDATE SKIP LOCKED`,
            [id],
          )
        ).rows[0];
        if (!order) return;
        await this.orders.withdrawOffers(client, id);
        await this.orders.setStatus(client, order, 'EXPIRED', null, null, {
          reason: 'Hết thời gian tìm tài xế',
        });
        count += 1;
      });
    return count;
  }

  /**
   * Offers drivers to waiting orders in batches until none are left or the tick budget is spent,
   * so a burst of orders is not throttled to one small batch per tick. Orders already scanned in
   * this tick (e.g. no driver nearby) are skipped so the loop always terminates.
   */
  private async offerNext() {
    const started = Date.now();
    const scanned: string[] = [];
    let offered = 0;
    for (;;) {
      const batch = await this.offerBatch(scanned);
      offered += batch.offered;
      if (batch.scanned < OFFER_BATCH || Date.now() - started > OFFER_TICK_BUDGET_MS) break;
    }
    return offered;
  }

  private async offerBatch(scanned: string[]) {
    const config = loadConfig();
    const candidates = (
      await this.database.pool.query<{ id: string }>(
        `SELECT o.id FROM orders o WHERE o.status = 'SEARCHING' AND o.search_deadline > now()
         AND NOT (o.id = ANY($1::uuid[]))
         AND NOT EXISTS (SELECT 1 FROM order_offers f WHERE f.order_id = o.id AND f.status = 'pending')
         ORDER BY o.created_at LIMIT $2`,
        [scanned, OFFER_BATCH],
      )
    ).rows;
    scanned.push(...candidates.map((row) => row.id));
    let offered = 0;
    for (const { id } of candidates)
      await this.database.transaction(async (client) => {
        const order = (
          await client.query(
            `SELECT id FROM orders o WHERE id = $1 AND status = 'SEARCHING'
             AND NOT EXISTS (SELECT 1 FROM order_offers f WHERE f.order_id = o.id AND f.status = 'pending')
             FOR UPDATE SKIP LOCKED`,
            [id],
          )
        ).rows[0];
        if (!order) return;
        const driver = (
          await client.query<{ driver_id: string; distance_m: number }>(
            `SELECT l.driver_id, ST_Distance(l.position, o.pickup_position)::int AS distance_m
             FROM orders o
             JOIN driver_locations l ON ST_DWithin(l.position, o.pickup_position, $2)
             JOIN driver_profiles p ON p.user_id = l.driver_id
             JOIN users u ON u.id = l.driver_id
             WHERE o.id = $1 AND l.is_available AND l.last_seen_at > now() - make_interval(secs => $3)
               AND p.status = 'approved' AND u.status = 'active' AND p.vehicle_type = o.vehicle_type
               AND NOT EXISTS (SELECT 1 FROM order_offers x WHERE x.driver_id = l.driver_id
                               AND (x.status = 'pending' OR x.order_id = o.id))
               AND NOT EXISTS (SELECT 1 FROM orders a WHERE a.driver_id = l.driver_id AND a.status IN ${ACTIVE})
             ORDER BY distance_m, l.driver_id LIMIT 1`,
            [id, config.DISPATCH_RADIUS_M, PRESENCE_FRESH_SECONDS],
          )
        ).rows[0];
        if (!driver) return;
        // Unique partial indexes guard against a concurrent instance offering the same driver.
        const inserted = (
          await client.query<{ id: string }>(
            `INSERT INTO order_offers (order_id, driver_id, distance_m, expires_at)
             VALUES ($1, $2, $3, now() + make_interval(secs => $4))
             ON CONFLICT DO NOTHING RETURNING id`,
            [id, driver.driver_id, driver.distance_m, config.DISPATCH_OFFER_SECONDS],
          )
        ).rows[0];
        if (!inserted) return;
        await this.orders.offerEvent(client, {
          id: inserted.id,
          orderId: id,
          driverId: driver.driver_id,
          status: 'pending',
        });
        offered += 1;
      });
    return { offered, scanned: candidates.length };
  }
}

const versionSchema = z.object({ expectedVersion: z.number().int().positive() }).strict();

@Controller('orders')
@UseGuards(AccessGuard)
export class OrdersController {
  constructor(
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(QuoteService) private readonly quotes: QuoteService,
    @Inject(Database) private readonly database: Database,
  ) {}

  @Post('quote')
  @HttpCode(200)
  @Roles('customer')
  quote(@Body() body: unknown, @Req() request: AuthRequest) {
    return this.quotes.quote(request.account.id, body);
  }

  @Post()
  @Roles('customer')
  create(@Body() body: unknown, @Req() request: AuthRequest) {
    const { quoteId } = parse(z.object({ quoteId: uuid }).strict(), body);
    return this.quotes.create(request.account.id, quoteId);
  }

  @Get()
  @Roles('customer')
  async list(@Req() request: AuthRequest) {
    const items = (
      await this.database.pool.query(
        `${ORDER_SELECT} WHERE o.customer_id = $1 ORDER BY o.created_at DESC LIMIT 50`,
        [request.account.id],
      )
    ).rows;
    return { items };
  }

  /** Status history with the same read authorization as the order itself. */
  @Get(':id/events')
  @Roles('customer', 'driver', 'admin', 'dispatcher')
  async events(@Param('id') id: string, @Req() request: AuthRequest) {
    const order = uuid.safeParse(id).success
      ? await this.orders.readable(id, request.account)
      : undefined;
    if (!order) throw new NotFoundException();
    const staff = ['admin', 'dispatcher'].includes(request.account.role);
    const rows = (
      await this.database.pool.query<{
        version: number;
        status: string;
        reason: string | null;
        at: string;
        actor_id: string | null;
        actor_role: string | null;
      }>(
        `SELECT e.version, e.status, e.reason, e.created_at AS at, e.actor_id, u.role AS actor_role
         FROM order_events e LEFT JOIN users u ON u.id = e.actor_id
         WHERE e.order_id = $1 ORDER BY e.version`,
        [id],
      )
    ).rows;
    const actor = (role: string | null) =>
      role === null ? 'system' : ['admin', 'dispatcher'].includes(role) ? 'staff' : role;
    return {
      items: rows.map((row) => ({
        version: row.version,
        status: row.status,
        at: row.at,
        reason: row.reason,
        actor: actor(row.actor_role),
        // Staff may correlate with the audit log; customers and drivers never see account ids.
        ...(staff ? { actorId: row.actor_id } : {}),
      })),
    };
  }

  @Get(':id')
  @Roles('customer', 'driver', 'admin', 'dispatcher')
  async get(@Param('id') id: string, @Req() request: AuthRequest) {
    const order = uuid.safeParse(id).success
      ? await this.orders.readable(id, request.account)
      : undefined;
    if (!order) throw new NotFoundException();
    return order;
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles('customer')
  cancel(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthRequest) {
    if (!uuid.safeParse(id).success) throw new NotFoundException();
    const { expectedVersion } = parse(versionSchema, body);
    return this.orders.cancel(id, request.account, expectedVersion, null);
  }
}

@Controller('drivers/me')
@UseGuards(AccessGuard)
@Roles('driver')
export class DriverWorkController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  @Post('location')
  @HttpCode(200)
  location(@Body() body: unknown, @Req() request: AuthRequest) {
    return this.orders.recordLocation(request.account.id, body);
  }

  @Get('presence')
  presence(@Req() request: AuthRequest) {
    return this.orders.presence(request.account.id);
  }

  @Patch('availability')
  availability(@Body() body: unknown, @Req() request: AuthRequest) {
    const { available } = parse(z.object({ available: z.boolean() }).strict(), body);
    return this.orders.setAvailability(request.account.id, available);
  }

  @Get('offers/current')
  async offer(@Req() request: AuthRequest) {
    return { offer: await this.orders.currentOffer(request.account.id) };
  }

  @Post('offers/:id/accept')
  @HttpCode(200)
  accept(@Param('id') id: string, @Req() request: AuthRequest) {
    if (!uuid.safeParse(id).success) throw new NotFoundException();
    return this.orders.respond(request.account.id, id, true);
  }

  @Post('offers/:id/decline')
  @HttpCode(204)
  async decline(@Param('id') id: string, @Req() request: AuthRequest) {
    if (!uuid.safeParse(id).success) throw new NotFoundException();
    await this.orders.respond(request.account.id, id, false);
  }

  @Get('orders/current')
  async current(@Req() request: AuthRequest) {
    return { order: await this.orders.currentDriverOrder(request.account.id) };
  }

  @Post('orders/:id/status')
  @HttpCode(200)
  advance(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthRequest) {
    if (!uuid.safeParse(id).success) throw new NotFoundException();
    const input = parse(
      z
        .object({ status: z.enum(ORDER_STATUSES), expectedVersion: z.number().int().positive() })
        .strict(),
      body,
    );
    return this.orders.advance(request.account.id, id, input.status, input.expectedVersion);
  }
}

@Controller('admin/orders')
@UseGuards(AccessGuard)
@Roles('admin', 'dispatcher')
export class AdminOrdersController {
  constructor(
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(Database) private readonly database: Database,
  ) {}

  @Get()
  async list(@Query() query: unknown) {
    const { status } = parse(
      z.object({ status: z.enum(ORDER_STATUSES).optional() }).strict(),
      query,
    );
    const items = (
      await this.database.pool.query(
        `${ORDER_SELECT} WHERE ($1::text IS NULL OR o.status = $1) ORDER BY o.created_at DESC LIMIT 100`,
        [status ?? null],
      )
    ).rows;
    return { items };
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthRequest) {
    if (!uuid.safeParse(id).success) throw new NotFoundException();
    const input = parse(
      z
        .object({
          expectedVersion: z.number().int().positive(),
          reason: z.string().trim().min(3).max(300),
        })
        .strict(),
      body,
    );
    return this.orders.cancel(id, request.account, input.expectedVersion, input.reason);
  }
}
