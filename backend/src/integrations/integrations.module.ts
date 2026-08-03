import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { AvantioAdapter } from './avantio/avantio.adapter';
import { BookingSyncService } from './booking-sync.service';
import { TurnoverSyncService } from './turnover-sync.service';
import { TurnoverReconcileService } from './turnover-reconcile.service';
import { IntegrationsController } from './integrations.controller';

@Module({
  imports: [AuthModule, StorageModule, WebsocketModule],
  controllers: [IntegrationsController],
  providers: [
    AvantioAdapter,
    BookingSyncService,
    TurnoverSyncService,
    TurnoverReconcileService,
  ],
  exports: [
    BookingSyncService,
    AvantioAdapter,
    TurnoverSyncService,
    TurnoverReconcileService,
  ],
})
export class IntegrationsModule {}
