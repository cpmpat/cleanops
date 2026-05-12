import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { Controller, Get, Post, Delete, Body, Param, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard, RolesGuard, Roles } from '../common/guards/auth.guard';
import { TenantRequest } from '../common/middleware/tenant.middleware';

// ─── Service ───
@Injectable()
export class TagsService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string) {
    return this.prisma.managerTag.findMany({ where: { tenantId }, orderBy: { label: 'asc' } });
  }

  async create(tenantId: string, data: { label: string; color?: string }) {
    return this.prisma.managerTag.create({ data: { tenantId, ...data } });
  }

  async delete(tenantId: string, id: string) {
    const tag = await this.prisma.managerTag.findFirst({ where: { id, tenantId } });
    if (!tag) throw new NotFoundException('Tag not found');
    await this.prisma.cleaningTag.deleteMany({ where: { tagId: id } });
    return this.prisma.managerTag.delete({ where: { id } });
  }

  async addTagToEvent(tenantId: string, eventId: string, tagId: string) {
    return this.prisma.cleaningTag.create({
      data: { cleaningId: eventId, tagId },
    });
  }

  async removeTagFromEvent(eventId: string, tagId: string) {
    return this.prisma.cleaningTag.deleteMany({
      where: { cleaningId: eventId, tagId },
    });
  }
}

// ─── Controller ───
@ApiTags('Tags')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Roles('MANAGER')
@Controller('tags')
export class TagsController {
  constructor(private service: TagsService) {}

  @Get()
  findAll(@Req() req: TenantRequest) { return this.service.findAll(req.tenantId!); }

  @Post()
  create(@Req() req: TenantRequest, @Body() dto: { label: string; color?: string }) {
    return this.service.create(req.tenantId!, dto);
  }

  @Delete(':id')
  delete(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.service.delete(req.tenantId!, id);
  }

  @Post('event/:eventId/tag/:tagId')
  addToEvent(@Req() req: TenantRequest, @Param('eventId') eventId: string, @Param('tagId') tagId: string) {
    return this.service.addTagToEvent(req.tenantId!, eventId, tagId);
  }

  @Delete('event/:eventId/tag/:tagId')
  removeFromEvent(@Param('eventId') eventId: string, @Param('tagId') tagId: string) {
    return this.service.removeTagFromEvent(eventId, tagId);
  }
}

// ─── Module ───
@Module({
  imports: [AuthModule],
  controllers: [TagsController],
  providers: [TagsService],
  exports: [TagsService],
})
export class TagsModule {}
