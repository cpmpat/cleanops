import { Controller, Post, Param, Logger } from '@nestjs/common';
import { StaffSyncService } from './staff-sync.service';

/**
 * Manual trigger for the staff sync.
 *
 * ⚠️  TODO: lock this behind a manager/admin guard before deploying to prod.
 *    For now it's open so we can test the flow end-to-end.
 */
@Controller('admin/staff-sync')
export class StaffSyncController {
  private readonly logger = new Logger(StaffSyncController.name);

  constructor(private readonly staffSync: StaffSyncService) {}

  // POST /admin/staff-sync/:tenantId/run
  @Post(':tenantId/run')
  async runManual(@Param('tenantId') tenantId: string) {
    this.logger.log(`Manual staff sync triggered for tenant ${tenantId}`);
    return this.staffSync.sync(tenantId);
  }
}
