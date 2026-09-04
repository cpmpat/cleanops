import {
  Controller, Post, Get, Patch, Body, Param, Query,
  UseGuards, Req, BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AuthGuard, RolesGuard, Roles } from '../common/guards/auth.guard';
import { TenantRequest } from '../common/middleware/tenant.middleware';
import { BookingSyncService } from './booking-sync.service';
import { AvantioAdapter } from './avantio/avantio.adapter';
import { PmsTenantConfig } from '../common/interfaces/pms-adapter.interface';
import { PrismaService } from '../common/prisma.service';
import { pmsConfigFor } from '../common/pms-config';

@ApiTags('Integrations')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Roles('MANAGER')
@Controller('integrations')
export class IntegrationsController {
  constructor(
    private syncService: BookingSyncService,
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
  @ApiOperation({
    summary: 'List bookings for the Check-in Planning view',
    description: 'Returns cleaning events with assignment info, filterable by arrival date range, ' +
      'creation date range, and status. Backed by local DB — instant response.',
  })
  @ApiQuery({ name: 'arrivalFrom', required: false, description: 'Filter by check-in >= (ISO date, e.g. 2026-04-01)' })
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
  ) {
    return this.syncService.getBookingsForPlanning(req.tenantId!, {
      arrivalFrom,
      arrivalTo,
      creationDateFrom,
      creationDateTo,
      status,
    });
  }

  @Get('planning/bookings/:pmsBookingId')
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
  @ApiOperation({
    summary: 'Update check-in / check-out time in Avantio',
    description:
      'Pushes the updated times to Avantio via PUT /bookings/{id}, then ' +
      'updates the local cleaning event and notifies any assigned cleaners. ' +
      'Body: { checkInTime?: string (ISO), checkOutTime?: string (ISO) }',
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
}