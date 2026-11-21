import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import { Database } from './database';
import { loadConfig } from './config';
import { type Account, authenticateAccessToken } from './security';
import { OrdersService } from './orders';
import { RealtimeHub } from './realtime-hub';
import { originAllowed, parseAllowedOrigins } from './web-auth-policy';

type SocketData = { token: string; account: Account };
type Ack = (value: unknown) => void;
const STAFF_ROLES = ['admin', 'dispatcher'];
const subscribeSchema = z.object({ orderId: z.uuid() }).strict();

type OutboxRow = {
  id: string;
  event_type: string;
  payload: Record<string, string | number | null>;
};

/**
 * Socket.IO gateway (single instance; Redis adapter + sticky sessions are WEB-010).
 * Clients authenticate with the in-memory access token, receive authoritative snapshots on
 * subscribe and treat events as "refetch" hints ordered by version.
 */
@Injectable()
export class RealtimeGateway implements OnApplicationBootstrap, OnModuleDestroy {
  private io: Server | null = null;
  private timer: NodeJS.Timeout | null = null;
  private publishing = false;

  constructor(
    @Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost,
    @Inject(Database) private readonly database: Database,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(RealtimeHub) private readonly hub: RealtimeHub,
  ) {}

  onApplicationBootstrap() {
    const config = loadConfig();
    const httpServer = this.adapterHost.httpAdapter?.getHttpServer();
    if (!httpServer) return;
    const origins = parseAllowedOrigins(config.CORS_ORIGINS);
    const io = new Server(httpServer, {
      path: '/socket.io',
      serveClient: false,
      cors: { origin: origins, credentials: true },
      // CORS does not apply to WebSocket upgrades: check Origin explicitly when present.
      allowRequest: (request, callback) =>
        callback(null, originAllowed(origins, request.headers.origin, false)),
    });
    io.use((socket, next) => {
      this.authenticate(socket).then(
        () => next(),
        () => next(new Error('unauthorized')),
      );
    });
    io.on('connection', (socket) => this.onConnection(socket));
    this.io = io;
    this.hub.server = io;
    if (config.ORDERS_ENABLED === 'true' && config.DISPATCH_TICK_MS !== 0) {
      this.timer = setInterval(() => {
        void this.publishOutbox().catch(() =>
          console.error(JSON.stringify({ event: 'outbox.publish.error' })),
        );
      }, 500);
      this.timer.unref();
    }
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.hub.server = null;
    if (this.io) {
      this.io.disconnectSockets(true);
      // Engine shutdown without closing the shared HTTP server (Nest closes it).
      this.io.engine.close();
    }
  }

  private async authenticate(socket: Socket) {
    const token: unknown = socket.handshake.auth?.token;
    if (typeof token !== 'string' || token.length > 2048) throw new Error('unauthorized');
    const session = await authenticateAccessToken(this.database, token);
    if (!session) throw new Error('unauthorized');
    (socket.data as SocketData) = { token, account: session.account };
    // Expire with the access token; the client reconnects with a refreshed one.
    const ttl = Math.max(0, session.expiresAt - Date.now());
    const timer = setTimeout(() => {
      socket.emit('session.expired');
      socket.disconnect(true);
    }, ttl);
    timer.unref();
    socket.once('disconnect', () => clearTimeout(timer));
  }

  /** Re-checks the session for every privileged action so logout/revoke takes effect promptly. */
  private async current(socket: Socket) {
    const data = socket.data as SocketData;
    const session = await authenticateAccessToken(this.database, data.token);
    if (!session) {
      socket.emit('session.expired');
      socket.disconnect(true);
      return null;
    }
    return session.account;
  }

  private onConnection(socket: Socket) {
    const { account } = socket.data as SocketData;
    void socket.join(`user:${account.id}`);
    if (STAFF_ROLES.includes(account.role)) void socket.join('staff');

    socket.on('order:subscribe', async (payload: unknown, ack?: Ack) => {
      const reply = typeof ack === 'function' ? ack : () => undefined;
      const parsed = subscribeSchema.safeParse(payload);
      if (!parsed.success) return reply({ error: 'invalid' });
      const viewer = await this.current(socket);
      if (!viewer) return;
      const order = await this.orders.readable(parsed.data.orderId, viewer).catch(() => undefined);
      if (!order) return reply({ error: 'not_found' });
      // Join first, then send the snapshot: any later event has a higher version.
      await socket.join(`order:${order.id}`);
      reply({ order: (await this.orders.snapshot(order.id)) ?? order });
    });

    socket.on('order:unsubscribe', (payload: unknown) => {
      const parsed = subscribeSchema.safeParse(payload);
      if (parsed.success) void socket.leave(`order:${parsed.data.orderId}`);
    });

    socket.on('driver:location', async (payload: unknown, ack?: Ack) => {
      const reply = typeof ack === 'function' ? ack : () => undefined;
      const viewer = await this.current(socket);
      if (!viewer) return;
      if (viewer.role !== 'driver') return reply({ accepted: false, reason: 'forbidden' });
      try {
        reply(await this.orders.recordLocation(viewer.id, payload));
      } catch {
        reply({ accepted: false, reason: 'rejected' });
      }
    });
  }

  /** At-least-once delivery of committed outbox rows; clients dedupe by (orderId, version). */
  async publishOutbox() {
    if (this.publishing) return 0;
    this.publishing = true;
    try {
      return await this.database.transaction(async (client) => {
        const rows = (
          await client.query<OutboxRow>(
            `SELECT id, event_type, payload FROM outbox_events
             WHERE published_at IS NULL AND available_at <= now()
             ORDER BY created_at, id LIMIT 100 FOR UPDATE SKIP LOCKED`,
          )
        ).rows;
        for (const row of rows) this.route(row);
        if (rows.length)
          await client.query(
            'UPDATE outbox_events SET published_at = now() WHERE id = ANY($1::uuid[])',
            [rows.map((row) => row.id)],
          );
        return rows.length;
      });
    } finally {
      this.publishing = false;
    }
  }

  private route(row: OutboxRow) {
    const p = row.payload;
    if (row.event_type === 'order.updated') {
      const rooms = [`order:${p.orderId}`, `user:${p.customerId}`, 'staff'];
      if (p.driverId) rooms.push(`user:${p.driverId}`);
      this.hub.emit(rooms, 'order.updated', {
        eventId: row.id,
        orderId: p.orderId,
        version: p.version,
        status: p.status,
      });
    } else if (row.event_type === 'offer.updated') {
      this.hub.emit(`user:${p.driverId}`, 'offer.updated', {
        eventId: row.id,
        offerId: p.offerId,
        orderId: p.orderId,
        status: p.status,
      });
    }
  }
}
