import { Controller, Post, Param, Logger, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { AuthGuard, RolesGuard, Roles } from '../common/guards/auth.guard';
import { TenantRequest } from '../common/middleware/tenant.middleware';
import { StaffSyncService } from './staff-sync.service';

/**
 * Manual trigger for the staff sync.
 *
 * Until 15 Oct 2026 this route had no guard at all: anyone on the internet who
 * knew a tenant id could start a sync. It now needs a signed-in MANAGER (the
 * company's administrator; the ADMIN role passes every check too), and only
 * for the caller's own tenant.
 */
@UseGuards(AuthGuard, RolesGuard)
@Roles('MANAGER')
@Controller('admin/staff-sync')
export class StaffSyncController {
  private readonly logger = new Logger(StaffSyncController.name);

  constructor(private readonly staffSync: StaffSyncService) {}

  // POST /admin/staff-sync/:tenantId/run
  @Post(':tenantId/run')
  async runManual(@Req() req: TenantRequest, @Param('tenantId') tenantId: string) {
    if (tenantId !== req.tenantId) throw new ForbiddenException('Not your tenant');
    this.logger.log(`Manual staff sync triggered for tenant ${tenantId} by ${req.userId}`);
    return this.staffSync.sync(tenantId);
  }
}
