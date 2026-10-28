import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { Database } from './database';
import { AccessGuard, AuthRequest, Roles } from './security';
import { parse } from './validation';
import { loadConfig } from './config';
import { requiredKinds } from './document-policy';

export const profileSelect = `user_id AS "userId", vehicle_plate AS "vehiclePlate", vehicle_type AS "vehicleType", status,
 rejection_reason AS "rejectionReason", updated_at AS "updatedAt"`;
const profileSchema = z
  .object({
    vehiclePlate: z.string().trim().min(4).max(20),
    vehicleType: z.enum(['motorcycle', 'car']),
  })
  .strict();

@Controller('drivers')
@UseGuards(AccessGuard)
export class DriversController {
  constructor(@Inject(Database) private readonly database: Database) {}
  @Get('me')
  @Roles('driver')
  async me(@Req() request: AuthRequest) {
    return (
      (
        await this.database.pool.query(
          `SELECT ${profileSelect} FROM driver_profiles WHERE user_id = $1`,
          [request.account.id],
        )
      ).rows[0] ?? null
    );
  }
  @Post('me')
  @Roles('driver')
  async submit(@Body() body: unknown, @Req() request: AuthRequest) {
    const input = parse(profileSchema, body);
    const result = await this.database.pool.query(
      `INSERT INTO driver_profiles (user_id, vehicle_plate, vehicle_type)
      VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE
      SET vehicle_plate = EXCLUDED.vehicle_plate, vehicle_type = EXCLUDED.vehicle_type,
          status = 'pending', rejection_reason = NULL, reviewed_by = NULL, reviewed_at = NULL,
          updated_at = GREATEST(clock_timestamp(), driver_profiles.updated_at + interval '1 millisecond')
      WHERE driver_profiles.status <> 'approved' RETURNING ${profileSelect}`,
      [request.account.id, input.vehiclePlate, input.vehicleType],
    );
    if (!result.rows[0])
      throw new ConflictException('Approved profile changes require an administrator');
    return result.rows[0];
  }
  @Patch('me/availability')
  @Roles('driver')
  async availability(@Body() body: unknown, @Req() request: AuthRequest) {
    const { available } = parse(z.object({ available: z.boolean() }).strict(), body);
    return this.database.transaction(async (client) => {
      const profile = (
        await client.query<{ status: string }>(
          'SELECT status FROM driver_profiles WHERE user_id = $1 FOR UPDATE',
          [request.account.id],
        )
      ).rows[0];
      if (available && profile?.status !== 'approved')
        throw new ForbiddenException('Driver approval required');
      // Initial phase only supports going offline. GPS/presence is implemented in SG-018.
      if (available)
        throw new ConflictException('Online mode awaits GPS and dispatch implementation (SG-018)');
      await client.query('UPDATE driver_locations SET is_available = false WHERE driver_id = $1', [
        request.account.id,
      ]);
      return { available: false };
    });
  }
}

@Controller('admin/drivers')
@UseGuards(AccessGuard)
@Roles('admin', 'dispatcher')
export class AdminDriversController {
  constructor(@Inject(Database) private readonly database: Database) {}
  @Get()
  async list(@Query() query: unknown) {
    const input = parse(
      z
        .object({
          page: z.coerce.number().int().min(1).max(10000).default(1),
          status: z.enum(['pending', 'approved', 'rejected']).optional(),
        })
        .strict(),
      query,
    );
    const values = [input.status ?? null];
    const count = await this.database.pool.query<{ total: number }>(
      'SELECT count(*)::int AS total FROM driver_profiles WHERE ($1::text IS NULL OR status = $1)',
      values,
    );
    const result = await this.database.pool.query(
      `SELECT p.user_id AS "userId", p.vehicle_plate AS "vehiclePlate", p.vehicle_type AS "vehicleType",
      p.status, p.rejection_reason AS "rejectionReason", p.updated_at AS "updatedAt", u.phone, u.display_name AS "displayName"
      FROM driver_profiles p JOIN users u ON u.id = p.user_id
      WHERE ($1::text IS NULL OR p.status = $1) ORDER BY p.updated_at DESC, p.user_id LIMIT 20 OFFSET $2`,
      [...values, (input.page - 1) * 20],
    );
    return { items: result.rows, page: input.page, pageSize: 20, total: count.rows[0]?.total ?? 0 };
  }
  @Patch(':id/review')
  async review(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthRequest) {
    parse(z.uuid(), id);
    const input = parse(
      z
        .object({
          status: z.enum(['approved', 'rejected']),
          reason: z.string().trim().min(3).max(500).optional(),
          expectedUpdatedAt: z.iso.datetime({ offset: true }),
        })
        .strict(),
      body,
    );
    if (input.status === 'rejected' && !input.reason)
      throw new ConflictException('Rejection reason required');
    return this.database.transaction(async (client) => {
      const previous = (
        await client.query('SELECT * FROM driver_profiles WHERE user_id = $1 FOR UPDATE', [id])
      ).rows[0];
      if (!previous) throw new NotFoundException();
      if (input.status === 'approved') {
        const documents = await client.query<{ kind: string; viewed: boolean }>(
          `SELECT d.kind, EXISTS(SELECT 1 FROM audit_logs a WHERE a.actor_id=$2 AND a.entity_id=$1
            AND a.action='driver.document.viewed' AND a.metadata->>'documentId'=d.id::text AND a.metadata->>'profileUpdatedAt'=$3) AS viewed
           FROM driver_documents d WHERE d.driver_id=$1 AND d.superseded_at IS NULL`,
          [id, request.account.id, new Date(previous.updated_at).toISOString()],
        );
        const present = new Set(documents.rows.map((row) => row.kind));
        if (
          requiredKinds(loadConfig().DRIVER_REQUIRED_DOCUMENTS).some((kind) => !present.has(kind))
        ) {
          throw new ConflictException(
            'Required driver documents are missing. Reload and inspect all documents before approval.',
          );
        }
        const viewed = new Set(documents.rows.filter((row) => row.viewed).map((row) => row.kind));
        if (requiredKinds(loadConfig().DRIVER_REQUIRED_DOCUMENTS).some((kind) => !viewed.has(kind)))
          throw new ConflictException(
            'Open every required current document before approving this driver',
          );
      }
      // Compare timestamps inside PostgreSQL to preserve microsecond precision.
      const result = await client.query(
        `UPDATE driver_profiles SET status=$2, rejection_reason=$3,
        reviewed_by=$4, reviewed_at=now(), updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond')
        WHERE user_id=$1 AND updated_at=$5::timestamptz AND status='pending'
        RETURNING ${profileSelect}`,
        [
          id,
          input.status,
          input.status === 'rejected' ? input.reason : null,
          request.account.id,
          input.expectedUpdatedAt,
        ],
      );
      if (!result.rows[0]) throw new ConflictException('Profile changed. Reload before reviewing.');
      await client.query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
        VALUES ($1, 'driver.review', 'driver_profile', $2, $3)`,
        [
          request.account.id,
          id,
          JSON.stringify({ from: previous.status, to: input.status, reason: input.reason ?? null }),
        ],
      );
      return result.rows[0];
    });
  }
  @Post(':id/reopen')
  @Roles('admin')
  async reopen(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthRequest) {
    parse(z.uuid(), id);
    const input = parse(
      z
        .object({
          reason: z.string().trim().min(3).max(500),
          expectedUpdatedAt: z.iso.datetime({ offset: true }),
        })
        .strict(),
      body,
    );
    return this.database.transaction(async (client) => {
      const current = (
        await client.query('SELECT status FROM driver_profiles WHERE user_id=$1 FOR UPDATE', [id])
      ).rows[0];
      if (!current) throw new NotFoundException();
      const profile = (
        await client.query(
          `UPDATE driver_profiles SET status='pending',reviewed_by=NULL,reviewed_at=NULL,rejection_reason=NULL,
        updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE user_id=$1 AND status='approved' AND updated_at=$2::timestamptz RETURNING ${profileSelect}`,
          [id, input.expectedUpdatedAt],
        )
      ).rows[0];
      if (!profile)
        throw new ConflictException('Profile changed or is not approved. Reload before reopening.');
      await client.query('UPDATE driver_locations SET is_available=false WHERE driver_id=$1', [id]);
      await client.query(
        `INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES($1,'driver.review.reopened','driver_profile',$2,$3)`,
        [
          request.account.id,
          id,
          JSON.stringify({ from: 'approved', to: 'pending', reason: input.reason }),
        ],
      );
      return profile;
    });
  }
}
