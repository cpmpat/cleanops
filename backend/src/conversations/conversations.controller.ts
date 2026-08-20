import {
  Controller, Get, Post, Body, Param, UseGuards, Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '../common/guards/auth.guard';
import { TenantRequest } from '../common/middleware/tenant.middleware';
import { ConversationsService } from './conversations.service';

/**
 * Conversations attached to a turnover. Every role that can be a member can
 * use these; the service enforces who may open, read and invite.
 */
@ApiTags('Conversations')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(private service: ConversationsService) {}

  @Get()
  @ApiOperation({ summary: 'Conversations I am part of, newest first' })
  list(@Req() req: TenantRequest) {
    return this.service.listForUser(req.tenantId!, req.userId!);
  }

  @Get('count')
  @ApiOperation({ summary: 'Unread messages across my conversations (tab badge)' })
  count(@Req() req: TenantRequest) {
    return this.service.unreadCount(req.tenantId!, req.userId!);
  }

  @Post()
  @ApiOperation({
    summary: 'Open the channel on a turnover (or return the existing one)',
    description:
      'A cleaner may only open a channel on a turnover she holds and has ' +
      'already started. Managers may open one at any time. Idempotent.',
  })
  open(@Req() req: TenantRequest, @Body() dto: { turnoverId: string }) {
    return this.service.openForTurnover(
      req.tenantId!,
      { userId: req.userId!, userRole: req.userRole! },
      dto?.turnoverId,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'One conversation with its whole history' })
  get(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.service.get(
      req.tenantId!, { userId: req.userId!, userRole: req.userRole! }, id,
    );
  }

  @Post(':id/messages')
  @ApiOperation({
    summary: 'Post a message, optionally with pictures',
    description:
      'Attachments are canonical GCS urls produced by the existing ' +
      '/uploads/signed-url flow. Images only for now.',
  })
  post(
    @Req() req: TenantRequest,
    @Param('id') id: string,
    @Body() dto: {
      body?: string;
      attachments?: { url: string; mimeType?: string; bytes?: number; width?: number; height?: number }[];
    },
  ) {
    return this.service.postMessage(
      req.tenantId!, { userId: req.userId!, userRole: req.userRole! }, id, dto ?? {},
    );
  }

  @Get(':id/candidates')
  @ApiOperation({
    summary: 'Who I could add, with a flag for who I am allowed to add',
    description:
      'Returns everyone with canInvite true/false rather than a filtered list — ' +
      'the sheet greys the rest out, which explains the rule instead of hiding it.',
  })
  candidates(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.service.candidates(
      req.tenantId!, { userId: req.userId!, userRole: req.userRole! }, id,
    );
  }

  @Post(':id/members')
  @ApiOperation({ summary: 'Add people to the conversation' })
  addMembers(
    @Req() req: TenantRequest,
    @Param('id') id: string,
    @Body() dto: { userIds: string[] },
  ) {
    return this.service.addMembers(
      req.tenantId!, { userId: req.userId!, userRole: req.userRole! }, id, dto?.userIds ?? [],
    );
  }

  @Post(':id/star')
  @ApiOperation({
    summary: 'Keep this thread (or stop keeping it)',
    description:
      'A starred chat survives the 30-day archive sweep. Remove the star and ' +
      'the next sweep takes it like any other.',
  })
  star(
    @Req() req: TenantRequest,
    @Param('id') id: string,
    @Body() dto: { starred: boolean },
  ) {
    return this.service.setStarred(req.tenantId!, req.userId!, id, !!dto?.starred);
  }

  @Post(':id/read')
  @ApiOperation({ summary: 'Mark everything up to now as read' })
  read(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.service.markRead(req.tenantId!, req.userId!, id);
  }
}
