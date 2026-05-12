import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './common/prisma.module';
import { TenantMiddleware } from './common/middleware/tenant.middleware';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TenantsModule } from './tenants/tenants.module';
import { PropertiesModule } from './properties/properties.module';
import { BookingsModule } from './bookings/bookings.module';
import { CleaningsModule } from './cleanings/cleanings.module';
import { AssignmentsModule } from './assignments/assignments.module';
import { NotificationsModule } from './notifications/notifications.module';
import { TagsModule } from './tags/tags.module';
import { UploadsModule } from './uploads/uploads.module';
import { WebsocketModule } from './websocket/websocket.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { JobsModule } from './jobs/jobs.module';
import { StaffSyncModule } from './staff-sync/staff-sync.module';
import { IncidentsModule } from './incidents/incidents.module';
import { StorageModule } from './storage/storage.module';
import { StreamsModule } from './streams/streams.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    TenantsModule,
    PropertiesModule,
    BookingsModule,
    CleaningsModule,
    AssignmentsModule,
    NotificationsModule,
    TagsModule,
    UploadsModule,
    WebsocketModule,
    IntegrationsModule,
    JobsModule,
    StaffSyncModule,
    IncidentsModule,
    StorageModule,
    StreamsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TenantMiddleware)
      .exclude('api/v1/auth/(.*)', 'api/v1/admin/(.*)')
      .forRoutes('*');
  }
}
