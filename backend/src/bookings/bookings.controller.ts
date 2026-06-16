import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AuthGuard, RolesGuard, Roles } from '../common/guards/auth.guard';
import { TenantRequest } from '../common/middleware/tenant.middleware';
import { BookingsService } from './bookings.service';

@ApiTags('Bookings')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('bookings')
export class BookingsController {
  constructor(private service: BookingsService) {}

  // ─── List (manager) ────────────────────────────────────────

  @Get()
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'List bookings (manager only)' })
  @ApiQuery({ name: 'arrivalFrom', required: false })
  @ApiQuery({ name: 'arrivalTo', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'propertyId', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  list(@Req() req: TenantRequest, @Query() query: any) {
    return this.service.list(req.tenantId!, query);
  }

  // ─── Cleaner calendar (scoped to her saved property filter) ───

  @Get('calendar')
  @Roles('CLEANER')
  @UseGuards(RolesGuard)
  @ApiOperation({
    summary: "Bookings overlapping [from, to) for the cleaner's saved property filter",
  })
  @ApiQuery({ name: 'from', required: true, description: 'ISO datetime, start of window' })
  @ApiQuery({ name: 'to', required: true, description: 'ISO datetime, end of window (exclusive)' })
  calendar(
    @Req() req: TenantRequest,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.service.getCalendarForUser(req.tenantId!, req.userId!, from, to);
  }

  // ─── Detail (any role, used by incident detail pages) ──────

  @Get(':id')
  @ApiOperation({ summary: 'Get a single booking with its cleaning' })
  getById(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.service.getById(req.tenantId!, id);
  }

  // ─── Update (manager) ──────────────────────────────────────

  @Patch(':id')
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Update booking (manager only) \u2014 propagates to linked cleaning' })
  update(
    @Req() req: TenantRequest,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    return this.service.update(req.tenantId!, id, dto);
  }

  @Post(':id/cancel')
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Cancel booking (manager only) \u2014 cleaning is not auto-cancelled' })
  cancel(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.service.cancel(req.tenantId!, id);
  }
}
