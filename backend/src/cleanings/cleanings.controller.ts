import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  UseGuards, Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard, RolesGuard, Roles } from '../common/guards/auth.guard';
import { TenantRequest } from '../common/middleware/tenant.middleware';
import { CleaningsService } from './cleanings.service';
import { IncidentPriority } from '@prisma/client';

@ApiTags('Cleanings')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('cleanings')
export class CleaningsController {
  constructor(private service: CleaningsService) {}

  // ─── Queries ──────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'Get cleanings for a date (or date range)' })
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
      date || new Date().toISOString().split('T')[0],
      userId,
    );
  }

  @Get('pool')
  @ApiOperation({ summary: 'Get cleanings available to claim (pool)' })
  getPool(@Req() req: TenantRequest) {
    const userId = req.userRole === 'CLEANER' ? req.userId : undefined;
    return this.service.getPool(req.tenantId!, userId);
  }

  @Get('mine')
  @ApiOperation({ summary: 'Get cleanings assigned to the current user' })
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

  @Get('stats')
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Get stats for a date (manager only)' })
  getStats(@Req() req: TenantRequest, @Query('date') date: string) {
    return this.service.getStats(
      req.tenantId!,
      date || new Date().toISOString().split('T')[0],
    );
  }

  @Get('overdue')
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Get overdue cleanings (manager only)' })
  getOverdue(@Req() req: TenantRequest, @Query('threshold') threshold?: number) {
    return this.service.getOverdueCleanings(req.tenantId!, threshold);
  }

  @Get('calendar/:year/:month')
  @ApiOperation({ summary: 'Get month summary for calendar view' })
  getMonthSummary(
    @Req() req: TenantRequest,
    @Param('year') year: number,
    @Param('month') month: number,
  ) {
    return this.service.getMonthSummary(req.tenantId!, year, month);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get cleaning by ID' })
  findById(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.service.findById(req.tenantId!, id);
  }

  // ─── Manager mutations ────────────────────────────────

  @Patch(':id')
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Update cleaning (manager only)' })
  update(@Req() req: TenantRequest, @Param('id') id: string, @Body() dto: any) {
    return this.service.update(req.tenantId!, id, dto);
  }

  @Delete(':id')
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Cancel cleaning (manager only)' })
  cancel(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.service.cancel(req.tenantId!, id);
  }

  @Post(':id/release-to-pool')
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Return an assigned cleaning to the pool (manager only)' })
  releaseToPool(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.service.releaseToPool(req.tenantId!, req.userId!, id);
  }

  // ─── Cleaner mutations ────────────────────────────────

  @Post(':id/claim')
  @Roles('CLEANER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Claim a cleaning from the pool' })
  claim(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.service.claim(req.tenantId!, req.userId!, id);
  }

  @Post(':id/drop')
  @Roles('CLEANER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Drop a previously claimed cleaning' })
  drop(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.service.drop(req.tenantId!, req.userId!, id);
  }

  @Patch(':id/done')
  @Roles('CLEANER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Mark a claimed cleaning as done' })
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
