import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  UseGuards, Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard, RolesGuard, Roles } from '../common/guards/auth.guard';
import { TenantRequest } from '../common/middleware/tenant.middleware';
import { TurnoversService } from './turnovers.service';
import { IncidentPriority } from '@prisma/client';
import { todayInAppZone } from '../common/time';

@ApiTags('Turnovers')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('turnovers')
export class TurnoversController {
  constructor(private service: TurnoversService) {}

  // ─── Queries ──────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'Get turnovers for a date (or date range)' })
  findByDate(
    @Req() req: TenantRequest,
    @Query('date') date: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (from && to) {
      return this.service.findByDateRange(req.tenantId!, from, to);
    }
    const userId = req.userRole === 'CLEANER' ? req.userId : undefined;
    return this.service.findByDate(
      req.tenantId!,
      date || todayInAppZone(),
      userId,
    );
  }

  @Get('pool')
  @ApiOperation({ summary: 'Get turnovers available to claim (pool)' })
  getPool(@Req() req: TenantRequest) {
    const userId = req.userRole === 'CLEANER' ? req.userId : undefined;
    return this.service.getPool(req.tenantId!, userId);
  }

  @Get('mine')
  @ApiOperation({ summary: 'Get turnovers assigned to the current user' })
  getMine(
    @Req() req: TenantRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('propertyIds') propertyIds?: string,
  ) {
    const ids = propertyIds
      ? propertyIds.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;
    return this.service.getMine(req.tenantId!, req.userId!, { from, to, propertyIds: ids });
  }

  @Get('me/stats')
  @ApiOperation({ summary: 'Personal cleaning stats for the current user' })
  getMyStats(@Req() req: TenantRequest) {
    return this.service.getMyStats(req.tenantId!, req.userId!);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get turnover by ID' })
  findById(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.service.findById(req.tenantId!, id);
  }

  // ─── Manager mutations ────────────────────────────────

  @Patch(':id')
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Update turnover (manager only)' })
  update(@Req() req: TenantRequest, @Param('id') id: string, @Body() dto: any) {
    return this.service.update(req.tenantId!, id, dto);
  }

  @Delete(':id')
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Cancel turnover (manager only)' })
  cancel(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.service.cancel(req.tenantId!, id);
  }

  @Post(':id/release-to-pool')
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Return an assigned turnover to the pool (manager only)' })
  releaseToPool(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.service.releaseToPool(req.tenantId!, req.userId!, id);
  }

  // ─── Cleaner mutations ────────────────────────────────

  // ─── Manager assignment ───────────────────────────────

  @Post(':id/assign')
  @UseGuards(RolesGuard)
  @Roles('MANAGER')
  @ApiOperation({
    summary: 'Assign a cleaner to a turnover (manager)',
    description:
      'Body: { userId: string, isPrimary?: boolean }. Fails if the turnover is ' +
      'already at maxCleaners, is completed, or that cleaner is already on it. ' +
      'Notifies the cleaner and writes an audit event.',
  })
  assign(
    @Req() req: TenantRequest,
    @Param('id') id: string,
    @Body() body: { userId: string; isPrimary?: boolean },
  ) {
    return this.service.assign(
      req.tenantId!, req.userId!, id, body.userId, body.isPrimary,
    );
  }

  @Post(':id/unassign')
  @UseGuards(RolesGuard)
  @Roles('MANAGER')
  @ApiOperation({
    summary: 'Remove a cleaner from a turnover (manager)',
    description:
      'Body: { userId: string }. The assignment is marked REASSIGNED, not ' +
      'deleted. If nobody is left the turnover returns to the pool.',
  })
  unassign(
    @Req() req: TenantRequest,
    @Param('id') id: string,
    @Body() body: { userId: string },
  ) {
    return this.service.unassign(req.tenantId!, req.userId!, id, body.userId);
  }

  @Post(':id/claim')
  @Roles('CLEANER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Claim a turnover from the pool' })
  claim(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.service.claim(req.tenantId!, req.userId!, id);
  }

  @Post(':id/drop')
  @Roles('CLEANER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Drop a previously claimed turnover' })
  drop(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.service.drop(req.tenantId!, req.userId!, id);
  }

  @Post(':id/start')
  @Roles('CLEANER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Start a claimed turnover (logs startedAt)' })
  start(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.service.start(req.tenantId!, req.userId!, id);
  }

  @Patch(':id/done')
  @Roles('CLEANER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Mark a claimed turnover as done' })
  markDone(
    @Req() req: TenantRequest,
    @Param('id') id: string,
    @Body() dto: {
      allGood: boolean;
      note?: string;
      photoUrls?: string[];
      priority?: IncidentPriority;
    },
  ) {
    return this.service.markDone(req.tenantId!, req.userId!, id, dto);
  }
}