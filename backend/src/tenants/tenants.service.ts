import { Injectable, NotFoundException } from '@nestjs/common';
import { Tenant } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { decryptSecret, encryptSecret, isEncrypted, maskSecret } from '../common/crypto';

/** A tenant as the API is allowed to describe it — the PMS key replaced by facts about it. */
export type TenantView = Omit<Tenant, 'pmsApiKey'> & {
  /** Whether a key is configured at all. Drives the "not configured" state in Settings. */
  pmsApiKeySet: boolean;
  /** Last four characters, for "is this the key I think it is?". Never more. */
  pmsApiKeyHint: string | null;
  /**
   * False for a key written before encryption existed. Surfaced so the screen
   * can say so: a legacy value still works, and is still plaintext in every
   * backup until it is re-saved.
   */
  pmsApiKeyEncrypted: boolean;
};

@Injectable()
export class TenantsService {
  constructor(private prisma: PrismaService) {}

  /**
   * The PMS key never leaves the server.
   *
   * It used to: `GET /tenant` returned the whole row and the Settings screen
   * pre-filled its input from it, so the key sat in a browser's memory, in its
   * network log, and in any HAR file anyone attached to a bug report. A key
   * that has to be readable by the sync does not have to be readable by the UI.
   */
  private present(tenant: Tenant): TenantView {
    const { pmsApiKey, ...rest } = tenant;

    let hint: string | null = null;
    if (pmsApiKey) {
      // A key that will not decrypt still exists — say so, and let the hint go
      // rather than failing a page that is the only place to fix it.
      try {
        hint = maskSecret(decryptSecret(pmsApiKey));
      } catch {
        hint = null;
      }
    }

    return {
      ...rest,
      pmsApiKeySet: Boolean(pmsApiKey),
      pmsApiKeyHint: hint,
      pmsApiKeyEncrypted: Boolean(pmsApiKey) && isEncrypted(pmsApiKey!),
    };
  }

  async findById(tenantId: string): Promise<TenantView> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return this.present(tenant);
  }

  async updateSettings(tenantId: string, settings: any): Promise<TenantView> {
    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { settings },
    });
    return this.present(tenant);
  }

  async updatePmsConfig(
    tenantId: string,
    data: {
      pmsProvider?: string;
      pmsApiBaseUrl?: string;
      pmsApiKey?: string;
      pmsSyncEnabled?: boolean;
      /** Google Sheets id for the Datasets module. Read-only source. */
      datasetsSheetId?: string | null;
    },
    actorId?: string,
  ): Promise<TenantView> {
    // Accept a pasted spreadsheet URL as well as a bare id. Nobody has the id
    // to hand; everybody has the address bar.
    const patch = { ...data };
    if (typeof patch.datasetsSheetId === 'string') {
      const match = patch.datasetsSheetId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      const value = (match ? match[1] : patch.datasetsSheetId).trim();
      patch.datasetsSheetId = value === '' ? null : value;
    }

    /**
     * An absent or blank key means "leave the key alone", not "clear it".
     *
     * This is the half of the change that the screen depends on. The Settings
     * form no longer receives the key, so it can no longer send it back, and
     * every save of an unrelated field — the sync toggle, the sheet id — would
     * otherwise wipe the credential and stop the sync silently.
     *
     * Clearing a key deliberately is a different action, and does not exist yet.
     */
    const newKey = typeof patch.pmsApiKey === 'string' ? patch.pmsApiKey.trim() : '';
    const rotating = newKey.length > 0;

    if (rotating) {
      patch.pmsApiKey = encryptSecret(newKey);
    } else {
      delete patch.pmsApiKey;
    }

    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: patch,
    });

    if (rotating) {
      // Who changed the PMS credential and when. Never the value, and never
      // enough of it to be worth stealing from the audit log.
      const actor = actorId
        ? await this.prisma.user.findUnique({
            where: { id: actorId },
            select: { email: true },
          })
        : null;

      await this.prisma.auditEvent.create({
        data: {
          tenantId,
          category: 'SYSTEM',
          action: 'tenant.pms_credentials.rotated',
          actorId: actorId ?? null,
          actorEmail: actor?.email ?? null,
          targetType: 'tenant',
          targetId: tenantId,
          metadata: {
            provider: patch.pmsProvider ?? tenant.pmsProvider ?? null,
            apiBaseUrl: tenant.pmsApiBaseUrl,
            keyHint: maskSecret(newKey),
          },
        },
      });
    }

    return this.present(tenant);
  }
}
