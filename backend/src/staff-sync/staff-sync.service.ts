import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { BigQueryClient, CdmUserRow } from './bigquery.client';
import { resolveRole } from './position-mapping';
import { AuditCategory } from '@prisma/client';

export interface SyncResult {
  fetched: number;
  created: number;
  updated: number;
  disabled: number;
  reEnabled: number;
  skipped: number;
  errors: number;
  durationMs: number;
}

@Injectable()
export class StaffSyncService {
  private readonly logger = new Logger(StaffSyncService.name);
  private isSyncing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bq: BigQueryClient,
  ) {}

  async sync(tenantId: string): Promise<SyncResult> {
    if (this.isSyncing) {
      this.logger.warn('Staff sync already running, skipping');
      throw new Error('Staff sync already in progress');
    }
    this.isSyncing = true;
    const startedAt = Date.now();

    const result: SyncResult = {
      fetched: 0, created: 0, updated: 0,
      disabled: 0, reEnabled: 0, skipped: 0, errors: 0,
      durationMs: 0,
    };

    try {
      const rows = await this.bq.fetchValidStaff();
      result.fetched = rows.length;

      const seenCdmIds = new Set<string>();

      for (const row of rows) {
        try {
          await this.upsertOne(tenantId, row, result);
          seenCdmIds.add(row.userId);
        } catch (err) {
          this.logger.error(
            `Failed to upsert ${row.userId} (${row.email})`,
            err,
          );
          result.errors++;
        }
      }

      // Disable users no longer in the Valid set (but only sync-managed ones)
      result.disabled = await this.disableMissing(tenantId, seenCdmIds);

      result.durationMs = Date.now() - startedAt;

      await this.prisma.auditEvent.create({
        data: {
          tenantId,
          category: AuditCategory.SYNC,
          action: 'staff_sync.completed',
          targetType: 'System',
          actorEmail: 'system',
          metadata: result as any,
        },
      });

      this.logger.log(`Staff sync done: ${JSON.stringify(result)}`);
      return result;
    } catch (err) {
      result.durationMs = Date.now() - startedAt;
      await this.prisma.auditEvent.create({
        data: {
          tenantId,
          category: AuditCategory.SYNC,
          action: 'staff_sync.failed',
          targetType: 'System',
          actorEmail: 'system',
          metadata: { error: String(err), ...result } as any,
        },
      });
      throw err;
    } finally {
      this.isSyncing = false;
    }
  }

  private async upsertOne(
    tenantId: string,
    row: CdmUserRow,
    result: SyncResult,
  ): Promise<void> {
    const role = resolveRole(row.position);
    if (!role) {
      result.skipped++;
      return;
    }

    const fullName = [row.firstName, row.lastName]
      .filter((s) => s && s.trim().length > 0)
      .join(' ')
      .trim() || row.email;

    const existing = await this.prisma.user.findUnique({
      where: { cdmUserId: row.userId },
    });

    const now = new Date();

    if (!existing) {
      // Email collision check: someone else already has this email in this tenant
      const emailClash = await this.prisma.user.findUnique({
        where: { tenantId_email: { tenantId, email: row.email } },
      });
      if (emailClash) {
        this.logger.warn(
          `Email collision: ${row.email} exists (cdmUserId=${emailClash.cdmUserId}, ` +
          `isSyncManaged=${emailClash.isSyncManaged}); incoming cdmUserId=${row.userId}. Skipping.`,
        );
        result.errors++;
        return;
      }

      await this.prisma.user.create({
        data: {
          tenantId,
          cdmUserId: row.userId,
          email: row.email,
          name: fullName,
          role,
          position: row.position,
          isActive: true,
          isSyncManaged: true,
          lastSyncedAt: now,
        },
      });
      result.created++;
      return;
    }

    // Existing row — respect the sync-exempt flag (admin escape hatch)
    if (!existing.isSyncManaged) {
      result.skipped++;
      return;
    }

    const wasInactive = !existing.isActive;
    const needsUpdate =
      existing.email !== row.email ||
      existing.name !== fullName ||
      existing.position !== row.position ||
      existing.role !== role ||
      wasInactive;

    if (needsUpdate) {
      await this.prisma.user.update({
        where: { id: existing.id },
        data: {
          email: row.email,
          name: fullName,
          position: row.position,
          role,
          isActive: true,
          disabledAt: null,
          lastSyncedAt: now,
        },
      });
      if (wasInactive) result.reEnabled++;
      else result.updated++;
    } else {
      // Just bump the watermark
      await this.prisma.user.update({
        where: { id: existing.id },
        data: { lastSyncedAt: now },
      });
    }
  }

  private async disableMissing(
    tenantId: string,
    seenCdmIds: Set<string>,
  ): Promise<number> {
    // Only touch sync-managed active users — admin accounts (isSyncManaged=false)
    // are permanently exempt from this pass
    const stillActive = await this.prisma.user.findMany({
      where: {
        tenantId,
        isActive: true,
        isSyncManaged: true,
      },
      select: { id: true, cdmUserId: true, email: true },
    });

    const toDisable = stillActive.filter(
      (u) => u.cdmUserId && !seenCdmIds.has(u.cdmUserId),
    );
    if (toDisable.length === 0) return 0;

    const now = new Date();
    await this.prisma.user.updateMany({
      where: { id: { in: toDisable.map((u) => u.id) } },
      data: { isActive: false, disabledAt: now },
    });

    // Audit each disable individually so Monitor can show them
    for (const u of toDisable) {
      await this.prisma.auditEvent.create({
        data: {
          tenantId,
          category: AuditCategory.USER_LIFECYCLE,
          action: 'user.disabled_by_sync',
          targetType: 'User',
          targetId: u.id,
          actorEmail: 'system',
          metadata: {
            reason: 'no_longer_in_cdm_user_valid',
            email: u.email,
          } as any,
        },
      });
    }

    return toDisable.length;
  }
}
