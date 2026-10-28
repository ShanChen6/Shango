import { Controller, Get, Inject, Module, ServiceUnavailableException } from '@nestjs/common';
import { AuthController, AuthService } from './auth';
import { Cache, Database } from './database';
import { AccessGuard } from './security';
import { AdminDriversController, DriversController } from './drivers';
import { MapsController, MapsService } from './maps';

@Controller('health')
class HealthController {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(Cache) private readonly cache: Cache,
  ) {}
  @Get('live') live() {
    return { status: 'ok' };
  }
  @Get('ready') async ready() {
    try {
      await Promise.all([
        this.database.pool
          .query(
            "SELECT postgis_version(), (SELECT version FROM schema_migrations WHERE version='001_foundation.sql') AS migration",
          )
          .then((result) => {
            if (!result.rows[0]?.migration) throw new Error('Migration missing');
          }),
        this.cache.redis.ping(),
      ]);
      return { status: 'ready', database: 'ok', redis: 'ok' };
    } catch {
      throw new ServiceUnavailableException('Dependencies unavailable or migrations pending');
    }
  }
}
@Module({
  controllers: [
    HealthController,
    AuthController,
    DriversController,
    AdminDriversController,
    MapsController,
  ],
  providers: [Database, Cache, AuthService, AccessGuard, MapsService],
})
export class AppModule {}
