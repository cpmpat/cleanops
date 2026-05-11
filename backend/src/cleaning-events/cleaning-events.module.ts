import { Module } from '@nestjs/common';
import { CleaningEventsController } from './cleaning-events.controller';
import { CleaningEventsService } from './cleaning-events.service';
import { AuthModule } from '../auth/auth.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { IncidentsModule } from '../incidents/incidents.module';

@Module({
  imports: [AuthModule, WebsocketModule, IncidentsModule],
  controllers: [CleaningEventsController],
  providers: [CleaningEventsService],
  exports: [CleaningEventsService],
})
export class CleaningEventsModule {}
