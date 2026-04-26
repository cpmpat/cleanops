import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { UserRole, Language } from '@prisma/client';

interface CreateUserDto {
  email: string;
  name: string;
  role: UserRole;
  language?: Language;
}

interface UpdateUserDto {
  name?: string;
  role?: UserRole;
  language?: Language;
  isActive?: boolean;
}

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateUserDto) {
    const existing = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email: dto.email.toLowerCase() } },
    });
    if (existing) throw new ConflictException('User with this email already exists');

    return this.prisma.user.create({
      data: {
        tenantId,
        email: dto.email.toLowerCase(),
        name: dto.name,
        role: dto.role,
        language: dto.language || Language.en,
      },
    });
  }

  async findAll(tenantId: string, role?: UserRole) {
    return this.prisma.user.findMany({
      where: { tenantId, ...(role && { role }), isActive: true },
      select: {
        id: true, email: true, name: true, role: true,
        language: true, isActive: true, lastLoginAt: true, createdAt: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  async findById(tenantId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      include: {
        assignedCleanings: {
          where: { status: { in: ['ASSIGNED', 'STARTED'] } },
          include: { cleaningEvent: true },
          orderBy: { cleaningEvent: { timeSlot: 'asc' } },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async update(tenantId: string, userId: string, dto: UpdateUserDto) {
    await this.findById(tenantId, userId);
    return this.prisma.user.update({
      where: { id: userId },
      data: dto,
    });
  }

  async deactivate(tenantId: string, userId: string) {
    return this.update(tenantId, userId, { isActive: false });
  }

  async getCleanersWithWorkload(tenantId: string, date: Date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const cleaners = await this.prisma.user.findMany({
      where: { tenantId, role: 'CLEANER', isActive: true },
      include: {
        assignedCleanings: {
          where: {
            cleaningEvent: {
              timeSlot: { gte: startOfDay, lte: endOfDay },
              status: { not: 'CANCELLED' },
            },
          },
          include: {
            cleaningEvent: {
              select: { id: true, status: true, property: true, timeSlot: true, accommodationName: true },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return cleaners.map(c => ({
      id: c.id,
      name: c.name,
      email: c.email,
      language: c.language,
      assignmentsToday: c.assignedCleanings.length,
      completedToday: c.assignedCleanings.filter(a => a.status === 'COMPLETED').length,
      assignments: c.assignedCleanings,
    }));
  }
}
