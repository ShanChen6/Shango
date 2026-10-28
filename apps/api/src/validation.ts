import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException({
      message: 'Invalid request',
      fields: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  return result.data;
}
export const phoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/, 'Use E.164, e.g. +84901234567');
export const publicRoleSchema = z.enum(['customer', 'driver']);
