import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class TenantsService {
  constructor(private prisma: PrismaService) {}

  async findById(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async updateSettings(tenantId: string, settings: any) {
    return this.prisma.tenant.update({
      where: { id: tenantId },
      data: { settings },
    });
  }

  async updatePmsConfig(tenantId: string, data: {
    pmsProvider?: string;
    pmsApiBaseUrl?: string;
    pmsApiKey?: string;
    pmsSyncEnabled?: boolean;
    /** Google Sheets id for the Datasets module. Read-only source. */
    datasetsSheetId?: string | null;
  }) {
    // Accept a pasted spreadsheet URL as well as a bare id. Nobody has the id
    // to hand; everybody has the address bar.
    const patch = { ...data };
    if (typeof patch.datasetsSheetId === 'string') {
      const match = patch.datasetsSheetId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      const value = (match ? match[1] : patch.datasetsSheetId).trim();
      patch.datasetsSheetId = value === '' ? null : value;
    }

    return this.prisma.tenant.update({
      where: { id: tenantId },
      data: patch,
    });
  }
}
