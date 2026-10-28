import 'dotenv/config';
import { z } from 'zod';
import { validRequiredKinds } from './document-policy';

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
    NOMINATIM_BASE_URL: z.string().url().optional(),
    NOMINATIM_PUBLIC_OPT_IN: z.enum(['true', 'false']).default('false'),
    NOMINATIM_USER_AGENT: z
      .string()
      .min(12)
      .default('ShanGo/0.1 (+https://github.com/ShanChen6/Shango)'),
    OSRM_BASE_URL: z.string().url().optional(),
    PRIVATE_DOCUMENTS_DIR: z.string().min(1).default('.private-documents'),
    DRIVER_REQUIRED_DOCUMENTS: z
      .string()
      .default('identity_front,identity_back,driver_license,vehicle_registration')
      .refine(validRequiredKinds, 'Choose a nonempty, unique list of supported document kinds'),
  })
  .superRefine((env, context) => {
    for (const key of ['NOMINATIM_BASE_URL', 'OSRM_BASE_URL'] as const) {
      if (!env[key]) continue;
      let url: URL;
      try {
        url = new URL(env[key]);
      } catch {
        continue;
      }
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      ) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'Use an HTTP(S) base URL without credentials, query or fragment',
        });
      }
      if (
        key === 'NOMINATIM_BASE_URL' &&
        url.hostname === 'nominatim.openstreetmap.org' &&
        (env.NOMINATIM_PUBLIC_OPT_IN !== 'true' || url.protocol !== 'https:')
      ) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'Public Nominatim requires explicit development opt-in and HTTPS',
        });
      }
      if (key === 'OSRM_BASE_URL' && url.hostname === 'router.project-osrm.org') {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'Configure your own OSRM instance instead of the public demo',
        });
      }
    }
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
