import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { StreamsService } from './streams.service';
import { StreamsController } from './streams.controller';

@Module({
  imports: [AuthModule, WebsocketModule],
  providers: [StreamsService],
  controllers: [StreamsController],
  exports: [StreamsService],
})
export class StreamsModule {}
