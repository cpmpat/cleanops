import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  UseGuards, Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard, RolesGuard, Roles } from '../common/guards/auth.guard';
import { TenantRequest } from '../common/middleware/tenant.middleware';
import { UsersService } from './users.service';
import { UserRole } from '@prisma/client';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Post()
  @Roles('MANAGER')
  @ApiOperation({ summary: 'Create a new user (manager only)' })
  create(@Req() req: TenantRequest, @Body() dto: any) {
    return this.usersService.create(req.tenantId!, dto);
  }

  @Get()
  @Roles('MANAGER')
  @ApiOperation({ summary: 'List all users for this tenant' })
  findAll(@Req() req: TenantRequest, @Query('role') role?: UserRole) {
    return this.usersService.findAll(req.tenantId!, role);
  }

  @Get('cleaners/workload')
  @Roles('MANAGER')
  @ApiOperation({ summary: 'Get cleaners with workload for a date' })
  getWorkload(@Req() req: TenantRequest, @Query('date') date: string) {
    return this.usersService.getCleanersWithWorkload(
      req.tenantId!,
      date ? new Date(date) : new Date(),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user by ID' })
  findOne(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.usersService.findById(req.tenantId!, id);
  }

  @Patch(':id')
  @Roles('MANAGER')
  @ApiOperation({ summary: 'Update user (manager only)' })
  update(@Req() req: TenantRequest, @Param('id') id: string, @Body() dto: any) {
    return this.usersService.update(req.tenantId!, id, dto);
  }

  @Delete(':id')
  @Roles('MANAGER')
  @ApiOperation({ summary: 'Deactivate user (manager only)' })
  deactivate(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.usersService.deactivate(req.tenantId!, id);
  }
}
