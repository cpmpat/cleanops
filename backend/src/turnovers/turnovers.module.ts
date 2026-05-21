import { Module } from '@nestjs/common';
import { TurnoversController } from './turnovers.controller';
import { TurnoversService } from './turnovers.service';
import { AuthModule } from '../auth/auth.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { IncidentsModule } from '../incidents/incidents.module';

@Module({
  imports: [AuthModule, WebsocketModule, IncidentsModule],
  controllers: [TurnoversController],
  providers: [TurnoversService],
  exports: [TurnoversService],
})
export class TurnoversModule {}
