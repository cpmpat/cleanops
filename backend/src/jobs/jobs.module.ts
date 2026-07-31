import { Module } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma.service';
import { IntegrationsModule } from '../integrations/integrations.module';
import { BookingSyncService } from '../integrations/booking-sync.service';
import { APP_TIME_ZONE } from '../common/time';

// ─── PMS Sync Job ───
@Injectable()
export class PmsSyncJob {
  private readonly logger = new Logger(PmsSyncJob.name);

  /**
   * Lock flag to prevent overlapping sync runs.
   * If a sync is still running when the cron fires again, the new run
   * is skipped entirely rather than running concurrently.
   */
  private isSyncing = false;

  constructor(
    private prisma: PrismaService,
    private syncService: BookingSyncService,
  ) {}

  /**
   * Runs every 5 minutes.
   * Pulls new/updated bookings from Avantio for all active tenants.
   * Skips the run if the previous one is still in progress.
   */
  @Cron('*/30 * * * *', { timeZone: APP_TIME_ZONE })
  async syncAllTenants() {
    if (this.isSyncing) {
      this.logger.warn('PMS sync already in progress — skipping this run');
      return;
    }

    this.isSyncing = true;
    this.logger.log('Starting PMS sync for all tenants...');

    try {
      const tenants = await this.prisma.tenant.findMany({
        where: { isActive: true, pmsSyncEnabled: true },
      });

      for (const tenant of tenants) {
        try {
          const result = await this.syncService.syncTenant(tenant.id);
          const b = result.bookings;
          if (b.created > 0 || b.updated > 0 || b.cancelled > 0) {
            this.logger.log(
              `[${tenant.name}] Sync: ${b.created} created, ${b.updated} updated, ${b.cancelled} cancelled`,
            );
          }
        } catch (err) {
          this.logger.error(`[${tenant.name}] Sync failed: ${err.message}`);
        }
      }
    } finally {
      // Always release the lock, even if an error is thrown
      this.isSyncing = false;
      this.logger.log('PMS sync complete');
    }
  }
}

// ─── Overdue Check Job ───
@Injectable()
export class OverdueCheckJob {
  private readonly logger = new Logger(OverdueCheckJob.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Runs every 15 minutes.
   * Checks for cleaning events that should have been completed by now
   * (check-in time approaching, cleaning not done).
   * Creates OVERDUE notifications for managers.
   */
  @Cron('*/15 * * * *', { timeZone: APP_TIME_ZONE })
  async checkOverdue() {
    // Find events where check-in is within 60 minutes and status is not COMPLETED
    const threshold = new Date(Date.now() + 60 * 60 * 1000);

    const overdueEvents = await this.prisma.cleaning.findMany({
      where: {
        status: { in: ['ASSIGNED', 'IN_PROGRESS'] },
        checkInTime: { lte: threshold },
      },
      include: {
        tenant: true,
        property: true,
        assignments: { include: { user: true } },
      },
    });

    for (const event of overdueEvents) {
      // Find managers for this tenant
      const managers = await this.prisma.user.findMany({
        where: { tenantId: event.tenantId, role: 'MANAGER', isActive: true },
      });

      for (const manager of managers) {
        // Check if we already sent an overdue notification in the last hour
        const recentNotif = await this.prisma.notification.findFirst({
          where: {
            userId: manager.id,
            type: 'OVERDUE',
            payload: { path: ['eventId'], equals: event.id },
            sentAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
          },
        });

        if (!recentNotif) {
          await this.prisma.notification.create({
            data: {
              tenantId: event.tenantId,
              userId: manager.id,
              type: 'OVERDUE',
              channel: 'IN_APP',
              title: 'Overdue Cleaning',
              body: `Cleaning for ${event.accommodationName} is overdue. Check-in at ${event.checkInTime.toISOString()}.`,
              payload: { eventId: event.id, propertyName: event.accommodationName },
            },
          });
        }
      }
    }

    if (overdueEvents.length > 0) {
      this.logger.warn(`Found ${overdueEvents.length} overdue cleaning events`);
    }
  }
}

// ─── Morning Summary Job ───
@Injectable()
export class MorningSummaryJob {
  private readonly logger = new Logger(MorningSummaryJob.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Runs at 06:00 every day.
   * Sends email summary of today's cleaning schedule to all active cleaners.
   */
  // 06:00 Prague. Without the timeZone option this fired at 06:00 UTC,
  // i.e. 08:00 local in summer — two hours after the intended send.
  @Cron('0 6 * * *', { timeZone: APP_TIME_ZONE })
  async sendMorningSummaries() {
    this.logger.log('Sending morning summaries...');

    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);

    const cleaners = await this.prisma.user.findMany({
      where: { role: 'CLEANER', isActive: true },
      include: {
        assignedCleanings: {
          where: {
            status: { in: ['ASSIGNED'] },
            cleaning: {
              timeSlot: { gte: startOfDay, lte: endOfDay },
              status: { not: 'CANCELLED' },
            },
          },
          include: { cleaning: { include: { property: true } } },
        },
      },
    });

    for (const cleaner of cleaners) {
      if (cleaner.assignedCleanings.length === 0) continue;

      const eventList = cleaner.assignedCleanings
        .map(a => `• ${a.cleaning.accommodationName} at ${a.cleaning.timeSlot.toISOString().slice(11, 16)}`)
        .join('\n');

      // Create email notification
      await this.prisma.notification.create({
        data: {
          tenantId: cleaner.tenantId,
          userId: cleaner.id,
          type: 'REMINDER',
          channel: 'EMAIL',
          title: `Today's Cleaning Schedule (${cleaner.assignedCleanings.length} assignments)`,
          body: `Good morning ${cleaner.name}!\n\nHere are your cleaning assignments for today:\n\n${eventList}\n\nHave a great day!`,
          payload: { count: cleaner.assignedCleanings.length },
        },
      });

      // TODO: Actually send email via Resend
      this.logger.log(`Morning summary for ${cleaner.email}: ${cleaner.assignedCleanings.length} assignments`);
    }
  }
}

// ─── Module ───
@Module({
  imports: [IntegrationsModule],
  providers: [PmsSyncJob, OverdueCheckJob, MorningSummaryJob],
})
export class JobsModule {}