import {
  Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard, RolesGuard, Roles } from '../common/guards/auth.guard';
import { TenantRequest } from '../common/middleware/tenant.middleware';
import { NotesService, CreateNoteDto } from './notes.service';

/**
 * Manager messages. Cleaners read and confirm; managers write.
 */
@ApiTags('Notes')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('notes')
export class NotesController {
  constructor(private service: NotesService) {}

  // ─── Any role ──────────────────────────────────────────────────────────────

  @Get('active')
  @ApiOperation({
    summary: 'Messages addressed to me that I have not confirmed yet',
    description:
      'State-based on purpose — the cleaner tab stays open for days and will ' +
      'miss websocket frames. Clients re-read this on reconnect, on focus and ' +
      'on a slow interval.',
  })
  active(@Req() req: TenantRequest) {
    return this.service.activeForUser(req.tenantId!, req.userId!);
  }

  @Get('mine')
  @ApiOperation({
    summary: 'Every message addressed to me, confirmed or not',
    description:
      'Feeds the Notifikace screen. Confirmed messages stay in the list until ' +
      'they expire — people come back to re-read them.',
  })
  mine(@Req() req: TenantRequest) {
    return this.service.mineForUser(req.tenantId!, req.userId!);
  }

  @Get('count')
  @ApiOperation({ summary: 'Number of messages I have not confirmed (tab badge)' })
  count(@Req() req: TenantRequest) {
    return this.service.unconfirmedCount(req.tenantId!, req.userId!);
  }

  @Post(':id/ack')
  @ApiOperation({ summary: 'Confirm a message ("Rozumím")' })
  ack(
    @Req() req: TenantRequest,
    @Param('id') id: string,
    @Body() dto: { localeShown?: string },
  ) {
    return this.service.acknowledge(
      req.tenantId!, req.userId!, id, dto?.localeShown,
    );
  }

  // ─── Manager only ──────────────────────────────────────────────────────────

  @Get()
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'List messages with live recipient + confirmation counts' })
  list(@Req() req: TenantRequest, @Query('includeExpired') includeExpired?: string) {
    return this.service.listForManager(req.tenantId!, includeExpired === 'true');
  }

  @Post()
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Publish a message to people or to properties' })
  create(@Req() req: TenantRequest, @Body() dto: CreateNoteDto) {
    return this.service.create(
      req.tenantId!,
      { userId: req.userId!, userRole: req.userRole! },
      dto,
    );
  }

  @Patch(':id')
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({
    summary: 'Edit a message',
    description:
      'Changing the text bumps the version, which invalidates existing ' +
      'confirmations — the message comes back to everyone.',
  })
  update(
    @Req() req: TenantRequest,
    @Param('id') id: string,
    @Body() dto: Partial<CreateNoteDto>,
  ) {
    return this.service.update(req.tenantId!, id, dto);
  }

  @Patch(':id/archive')
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Pull a message from the cleaners’ screens' })
  archive(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.service.archive(req.tenantId!, id);
  }
}
