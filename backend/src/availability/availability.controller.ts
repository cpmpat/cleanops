import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard, Roles, RolesGuard } from '../common/guards/auth.guard';
import { TenantRequest } from '../common/middleware/tenant.middleware';
import { OFFICE_ROLES } from '../common/roles';
import {
  AvailabilityService,
  CreateAvailabilityDto,
  UpdateAvailabilityDto,
} from './availability.service';

/**
 * Agent availability. Agents declare their own hours; the desk reads them.
 * Times cross the API as "HH:mm" in Europe/Prague and days as YYYY-MM-DD —
 * the browser never builds an instant (docs/DECISIONS.md).
 */
@ApiTags('Availability')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller('availability')
export class AvailabilityController {
  constructor(private service: AvailabilityService) {}

  // ─── Agent ─────────────────────────────────────────────────────────────────

  @Get('mine')
  @Roles('AGENT')
  @ApiOperation({ summary: 'My availability blocks, today onwards (or ?from=&to=, YYYY-MM-DD)' })
  mine(@Req() req: TenantRequest, @Query('from') from?: string, @Query('to') to?: string) {
    return this.service.listMine(req.tenantId!, req.userId!, from, to);
  }

  @Post('mine')
  @Roles('AGENT')
  @ApiOperation({
    summary: 'Add the same hours on one or more days',
    description: 'Body: { days: ["2026-09-27", …], start: "18:00", end: "23:00" }. End ≤ start means past midnight. ' +
      'Touching or overlapping blocks on the same day are merged.',
  })
  create(@Req() req: TenantRequest, @Body() dto: CreateAvailabilityDto) {
    return this.service.createMine(req.tenantId!, req.userId!, dto);
  }

  @Post('mine/copy-week')
  @Roles('AGENT')
  @ApiOperation({ summary: 'Copy the week starting weekStart (a Monday) onto the next week' })
  copyWeek(@Req() req: TenantRequest, @Body() body: { weekStart: string }) {
    return this.service.copyWeek(req.tenantId!, req.userId!, body?.weekStart);
  }

  @Patch('mine/:id')
  @Roles('AGENT')
  @ApiOperation({ summary: 'Change one block (tomorrow onwards; today is fixed)' })
  update(@Req() req: TenantRequest, @Param('id') id: string, @Body() dto: UpdateAvailabilityDto) {
    return this.service.updateMine(req.tenantId!, req.userId!, id, dto);
  }

  @Delete('mine/:id')
  @Roles('AGENT')
  @ApiOperation({ summary: 'Remove one block (tomorrow onwards; today is fixed)' })
  remove(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.service.deleteMine(req.tenantId!, req.userId!, id);
  }

  // ─── Desk ──────────────────────────────────────────────────────────────────

  @Get('board')
  @Roles(...OFFICE_ROLES)
  @ApiOperation({
    summary: 'Planning → Agents: agents, their blocks and the arrivals for from..to (inclusive, ≤ 14 days)',
  })
  board(@Req() req: TenantRequest, @Query('from') from: string, @Query('to') to: string) {
    return this.service.board(req.tenantId!, from, to ?? from);
  }
}
