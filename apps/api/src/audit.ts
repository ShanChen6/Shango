import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { Database } from './database';
import { AccessGuard, Roles } from './security';
import { parse } from './validation';

export const auditQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z
      .string()
      .regex(/^[1-9]\d{0,18}$/)
      .refine(
        (value) => /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n,
        'Invalid cursor',
      )
      .optional(),
    actorId: z.uuid().optional(),
    entityId: z.uuid().optional(),
    action: z.enum(['user.profile.updated', 'driver.review', 'admin.bootstrap']).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
  })
  .strict()
  .refine(
    (input) => !input.from || !input.to || Date.parse(input.from) < Date.parse(input.to),
    'from must be earlier than to',
  );

const metadataSchemas = {
  'user.profile.updated': z.object({
    fields: z.array(z.literal('displayName')),
    version: z.number().int().nonnegative(),
  }),
  'driver.review': z.object({
    from: z.enum(['pending', 'approved', 'rejected']),
    to: z.enum(['approved', 'rejected']),
    reason: z.string().max(500).nullable(),
  }),
  'admin.bootstrap': z.object({ source: z.literal('operator-cli') }),
};
export function auditMetadata(action: string, value: unknown): Record<string, unknown> {
  const schema = Object.hasOwn(metadataSchemas, action)
    ? metadataSchemas[action as keyof typeof metadataSchemas]
    : undefined;
  if (!schema) return {};
  const result = schema.safeParse(value);
  return result.success ? result.data : {};
}

@Controller('admin/audit-logs')
@UseGuards(AccessGuard)
@Roles('admin')
export class AuditController {
  constructor(@Inject(Database) private readonly database: Database) {}
  @Get() async list(@Query() query: unknown) {
    const input = parse(auditQuerySchema, query);
    const result = await this.database.pool.query<{
      id: string;
      actorId: string;
      actorDisplayName: string | null;
      action: string;
      entityType: string;
      entityId: string;
      metadata: unknown;
      createdAt: Date;
    }>(
      `SELECT a.id::text, a.actor_id AS "actorId", u.display_name AS "actorDisplayName", a.action,
      a.entity_type AS "entityType", a.entity_id AS "entityId", a.metadata, a.created_at AS "createdAt"
      FROM audit_logs a JOIN users u ON u.id=a.actor_id
      WHERE ($1::bigint IS NULL OR a.id < $1)
        AND ($2::uuid IS NULL OR a.actor_id=$2)
        AND ($3::uuid IS NULL OR a.entity_id=$3)
        AND ($4::text IS NULL OR a.action=$4)
        AND ($5::timestamptz IS NULL OR a.created_at >= $5)
        AND ($6::timestamptz IS NULL OR a.created_at < $6)
      ORDER BY a.id DESC LIMIT $7`,
      [
        input.cursor ?? null,
        input.actorId ?? null,
        input.entityId ?? null,
        input.action ?? null,
        input.from ?? null,
        input.to ?? null,
        input.limit + 1,
      ],
    );
    const items = result.rows
      .slice(0, input.limit)
      .map((row) => ({ ...row, metadata: auditMetadata(row.action, row.metadata) }));
    return { items, nextCursor: result.rows.length > input.limit ? items.at(-1)!.id : null };
  }
}
