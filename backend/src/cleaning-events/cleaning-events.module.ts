import { Module } from '@nestjs/common';
import { CleaningEventsController } from './cleaning-events.controller';
import { CleaningEventsService } from './cleaning-events.service';
import { AuthModule } from '../auth/auth.module';
import { WebsocketModule } from '../websocket/websocket.module';

@Module({
  imports: [AuthModule, WebsocketModule],
  controllers: [CleaningEventsController],
  providers: [CleaningEventsService],
  exports: [CleaningEventsService],
})
export class CleaningEventsModule {}
