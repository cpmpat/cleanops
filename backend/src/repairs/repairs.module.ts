import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RepairsService } from './repairs.service';
import { RepairMaterialsService } from './repair-materials.service';
import { RepairsController, RepairMaterialsController } from './repairs.controller';

@Module({
  imports: [AuthModule],
  providers: [RepairsService, RepairMaterialsService],
  controllers: [RepairsController, RepairMaterialsController],
  exports: [RepairsService, RepairMaterialsService],
})
export class RepairsModule {}
