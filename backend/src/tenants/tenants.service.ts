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
  }) {
    return this.prisma.tenant.update({
      where: { id: tenantId },
      data,
    });
  }
}
