import type { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import type { Config } from './config';
import { parseAllowedOrigins } from './web-auth-policy';

/** Exact-origin credentialed CORS (ADR-002). Preflight exposes only what clients need. */
export function corsOptions(config: Pick<Config, 'CORS_ORIGINS'>) {
  return {
    origin: parseAllowedOrigins(config.CORS_ORIGINS),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-CSRF-Token'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  };
}

export function configureHttp(app: INestApplication, config: Config) {
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.enableCors(corsOptions(config));
}
