import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard, RolesGuard, Roles } from '../common/guards/auth.guard';
import { TenantRequest } from '../common/middleware/tenant.middleware';
import { NOTIFY_ROLES } from '../common/roles';
import { DataNotificationsService } from './data-notifications.service';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller('notifications/data')
export class DataNotificationsController {
  constructor(private readonly notifications: DataNotificationsService) {}

  @Get('meta')
  @Roles(...NOTIFY_ROLES)
  @ApiOperation({ summary: 'Lists and fields this role is shown changes of (for the filters)' })
  meta(@Req() req: TenantRequest) {
    return this.notifications.meta(req.tenantId!, req.userRole as any);
  }

  @Get()
  @Roles(...NOTIFY_ROLES)
  @ApiOperation({
    summary: 'Changes to the CDM lists, newest first',
    description:
      'Only fields the notify matrix AND the access matrix grant this role. ' +
      'Filters: dataset, field, actor (email contains), source app|import, ' +
      'from / to (YYYY-MM-DD), cursor (id of the last item), limit (≤ 500).',
  })
  feed(
    @Req() req: TenantRequest,
    @Query('dataset') dataset?: string,
    @Query('field') field?: string,
    @Query('actor') actor?: string,
    @Query('source') source?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.notifications.feed(req.tenantId!, req.userRole as any, {
      dataset, field, actor, from, to, cursor,
      source: source === 'app' || source === 'import' ? source : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
