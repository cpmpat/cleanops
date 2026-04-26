import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma.module';
import { StaffSyncService } from './staff-sync.service';
import { StaffSyncJob } from './staff-sync.job';
import { StaffSyncController } from './staff-sync.controller';
import { BigQueryClient } from './bigquery.client';

@Module({
  imports: [PrismaModule],
  providers: [StaffSyncService, StaffSyncJob, BigQueryClient],
  controllers: [StaffSyncController],
  exports: [StaffSyncService],
})
export class StaffSyncModule {}
