import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard, Roles, RolesGuard } from '../common/guards/auth.guard';
import { TenantRequest } from '../common/middleware/tenant.middleware';
import { DESK_READ_ROLES, PLANNING_ROLES } from '../common/roles';
import {
  AvailabilityService,
  CreateAvailabilityDto,
  TimeOffDto,
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

  @Post('mine/time-off')
  @Roles('AGENT')
  @ApiOperation({
    summary: 'Mark days as time off',
    description: 'Body: { from: "YYYY-MM-DD", to: "YYYY-MM-DD", reason: "VACATION" | "SICK" | "OTHER", note? }. ' +
      'Removes hours declared on those days. Refused (409 HOLDS_CHECKINS) while you hold check-ins on them.',
  })
  setMyTimeOff(@Req() req: TenantRequest, @Body() dto: TimeOffDto) {
    return this.service
      .setTimeOff(req.tenantId!, req.userId!, { id: req.userId!, via: 'APP' }, dto)
      .then(() => this.service.listMine(req.tenantId!, req.userId!));
  }

  @Delete('mine/time-off')
  @Roles('AGENT')
  @ApiOperation({ summary: 'Remove time off (?from=YYYY-MM-DD&to=YYYY-MM-DD, today onwards)' })
  removeMyTimeOff(@Req() req: TenantRequest, @Query('from') from: string, @Query('to') to?: string) {
    return this.service
      .removeTimeOff(req.tenantId!, req.userId!, { id: req.userId!, via: 'APP' }, { from, to })
      .then(() => this.service.listMine(req.tenantId!, req.userId!));
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

  @Post('agents/:userId/time-off')
  @Roles(...PLANNING_ROLES)
  @ApiOperation({
    summary: 'Record time off for an agent (after a phone call)',
    description: 'Same body and rules as the agent\'s own; logged as the desk user\'s act.',
  })
  setAgentTimeOff(@Req() req: TenantRequest, @Param('userId') userId: string, @Body() dto: TimeOffDto) {
    return this.service.setTimeOff(req.tenantId!, userId, { id: req.userId!, via: 'DESK' }, dto);
  }

  @Delete('agents/:userId/time-off')
  @Roles(...PLANNING_ROLES)
  @ApiOperation({ summary: 'Remove an agent\'s time off (?from=&to=)' })
  removeAgentTimeOff(
    @Req() req: TenantRequest,
    @Param('userId') userId: string,
    @Query('from') from: string,
    @Query('to') to?: string,
  ) {
    return this.service.removeTimeOff(req.tenantId!, userId, { id: req.userId!, via: 'DESK' }, { from, to });
  }

  @Get('board')
  @Roles(...DESK_READ_ROLES)
  @ApiOperation({
    summary: 'Planning → Agents: agents, their blocks and the arrivals for from..to (inclusive, ≤ 14 days)',
  })
  board(@Req() req: TenantRequest, @Query('from') from: string, @Query('to') to: string) {
    return this.service.board(req.tenantId!, from, to ?? from, req.userId);
  }
}
