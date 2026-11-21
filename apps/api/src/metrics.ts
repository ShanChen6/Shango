import {
  Controller,
  Get,
  Header,
  Inject,
  Injectable,
  NotFoundException,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { Database } from './database';
import { loadConfig } from './config';
import { RealtimeHub } from './realtime-hub';

const BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

/**
 * In-process counters exposed in Prometheus text format. Labels are low-cardinality only:
 * no paths with ids, phones, tokens or coordinates.
 */
@Injectable()
export class Metrics {
  private readonly counters = new Map<string, number>();
  private readonly durations = new Map<string, { buckets: number[]; sum: number; count: number }>();

  inc(name: string, labels: Record<string, string> = {}, value = 1) {
    const key = `${name}${format(labels)}`;
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
  }

  observe(name: string, labels: Record<string, string>, seconds: number) {
    const key = `${name}${format(labels)}`;
    const entry = this.durations.get(key) ?? { buckets: BUCKETS.map(() => 0), sum: 0, count: 0 };
    BUCKETS.forEach((bound, index) => {
      if (seconds <= bound) entry.buckets[index] = (entry.buckets[index] ?? 0) + 1;
    });
    entry.sum += seconds;
    entry.count += 1;
    this.durations.set(key, entry);
  }

  /** Express middleware: counts by method + status class, latency histogram by method. */
  middleware() {
    return (request: Request, response: Response, next: NextFunction) => {
      const start = process.hrtime.bigint();
      response.on('finish', () => {
        const method = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'].includes(request.method)
          ? request.method
          : 'OTHER';
        const status = `${Math.floor(response.statusCode / 100)}xx`;
        this.inc('shango_http_requests_total', { method, status });
        this.observe(
          'shango_http_request_duration_seconds',
          { method },
          Number(process.hrtime.bigint() - start) / 1e9,
        );
      });
      next();
    };
  }

  render(gauges: Record<string, number>) {
    const lines: string[] = [];
    const names = new Set<string>();
    for (const [key, value] of [...this.counters].sort()) {
      const name = key.split('{')[0]!;
      if (!names.has(name)) lines.push(`# TYPE ${name} counter`);
      names.add(name);
      lines.push(`${key} ${value}`);
    }
    for (const [key, entry] of [...this.durations].sort()) {
      const [name, rest = ''] = key.split('{') as [string, string?];
      const labels = rest ? rest.slice(0, -1) : '';
      if (!names.has(name)) lines.push(`# TYPE ${name} histogram`);
      names.add(name);
      const join = (extra: string) => `{${[labels, extra].filter(Boolean).join(',')}}`;
      BUCKETS.forEach((bound, index) =>
        lines.push(`${name}_bucket${join(`le="${bound}"`)} ${entry.buckets[index]}`),
      );
      lines.push(`${name}_bucket${join('le="+Inf"')} ${entry.count}`);
      lines.push(`${name}_sum${labels ? `{${labels}}` : ''} ${entry.sum.toFixed(6)}`);
      lines.push(`${name}_count${labels ? `{${labels}}` : ''} ${entry.count}`);
    }
    for (const [name, value] of Object.entries(gauges)) {
      lines.push(`# TYPE ${name} gauge`, `${name} ${value}`);
    }
    return `${lines.join('\n')}\n`;
  }
}

function format(labels: Record<string, string>) {
  const entries = Object.entries(labels);
  return entries.length
    ? `{${entries.map(([key, value]) => `${key}="${value.replace(/["\\\n]/g, '_')}"`).join(',')}}`
    : '';
}

@Controller('health')
export class MetricsController {
  /** Read once at startup like the rest of the deployment configuration. */
  private readonly token = loadConfig().METRICS_TOKEN;
  constructor(
    @Inject(Metrics) private readonly metrics: Metrics,
    @Inject(Database) private readonly database: Database,
    @Inject(RealtimeHub) private readonly hub: RealtimeHub,
  ) {}

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4')
  @Header('Cache-Control', 'no-store')
  async scrape(@Req() request: Request) {
    const token = this.token;
    if (!token) throw new NotFoundException();
    const given = Buffer.from(request.headers.authorization?.replace(/^Bearer /, '') ?? '');
    const expected = Buffer.from(token);
    if (given.length !== expected.length || !timingSafeEqual(given, expected))
      throw new UnauthorizedException();
    const row = (
      await this.database.pool.query<{
        outbox_pending: number;
        outbox_oldest_seconds: number;
        orders_searching: number;
        orders_active: number;
        drivers_available_fresh: number;
      }>(
        `SELECT
           (SELECT count(*)::int FROM outbox_events WHERE published_at IS NULL) AS outbox_pending,
           COALESCE((SELECT EXTRACT(EPOCH FROM now() - min(created_at))::int FROM outbox_events WHERE published_at IS NULL), 0) AS outbox_oldest_seconds,
           (SELECT count(*)::int FROM orders WHERE status = 'SEARCHING') AS orders_searching,
           (SELECT count(*)::int FROM orders WHERE status IN ('ASSIGNED','AT_PICKUP','PICKED_UP','IN_TRANSIT')) AS orders_active,
           (SELECT count(*)::int FROM driver_locations WHERE is_available AND last_seen_at > now() - interval '30 seconds') AS drivers_available_fresh`,
      )
    ).rows[0]!;
    return this.metrics.render({
      shango_outbox_pending: row.outbox_pending,
      shango_outbox_oldest_pending_seconds: row.outbox_oldest_seconds,
      shango_orders_searching: row.orders_searching,
      shango_orders_active: row.orders_active,
      shango_drivers_available_fresh: row.drivers_available_fresh,
      shango_socket_connections: this.hub.server?.engine.clientsCount ?? 0,
      shango_process_uptime_seconds: Math.round(process.uptime()),
    });
  }
}
