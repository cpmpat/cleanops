import { Module } from '@nestjs/common';
import { WebsocketModule } from '../websocket/websocket.module';
import { OffboardingService } from './offboarding.service';
import { OffboardingJob } from './offboarding.job';

@Module({
  imports: [WebsocketModule],
  providers: [OffboardingService, OffboardingJob],
  exports: [OffboardingService],
})
export class OffboardingModule {}
