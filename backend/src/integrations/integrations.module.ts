import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { AvantioAdapter } from './avantio/avantio.adapter';
import { BookingSyncService } from './booking-sync.service';
import { IntegrationsController } from './integrations.controller';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [IntegrationsController],
  providers: [AvantioAdapter, BookingSyncService],
  exports: [BookingSyncService, AvantioAdapter],
})
export class IntegrationsModule {}
