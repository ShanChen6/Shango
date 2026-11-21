import { Controller, Get, Inject, Module, ServiceUnavailableException } from '@nestjs/common';
import { AuthController, AuthService } from './auth';
import { WebAuthController, WebAuthService } from './web-auth';
import {
  AdminOrdersController,
  DispatchService,
  DriverWorkController,
  OrdersController,
  OrdersService,
  QuoteService,
} from './orders';
import { RealtimeHub } from './realtime-hub';
import { RealtimeGateway } from './realtime';
import { Metrics, MetricsController } from './metrics';
import { Cache, Database } from './database';
import { AccessGuard } from './security';
import { AdminDriversController, DriversController } from './drivers';
import { MapsController, MapsService } from './maps';
import { AdminServiceAreasController, ServiceAreaService } from './service-areas';
import { ProfilesController } from './profiles';
import { AuditController } from './audit';
import {
  AdminDocumentsController,
  DocumentContentController,
  DriverDocumentsController,
  DocumentsService,
  PrivateDocumentStore,
  DocumentRateGuard,
  UploadCapacityInterceptor,
} from './documents';

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
            "SELECT postgis_version(), (SELECT version FROM schema_migrations WHERE version='006_service_areas.sql') AS migration",
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
    WebAuthController,
    MetricsController,
    OrdersController,
    DriverWorkController,
    AdminOrdersController,
    DriversController,
    AdminDriversController,
    MapsController,
    AdminServiceAreasController,
    ProfilesController,
    AuditController,
    AdminDocumentsController,
    DocumentContentController,
    DriverDocumentsController,
  ],
  providers: [
    Database,
    Cache,
    AuthService,
    WebAuthService,
    RealtimeHub,
    Metrics,
    OrdersService,
    QuoteService,
    DispatchService,
    RealtimeGateway,
    AccessGuard,
    MapsService,
    ServiceAreaService,
    DocumentsService,
    PrivateDocumentStore,
    DocumentRateGuard,
    UploadCapacityInterceptor,
  ],
})
export class AppModule {}
