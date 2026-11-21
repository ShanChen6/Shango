import type { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import type { Config } from './config';
import { Metrics } from './metrics';
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
  // Only trust X-Forwarded-For from the configured number of proxy hops (Caddy = 1).
  app.getHttpAdapter().getInstance().set('trust proxy', config.TRUST_PROXY_HOPS || false);
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.use(app.get(Metrics).middleware());
  app.enableCors(corsOptions(config));
}
