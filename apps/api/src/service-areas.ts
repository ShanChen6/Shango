import {
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Put,
  Req,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { Database } from './database';
import { AccessGuard, type AuthRequest, Roles } from './security';
import { parse } from './validation';
import { updateServiceAreaSchema, vertexCount } from './service-area-policy';

type Point = { longitude: number; latitude: number };

const AREA_SELECT = `SELECT a.id, a.code, a.name, a.active, a.version,
  ST_AsGeoJSON(a.area, 6)::json AS geometry,
  round(ST_Area(a.area::geography) / 1000000)::int AS "areaKm2",
  ST_NPoints(a.area)::int AS vertices,
  a.updated_at AS "updatedAt", a.updated_by AS "updatedBy"
  FROM service_areas a`;

@Injectable()
export class ServiceAreaService {
  constructor(@Inject(Database) private readonly database: Database) {}

  /** For each point, whether any active area covers it (boundary counts as inside). */
  async covered(points: Point[], client?: PoolClient): Promise<boolean[]> {
    const runner = client ?? this.database.pool;
    const result = await runner.query<{ ok: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM service_areas a
         WHERE a.active AND ST_Covers(a.area, ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326))
       ) AS ok
       FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS p(lng, lat, n)
       ORDER BY p.n`,
      [points.map((p) => p.longitude), points.map((p) => p.latitude)],
    );
    return result.rows.map((row) => row.ok);
  }

  /** Throws 422 naming the stop that is outside every active service area. */
  async assertServed(pickup: Point, dropoff: Point, client?: PoolClient) {
    const [pickupOk, dropoffOk] = await this.covered([pickup, dropoff], client);
    if (!pickupOk) throw new UnprocessableEntityException('Điểm lấy hàng nằm ngoài vùng phục vụ');
    if (!dropoffOk) throw new UnprocessableEntityException('Điểm giao hàng nằm ngoài vùng phục vụ');
  }

  async list() {
    return (await this.database.pool.query(`${AREA_SELECT} ORDER BY a.code`)).rows;
  }

  async versions(id: string) {
    return (
      await this.database.pool.query(
        `SELECT v.version, v.name, v.active, ST_NPoints(v.area)::int AS vertices,
           round(ST_Area(v.area::geography) / 1000000)::int AS "areaKm2",
           v.changed_at AS "changedAt", v.changed_by AS "changedBy"
         FROM service_area_versions v WHERE v.area_id = $1 ORDER BY v.version DESC LIMIT 50`,
        [id],
      )
    ).rows;
  }

  async update(id: string, actorId: string, body: unknown) {
    const input = parse(updateServiceAreaSchema, body);
    const geojson = JSON.stringify(input.geometry);
    return this.database.transaction(async (client) => {
      const check = (
        await client.query<{ valid: boolean; reason: string; empty: boolean }>(
          `SELECT ST_IsValid(g) AS valid, ST_IsValidReason(g) AS reason, ST_IsEmpty(g) OR ST_Area(g) = 0 AS empty
           FROM ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS g`,
          [geojson],
        )
      ).rows[0]!;
      if (!check.valid)
        throw new UnprocessableEntityException(`Polygon không hợp lệ: ${check.reason}`);
      if (check.empty) throw new UnprocessableEntityException('Polygon không có diện tích');
      const previous = (
        await client.query<{ version: number; active: boolean }>(
          'SELECT version, active FROM service_areas WHERE id = $1 FOR UPDATE',
          [id],
        )
      ).rows[0];
      if (!previous) throw new NotFoundException();
      if (previous.version !== input.expectedVersion)
        throw new ConflictException(
          'Vùng phục vụ đã được người khác cập nhật. Tải lại trước khi lưu.',
        );
      if (!input.active) {
        const others = await client.query(
          'SELECT 1 FROM service_areas WHERE active AND id <> $1 LIMIT 1',
          [id],
        );
        if (!others.rowCount)
          throw new ConflictException('Phải còn ít nhất một vùng phục vụ đang bật.');
      }
      await client.query(
        `UPDATE service_areas SET name = $2, active = $3,
           area = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($4), 4326)),
           version = version + 1, updated_by = $5, updated_at = now()
         WHERE id = $1`,
        [id, input.name, input.active, geojson, actorId],
      );
      await client.query(
        `INSERT INTO service_area_versions (area_id, version, name, area, active, changed_by)
         SELECT id, version, name, area, active, updated_by FROM service_areas WHERE id = $1`,
        [id],
      );
      await client.query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
         VALUES ($1, 'service_area.updated', 'service_area', $2, $3)`,
        [
          actorId,
          id,
          JSON.stringify({
            fromVersion: previous.version,
            toVersion: previous.version + 1,
            active: input.active,
            vertices: vertexCount(input.geometry),
          }),
        ],
      );
      return (await client.query(`${AREA_SELECT} WHERE a.id = $1`, [id])).rows[0];
    });
  }
}

@Controller('admin/service-areas')
@UseGuards(AccessGuard)
@Roles('admin', 'dispatcher')
export class AdminServiceAreasController {
  constructor(@Inject(ServiceAreaService) private readonly areas: ServiceAreaService) {}

  @Get()
  async list() {
    return { items: await this.areas.list() };
  }

  @Get(':id/versions')
  async versions(@Param('id') id: string) {
    parse(z.uuid(), id);
    return { items: await this.areas.versions(id) };
  }

  @Put(':id')
  @Roles('admin')
  update(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthRequest) {
    parse(z.uuid(), id);
    return this.areas.update(id, request.account.id, body);
  }
}
