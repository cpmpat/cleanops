// backend/src/jobs/safety-sweep.job.ts
//
// Runs SafetySweepService for every tenant that syncs with a PMS, nightly at
// 03:20 Prague: after the 03:07 sync, before the 03:37 one, clear of
// Avantio's :00/:30 job and the 03:00 staff sync. Off with
// SAFETY_SWEEP_ENABLED=false.

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma.service';
import { SafetySweepService } from '../integrations/safety-sweep.service';
import { APP_TIME_ZONE } from '../common/time';
import { pmsSyncLock } from './pms-sync-lock';

const LOCK_NAME = 'safety-sweep';
const WAIT_FOR_SYNC_MS = 10 * 60 * 1000;

@Injectable()
export class SafetySweepJob {
  private readonly logger = new Logger(SafetySweepJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sweep: SafetySweepService,
  ) {}

  @Cron('20 3 * * *', { timeZone: APP_TIME_ZONE })
  async nightly(): Promise<void> {
    if (process.env.SAFETY_SWEEP_ENABLED === 'false') {
      this.logger.log('Safety sweep disabled (SAFETY_SWEEP_ENABLED=false)');
      return;
    }

    // A long 03:07 sync may still be running; wait for it rather than skip.
    const deadline = Date.now() + WAIT_FOR_SYNC_MS;
    while (!pmsSyncLock.tryAcquire(LOCK_NAME)) {
      if (Date.now() > deadline) {
        this.logger.error(`Safety sweep skipped: ${pmsSyncLock.holder} held the sync lock for 10 min`);
        return;
      }
      await new Promise((r) => setTimeout(r, 15_000));
    }

    try {
      const tenants = await this.prisma.tenant.findMany({
        where: { isActive: true, pmsSyncEnabled: true },
        select: { id: true, name: true },
      });
      for (const tenant of tenants) {
        try {
          await this.sweep.sweepTenant({ tenantId: tenant.id, apply: true });
        } catch (err) {
          this.logger.error(`[${tenant.name}] safety sweep failed: ${(err as Error).message}`);
        }
      }
    } finally {
      pmsSyncLock.release(LOCK_NAME);
    }
  }
}
