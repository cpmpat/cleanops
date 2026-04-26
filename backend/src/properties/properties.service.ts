import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class PropertiesService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string) {
    return this.prisma.property.findMany({
      where: { tenantId, isActive: true },
      include: {
        defaultCleaner: { select: { id: true, name: true, email: true } },
        _count: { select: { cleaningEvents: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findById(tenantId: string, id: string) {
    const prop = await this.prisma.property.findFirst({
      where: { id, tenantId },
      include: { defaultCleaner: { select: { id: true, name: true, email: true } } },
    });
    if (!prop) throw new NotFoundException('Property not found');
    return prop;
  }

  async create(tenantId: string, data: {
    name: string; address?: string; locationLat?: number;
    locationLng?: number; defaultCleanerId?: string; pmsPropertyId?: string;
    accommodationType?: string; notes?: string;
  }) {
    return this.prisma.property.create({
      data: { tenantId, ...data },
      include: { defaultCleaner: { select: { id: true, name: true, email: true } } },
    });
  }

  async update(tenantId: string, id: string, data: any) {
    await this.findById(tenantId, id);
    return this.prisma.property.update({ where: { id }, data });
  }

  async delete(tenantId: string, id: string) {
    return this.update(tenantId, id, { isActive: false });
  }
}
