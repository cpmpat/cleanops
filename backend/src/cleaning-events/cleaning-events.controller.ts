import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  UseGuards, Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard, RolesGuard, Roles } from '../common/guards/auth.guard';
import { TenantRequest } from '../common/middleware/tenant.middleware';
import { CleaningEventsService } from './cleaning-events.service';

@ApiTags('Cleaning Events')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('cleaning-events')
export class CleaningEventsController {
  constructor(private service: CleaningEventsService) {}

  // ─── Queries ──────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'Get events for a date (or date range)' })
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
    return this.service.getPool(req.tenantId!);
  }

  @Get('mine')
  @ApiOperation({
    summary: 'Get cleanings assigned to the current user (date-range filterable)',
  })
  getMine(
    @Req() req: TenantRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.getMine(req.tenantId!, req.userId!, { from, to });
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
  @ApiOperation({ summary: 'Get overdue events (manager only)' })
  getOverdue(
    @Req() req: TenantRequest,
    @Query('threshold') threshold?: number,
  ) {
    return this.service.getOverdueEvents(req.tenantId!, threshold);
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
  @ApiOperation({ summary: 'Get event by ID' })
  findById(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.service.findById(req.tenantId!, id);
  }

  // ─── Manager mutations ────────────────────────────────

  @Post()
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Create a cleaning event (manager only)' })
  create(@Req() req: TenantRequest, @Body() dto: any) {
    return this.service.create(req.tenantId!, dto);
  }

  @Patch(':id')
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Update event (manager only)' })
  update(
    @Req() req: TenantRequest,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    return this.service.update(req.tenantId!, id, dto);
  }

  @Delete(':id')
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Cancel event (manager only)' })
  cancel(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.service.cancel(req.tenantId!, id);
  }

  @Post(':id/release-to-pool')
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({
    summary: 'Return an assigned event to the pool (manager only)',
  })
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
  @ApiOperation({
    summary: 'Mark a claimed cleaning as done (with optional issue report)',
  })
  markDone(
    @Req() req: TenantRequest,
    @Param('id') id: string,
    @Body() dto: { allGood: boolean; note?: string; photoUrls?: string[] },
  ) {
    return this.service.markDone(req.tenantId!, req.userId!, id, dto);
  }
}
