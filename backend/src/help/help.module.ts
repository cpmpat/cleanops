import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { HelpService } from './help.service';
import { HelpController } from './help.controller';

@Module({
  imports: [AuthModule],
  providers: [HelpService],
  controllers: [HelpController],
  exports: [HelpService],
})
export class HelpModule {}
