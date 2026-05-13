import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

export interface CreateMaterialDto {
  name: string;
  unit?: string;
}

export interface UpdateMaterialDto {
  name?: string;
  unit?: string | null;
  isActive?: boolean;
}

@Injectable()
export class RepairMaterialsService {
  constructor(private prisma: PrismaService) {}

  async list(tenantId: string, includeInactive = false) {
    return this.prisma.repairMaterial.findMany({
      where: {
        tenantId,
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: { name: 'asc' },
    });
  }

  async create(tenantId: string, dto: CreateMaterialDto) {
    const name = dto.name?.trim();
    if (!name || name.length < 1 || name.length > 100) {
      throw new BadRequestException('Name must be 1-100 characters');
    }
    const unit = dto.unit?.trim() || null;
    if (unit && unit.length > 20) {
      throw new BadRequestException('Unit max 20 characters');
    }

    try {
      return await this.prisma.repairMaterial.create({
        data: { tenantId, name, unit },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new ConflictException(`Material "${name}" already exists`);
      }
      throw e;
    }
  }

  async update(tenantId: string, id: string, dto: UpdateMaterialDto) {
    const existing = await this.prisma.repairMaterial.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Material not found');

    const data: any = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name || name.length < 1 || name.length > 100) {
        throw new BadRequestException('Name must be 1-100 characters');
      }
      data.name = name;
    }
    if (dto.unit !== undefined) {
      data.unit = dto.unit?.trim() || null;
    }
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    try {
      return await this.prisma.repairMaterial.update({ where: { id }, data });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new ConflictException('Another material with this name already exists');
      }
      throw e;
    }
  }

  async deactivate(tenantId: string, id: string) {
    const existing = await this.prisma.repairMaterial.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Material not found');

    return this.prisma.repairMaterial.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
