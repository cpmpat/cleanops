import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatasetsController } from './datasets.controller';
import { DatasetsService } from './datasets.service';
import { GoogleSheetsClient } from './google-sheets.client';

@Module({
  // AuthModule, not for anything this module calls, but because the controller
  // is decorated with AuthGuard and Nest resolves a guard's dependencies in the
  // context of the module that declares the controller. Without it the app dies
  // at boot: "Nest can't resolve dependencies of the AuthGuard (?, ConfigService)".
  // Every other guarded module imports it for the same reason.
  imports: [AuthModule],
  controllers: [DatasetsController],
  providers: [DatasetsService, GoogleSheetsClient],
  exports: [DatasetsService],
})
export class DatasetsModule {}
