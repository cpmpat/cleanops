import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { DatasetsModule } from '../datasets/datasets.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [AuthModule, WebsocketModule, DatasetsModule],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
