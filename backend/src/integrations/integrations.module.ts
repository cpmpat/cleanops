import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AvantioAdapter } from './avantio/avantio.adapter';
import { BookingSyncService } from './booking-sync.service';
import { IntegrationsController } from './integrations.controller';

@Module({
  imports: [AuthModule],
  controllers: [IntegrationsController],
  providers: [AvantioAdapter, BookingSyncService],
  exports: [BookingSyncService, AvantioAdapter],
})
export class IntegrationsModule {}
