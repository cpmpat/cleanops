import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard, RolesGuard, Roles } from '../common/guards/auth.guard';
import { TenantRequest } from '../common/middleware/tenant.middleware';
import { PropertiesService } from './properties.service';

@ApiTags('Properties')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller('properties')
export class PropertiesController {
  constructor(private service: PropertiesService) {}

  // Reads — available to any authenticated user (managers and cleaners).
  // Cleaners need this to populate the property filter on the pool page.

  @Get()
  findAll(@Req() req: TenantRequest) { return this.service.findAll(req.tenantId!); }

  @Get(':id')
  findById(@Req() req: TenantRequest, @Param('id') id: string) { return this.service.findById(req.tenantId!, id); }

  // Writes — managers only.

  @Post()
  @Roles('MANAGER')
  create(@Req() req: TenantRequest, @Body() dto: any) { return this.service.create(req.tenantId!, dto); }

  @Patch(':id')
  @Roles('MANAGER')
  update(@Req() req: TenantRequest, @Param('id') id: string, @Body() dto: any) { return this.service.update(req.tenantId!, id, dto); }

  @Delete(':id')
  @Roles('MANAGER')
  delete(@Req() req: TenantRequest, @Param('id') id: string) { return this.service.delete(req.tenantId!, id); }
}