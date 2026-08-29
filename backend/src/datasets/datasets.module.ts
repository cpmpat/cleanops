import { Module } from '@nestjs/common';
import { DatasetsController } from './datasets.controller';
import { DatasetsService } from './datasets.service';
import { GoogleSheetsClient } from './google-sheets.client';

@Module({
  controllers: [DatasetsController],
  providers: [DatasetsService, GoogleSheetsClient],
  exports: [DatasetsService],
})
export class DatasetsModule {}
