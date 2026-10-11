import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { WorkersModule } from './workers/workers.module';
import { JobsModule } from './jobs/jobs.module';
import { ChatModule } from './chat/chat.module';
import { ServicesModule } from './services/services.module';
import { AiModule } from './ai/ai.module';
import { AppController } from './app.controller';
import { AddressesModule } from './addresses/addresses.module';
import { QuotesModule } from './quotes/quotes.module';
import { ReviewsModule } from './reviews/reviews.module';
import { ChangeOrdersModule } from './change-orders/change-orders.module';
import { DisputesModule } from './disputes/disputes.module';
import { ServiceCatalogModule } from './service-catalog/service-catalog.module';
import { PropertiesModule } from './properties/properties.module';
import { RecurringJobsModule } from './recurring-jobs/recurring-jobs.module';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';
import { AppConfigController } from './config/config.controller';
import { AdminModule } from './admin/admin.module';
import { MatchingModule } from './matching/matching.module';
import { OffersModule } from './offers/offers.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RealtimeModule } from './realtime/realtime.module';
import { TrackingModule } from './tracking/tracking.module';
import { StorageModule } from './storage/storage.module';
import { CommonModule } from './common/common.module';
import { RedisThrottlerStorage } from './common/throttle/redis-throttler.storage';
import { validateEnv } from './config/env.validation';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { PaymentsModule } from './payments/payments.module';
import { SafetyModule } from './safety/safety.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
      validate: validateEnv,
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        throttlers: [{ ttl: 60000, limit: 100 }],
        // Several API instances must share counters; one instance can keep them in memory.
        storage: c.get<string>('REDIS_URL') ? new RedisThrottlerStorage(c.get<string>('REDIS_URL')!) : undefined,
      }),
    }),
    DatabaseModule,
    CommonModule,
    RealtimeModule,
    TrackingModule,
    StorageModule,
    AdminModule,
    MatchingModule,
    OffersModule,
    NotificationsModule,
    AuthModule,
    UsersModule,
    WorkersModule,
    JobsModule,
    ChatModule,
    ServicesModule,
    AiModule,
    AddressesModule,
    QuotesModule,
    ReviewsModule,
    ChangeOrdersModule,
    DisputesModule,
    ServiceCatalogModule,
    PropertiesModule,
    RecurringJobsModule,
    PaymentsModule,
    SafetyModule,
  ],
  controllers: [AppController, AppConfigController],
  providers: [
    // Order matters: throttle first, then authenticate, then authorise by role.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Staff routes: one permission each, deny by default (common/auth/permissions.ts).
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(requestIdMiddleware).forRoutes('*');
  }
}
