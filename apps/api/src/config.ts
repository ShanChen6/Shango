import 'dotenv/config';
import { z } from 'zod';

export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    JWT_SECRET: z.string().min(32),
    OTP_SECRET: z.string().min(32),
    OTP_PROVIDER: z.literal('development'),
    CORS_ORIGINS: z.string().min(1),
  })
  .superRefine((env, context) => {
    if (env.NODE_ENV === 'production') {
      context.addIssue({
        code: 'custom',
        message:
          'Production disabled: implement a real SMS provider and complete the release checklist first.',
      });
    }
    if (env.JWT_SECRET === env.OTP_SECRET)
      context.addIssue({ code: 'custom', message: 'Use different signing secrets' });
  });
export type Config = z.infer<typeof environmentSchema>;
export function loadConfig(): Config {
  const parsed = environmentSchema.safeParse(process.env);
  if (!parsed.success)
    throw new Error(
      `Invalid environment: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  return parsed.data;
}
