import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { AvantioAdapter } from './avantio/avantio.adapter';
import { BookingSyncService } from './booking-sync.service';
import { TurnoverSyncService } from './turnover-sync.service';
import { TurnoverReconcileService } from './turnover-reconcile.service';
import { SafetySweepService } from './safety-sweep.service';
import { CheckInAgentService } from './checkin-agent.service';
import { IntegrationsController } from './integrations.controller';
import { CheckInsController } from './checkins.controller';

@Module({
  imports: [AuthModule, StorageModule, WebsocketModule],
  controllers: [IntegrationsController, CheckInsController],
  providers: [
    AvantioAdapter,
    BookingSyncService,
    TurnoverSyncService,
    TurnoverReconcileService,
    SafetySweepService,
    CheckInAgentService,
  ],
  exports: [
    BookingSyncService,
    AvantioAdapter,
    TurnoverSyncService,
    TurnoverReconcileService,
    SafetySweepService,
  ],
})
export class IntegrationsModule {}
