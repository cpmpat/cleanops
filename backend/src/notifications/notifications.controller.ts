import { Controller, Get, Patch, Param, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '../common/guards/auth.guard';
import { TenantRequest } from '../common/middleware/tenant.middleware';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private service: NotificationsService) {}

  @Get()
  getAll(@Req() req: TenantRequest, @Query('limit') limit?: number, @Query('offset') offset?: number) {
    return this.service.getAll(req.userId!, limit, offset);
  }

  @Get('turnover-updates')
  getTurnoverUpdates(@Req() req: TenantRequest, @Query('limit') limit?: number) {
    return this.service.getTurnoverUpdates(req.userId!, limit ? Number(limit) : undefined);
  }

  @Get('turnover-updates/count')
  getTurnoverUpdatesCount(@Req() req: TenantRequest) {
    return this.service.getTurnoverUpdatesCount(req.userId!);
  }

  @Get('unread')
  getUnread(@Req() req: TenantRequest) {
    return this.service.getUnread(req.userId!);
  }

  @Get('unread/count')
  getUnreadCount(@Req() req: TenantRequest) {
    return this.service.getUnreadCount(req.userId!);
  }

  @Patch(':id/read')
  markRead(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.service.markRead(req.userId!, id);
  }

  @Patch('read-all')
  markAllRead(@Req() req: TenantRequest) {
    return this.service.markAllRead(req.userId!);
  }
}
