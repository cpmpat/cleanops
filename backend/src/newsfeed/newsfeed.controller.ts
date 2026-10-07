import { Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard, RolesGuard, Roles } from '../common/guards/auth.guard';
import { TenantRequest } from '../common/middleware/tenant.middleware';
import { NEWSFEED_ROLES } from '../common/roles';
import { NewsfeedService } from './newsfeed.service';

@ApiTags('Newsfeed')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller('newsfeed')
export class NewsfeedController {
  constructor(private readonly newsfeed: NewsfeedService) {}

  @Get()
  @Roles(...NEWSFEED_ROLES)
  @ApiOperation({ summary: 'News for the caller, newest first; ?all=1 includes closed items' })
  feed(@Req() req: TenantRequest, @Query('all') all?: string) {
    return this.newsfeed.feed(req.tenantId!, req.userId!, req.userRole as any, all === '1' || all === 'true');
  }

  @Get('unread')
  @Roles(...NEWSFEED_ROLES)
  @ApiOperation({ summary: 'How many news items the caller has not closed' })
  unread(@Req() req: TenantRequest) {
    return this.newsfeed.unread(req.tenantId!, req.userId!, req.userRole as any);
  }

  @Post('dismiss-all')
  @Roles(...NEWSFEED_ROLES)
  @ApiOperation({ summary: 'Close every open news item for the caller' })
  dismissAll(@Req() req: TenantRequest) {
    return this.newsfeed.dismissAll(req.tenantId!, req.userId!, req.userRole as any);
  }

  @Post(':id/dismiss')
  @Roles(...NEWSFEED_ROLES)
  @ApiOperation({ summary: 'Close one news item for the caller' })
  dismiss(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.newsfeed.dismiss(req.tenantId!, req.userId!, id);
  }
}
