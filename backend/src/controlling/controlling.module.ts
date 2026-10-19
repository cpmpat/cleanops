import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ControllingController } from './controlling.controller';
import { ControllingService } from './controlling.service';

@Module({
  imports: [AuthModule],
  controllers: [ControllingController],
  providers: [ControllingService],
})
export class ControllingModule {}
