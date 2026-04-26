import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma.service';
import { StaffSyncService } from './staff-sync.service';

@Injectable()
export class StaffSyncJob {
  private readonly logger = new Logger(StaffSyncJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly staffSync: StaffSyncService,
  ) {}

  // Daily at 03:00 Europe/Prague — after any late-night cleanings,
  // before morning shifts, clear of the Avantio sync window.
  @Cron('0 3 * * *', { timeZone: 'Europe/Prague' })
  async handleDailySync(): Promise<void> {
    this.logger.log('Starting scheduled staff sync');

    const tenants = await this.prisma.tenant.findMany({
      where: { isActive: true },
      select: { id: true, slug: true },
    });

    for (const tenant of tenants) {
      try {
        await this.staffSync.sync(tenant.id);
      } catch (err) {
        this.logger.error(
          `Staff sync failed for tenant ${tenant.slug}`,
          err,
        );
        // Don't throw — keep going to other tenants
      }
    }
  }
}
