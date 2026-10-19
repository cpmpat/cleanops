import {
  Controller, Post, Get, Patch, Body, Param, Query,
  UseGuards, Req, BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AuthGuard, RolesGuard, Roles } from '../common/guards/auth.guard';
import { TenantRequest } from '../common/middleware/tenant.middleware';
import { BookingSyncService } from './booking-sync.service';
import { CheckInAgentService } from './checkin-agent.service';
import { AvantioAdapter } from './avantio/avantio.adapter';
import { PmsTenantConfig } from '../common/interfaces/pms-adapter.interface';
import { PrismaService } from '../common/prisma.service';
import { pmsConfigFor } from '../common/pms-config';
import { PLANNING_ROLES } from '../common/roles';

@ApiTags('Integrations')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Roles('MANAGER')
@Controller('integrations')
export class IntegrationsController {
  constructor(
    private syncService: BookingSyncService,
    private checkInAgents: CheckInAgentService,
    private avantioAdapter: AvantioAdapter,
    private prisma: PrismaService,
  ) {}

  // ─── PMS Sync ───

  @Post('sync')
  @ApiOperation({ summary: 'Full sync: accommodations + bookings' })
  triggerSync(@Req() req: TenantRequest) {
    return this.syncService.syncTenant(req.tenantId!);
  }

  @Post('sync/accommodations')
  @ApiOperation({ summary: 'Sync only accommodations/properties from PMS' })
  syncAccommodations(@Req() req: TenantRequest) {
    return this.syncService.syncAccommodationsOnly(req.tenantId!);
  }

  @Post('test-connection')
  @ApiOperation({ summary: 'Test PMS API connection' })
  async testConnection(@Req() req: TenantRequest) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: req.tenantId } });
    if (!tenant?.pmsApiBaseUrl || !tenant?.pmsApiKey) {
      return { connected: false, error: 'PMS API not configured' };
    }
    const config = pmsConfigFor(tenant)!;
    const connected = await this.avantioAdapter.testConnection(config);
    return { connected };
  }

  // ─── Check-in Planning ───

  @Get('planning/bookings')
  @Roles(...PLANNING_ROLES)
  @ApiOperation({
    summary: 'List bookings for the Check-in Planning view',
    description: 'Returns cleaning events with assignment info, filterable by arrival date range, ' +
      'creation date range, and status. Backed by local DB — instant response.',
  })
  @ApiQuery({ name: 'by', required: false, description: "'checkIn' (default) or 'checkOut': which time the date range bounds, and which turnover (before arrival / after departure) the row reports" })
  @ApiQuery({ name: 'arrivalFrom', required: false, description: 'Filter by check-in >= (ISO date, e.g. 2026-04-01); by check-out when by=checkOut' })
  @ApiQuery({ name: 'arrivalTo', required: false, description: 'Filter by check-in <= (ISO date, e.g. 2026-04-30)' })
  @ApiQuery({ name: 'creationDateFrom', required: false, description: 'Filter by event created >= (ISO date)' })
  @ApiQuery({ name: 'creationDateTo', required: false, description: 'Filter by event created <= (ISO date)' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by cleaning event status (PENDING, ASSIGNED, etc.)' })
  getBookingsForPlanning(
    @Req() req: TenantRequest,
    @Query('arrivalFrom') arrivalFrom?: string,
    @Query('arrivalTo') arrivalTo?: string,
    @Query('creationDateFrom') creationDateFrom?: string,
    @Query('creationDateTo') creationDateTo?: string,
    @Query('status') status?: string,
    @Query('by') by?: string,
  ) {
    return this.syncService.getBookingsForPlanning(req.tenantId!, {
      by: by === 'checkOut' ? 'checkOut' : 'checkIn',
      arrivalFrom,
      arrivalTo,
      creationDateFrom,
      creationDateTo,
      status,
    });
  }

  @Get('planning/bookings/:pmsBookingId')
  @Roles(...PLANNING_ROLES)
  @ApiOperation({
    summary: 'Get full booking detail from Avantio',
    description: 'Fetches the complete booking object from the PMS. ' +
      'Used when the manager opens the edit modal to update check-in times.',
  })
  getBookingDetail(
    @Req() req: TenantRequest,
    @Param('pmsBookingId') pmsBookingId: string,
  ) {
    return this.syncService.getBookingDetail(req.tenantId!, pmsBookingId);
  }

  @Patch('planning/bookings/:pmsBookingId')
  @Roles(...PLANNING_ROLES)
  @ApiOperation({
    summary: 'Update check-in / check-out time in Avantio',
    description:
      'Pushes the updated times to Avantio via PUT /bookings/{id}, then ' +
      'updates the local cleaning event and notifies any assigned cleaners. ' +
      'Body: { checkInTime?: string, checkOutTime?: string } — each either "HH:mm" ' +
      '(wall-clock time in Europe/Prague on the booking\'s own day; preferred) or an ISO instant.',
  })
  async updateBookingTimes(
    @Req() req: TenantRequest,
    @Param('pmsBookingId') pmsBookingId: string,
    @Body() body: { checkInTime?: string; checkOutTime?: string },
  ) {
    if (!body.checkInTime && !body.checkOutTime) {
      throw new BadRequestException('At least one of checkInTime or checkOutTime must be provided');
    }
    return this.syncService.updateBookingTimesFromPlanning(
      req.tenantId!,
      pmsBookingId,
      body,
      req.userId,
    );
  }

  @Patch('planning/setup/:bookingId')
  @Roles(...PLANNING_ROLES)
  @ApiOperation({
    summary: 'Record setup requests (crib, separate beds) for a booking',
    description:
      'Local to CleanOps, never sent to the PMS. Body: { needsCrib?: boolean, separateBeds?: boolean }. ' +
      'Its own endpoint so the desk can set these without the manager-only booking edit.',
  })
  updateSetup(
    @Req() req: TenantRequest,
    @Param('bookingId') bookingId: string,
    @Body() body: { needsCrib?: boolean; separateBeds?: boolean },
  ) {
    return this.syncService.updateSetupRequests(req.tenantId!, bookingId, body ?? {});
  }

  @Get('planning/checkin-agent/route')
  @Roles(...PLANNING_ROLES)
  @ApiOperation({
    summary: 'Split "Assigned" view: agents\' check-ins in order, with the leg between each',
    description: 'Query: from, to (YYYY-MM-DD, ≤ 7 days), agentIds (comma-separated, optional).',
  })
  checkInRoute(
    @Req() req: TenantRequest,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('agentIds') agentIds?: string,
  ) {
    const ids = (agentIds ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    return this.checkInAgents.route(req.tenantId!, from, to ?? from, ids.length ? ids : undefined);
  }

  @Get('planning/checkin-agent/:bookingId/options')
  @Roles(...PLANNING_ROLES)
  @ApiOperation({
    summary: 'Check-in agents for one booking, available ones first',
    description:
      'Each active agent with how well their declared availability fits this arrival ' +
      '(AVAILABLE, TIME_UNCONFIRMED, OUTSIDE_HOURS, NOT_DECLARED). The unavailable ones ' +
      'are still returned so the desk can override.',
  })
  checkInAgentOptions(@Req() req: TenantRequest, @Param('bookingId') bookingId: string) {
    return this.checkInAgents.options(req.tenantId!, bookingId);
  }

  @Patch('planning/checkin-agent/:bookingId')
  @Roles(...PLANNING_ROLES)
  @ApiOperation({
    summary: 'Set or clear the check-in agent of a booking',
    description:
      'Body: { agentId: string | null, override?: boolean }. An agent who has not declared ' +
      'the arrival is refused (409 AGENT_NOT_AVAILABLE) unless override is true. Local to ' +
      'CleanOps, never sent to the PMS. The change and its audit row are one transaction.',
  })
  setCheckInAgent(
    @Req() req: TenantRequest,
    @Param('bookingId') bookingId: string,
    @Body() body: { agentId: string | null; override?: boolean },
  ) {
    if (body?.agentId !== null && typeof body?.agentId !== 'string') {
      throw new BadRequestException('agentId must be a user id or null');
    }
    return this.checkInAgents.setAgent(req.tenantId!, bookingId, req.userId!, {
      agentId: body.agentId,
      override: body.override === true,
    });
  }

  @Post('planning/checkin-agent/:bookingId/consent-by-phone')
  @Roles(...PLANNING_ROLES)
  @ApiOperation({
    summary: 'Record that the agent agreed to an override by phone',
    description: 'Only while the booking is waiting for the agent\'s answer. Logged as the desk user\'s act.',
  })
  agreeByPhone(@Req() req: TenantRequest, @Param('bookingId') bookingId: string) {
    return this.checkInAgents.agreeByPhone(req.tenantId!, bookingId, req.userId!);
  }

  @Get('planning/cleaners')
  @Roles(...PLANNING_ROLES)
  @ApiOperation({
    summary: 'Active cleaners, id and name only — the assign dropdown in Planning',
    description: 'Narrow on purpose: the desk may assign cleaners without reading the user list.',
  })
  planningCleaners(@Req() req: TenantRequest) {
    return this.prisma.user.findMany({
      where: { tenantId: req.tenantId!, role: 'CLEANER', isActive: true },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    });
  }
}
