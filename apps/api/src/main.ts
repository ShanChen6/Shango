import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app';
import { loadConfig } from './config';

async function main() {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule, { bodyParser: true });
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.enableCors({
    origin: config.CORS_ORIGINS.split(',').map((value) => value.trim()),
    credentials: false,
  });
  app.use((request: Request, response: Response, next: NextFunction) => {
    const requestId = randomUUID();
    const start = Date.now();
    response.setHeader('X-Request-Id', requestId);
    response.on('finish', () =>
      console.log(
        JSON.stringify({
          requestId,
          method: request.method,
          status: response.statusCode,
          durationMs: Date.now() - start,
        }),
      ),
    );
    next();
  });
  app.enableShutdownHooks();
  await app.listen(config.PORT, '0.0.0.0');
}
void main().catch(() => {
  console.error('API startup failed. Check environment and dependency configuration.');
  process.exitCode = 1;
});
