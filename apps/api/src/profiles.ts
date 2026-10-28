import {
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Patch,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { Database } from './database';
import { AccessGuard, AuthRequest } from './security';
import { parse } from './validation';

const profileSelect = `id, phone, role, display_name AS "displayName",
  profile_version AS version, profile_updated_at AS "updatedAt"`;
export const displayNameSchema = z
  .string()
  .refine(
    (value) => !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value),
    'Display name must not contain control characters',
  )
  .transform((value) => value.normalize('NFC').trim().replace(/\s+/gu, ' '))
  .pipe(z.string().min(2).max(80));
const updateProfileSchema = z
  .object({
    displayName: displayNameSchema,
    expectedVersion: z.number().int().nonnegative().max(2147483646),
  })
  .strict();

@Controller('users')
@UseGuards(AccessGuard)
export class ProfilesController {
  constructor(@Inject(Database) private readonly database: Database) {}
  @Get('me') async me(@Req() request: AuthRequest) {
    const result = await this.database.pool.query(
      `SELECT ${profileSelect} FROM users WHERE id=$1 AND status='active'`,
      [request.account.id],
    );
    if (!result.rows[0]) throw new UnauthorizedException();
    return result.rows[0];
  }
  @Patch('me') async update(@Body() body: unknown, @Req() request: AuthRequest) {
    const input = parse(updateProfileSchema, body);
    return this.database.transaction(async (client) => {
      const current = (
        await client.query(
          `SELECT ${profileSelect} FROM users WHERE id=$1 AND status='active' FOR UPDATE`,
          [request.account.id],
        )
      ).rows[0];
      if (!current) throw new UnauthorizedException();
      if (current.version !== input.expectedVersion)
        throw new ConflictException('Profile changed. Reload before saving.');
      if (current.displayName === input.displayName) return current;
      const updated = (
        await client.query(
          `UPDATE users SET display_name=$2, profile_version=profile_version+1, profile_updated_at=clock_timestamp()
        WHERE id=$1 RETURNING ${profileSelect}`,
          [request.account.id, input.displayName],
        )
      ).rows[0];
      // Record the field and version, not the old/new personal name.
      await client.query(
        `INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata)
        VALUES($1,'user.profile.updated','user',$1,$2)`,
        [request.account.id, JSON.stringify({ fields: ['displayName'], version: updated.version })],
      );
      return updated;
    });
  }
}
