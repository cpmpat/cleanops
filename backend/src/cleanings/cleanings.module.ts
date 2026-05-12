import { Module } from '@nestjs/common';
import { CleaningsController } from './cleanings.controller';
import { CleaningsService } from './cleanings.service';
import { AuthModule } from '../auth/auth.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { IncidentsModule } from '../incidents/incidents.module';

@Module({
  imports: [AuthModule, WebsocketModule, IncidentsModule],
  controllers: [CleaningsController],
  providers: [CleaningsService],
  exports: [CleaningsService],
})
export class CleaningsModule {}
