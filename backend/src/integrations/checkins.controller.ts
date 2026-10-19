import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard, Roles, RolesGuard } from '../common/guards/auth.guard';
import { TenantRequest } from '../common/middleware/tenant.middleware';
import { CheckInAgentService, ReportDto } from './checkin-agent.service';

/**
 * The check-in agent's own view. Every route reads only the signed-in agent's
 * rows; the desk side lives under /integrations/planning/checkin-agent.
 */
@ApiTags('Check-ins (agent)')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Roles('AGENT')
@Controller('checkins')
export class CheckInsController {
  constructor(private checkIns: CheckInAgentService) {}

  @Get('mine')
  @ApiOperation({ summary: 'My upcoming check-ins and the changes waiting for my answer' })
  mine(@Req() req: TenantRequest) {
    return this.checkIns.mine(req.tenantId!, req.userId!);
  }

  @Get('mine/count')
  @ApiOperation({ summary: 'How many changes are waiting for my answer (tab badge)' })
  count(@Req() req: TenantRequest) {
    return this.checkIns.pendingCount(req.tenantId!, req.userId!);
  }

  @Get(':bookingId')
  @ApiOperation({ summary: 'One of my check-ins: guest name and phone, time, Chekin link, my report' })
  detail(@Req() req: TenantRequest, @Param('bookingId') bookingId: string) {
    return this.checkIns.detail(req.tenantId!, req.userId!, bookingId);
  }

  @Put(':bookingId/report')
  @ApiOperation({
    summary: 'Write or correct my report on a check-in',
    description: 'Body: { comment?, ratings: [{ aspect: "CLEANLINESS", score: 1–5, comment? }] }. ' +
      'A score below 3 needs its own comment. From the arrival day for 14 days.',
  })
  report(@Req() req: TenantRequest, @Param('bookingId') bookingId: string, @Body() body: ReportDto) {
    return this.checkIns.saveReport(req.tenantId!, req.userId!, bookingId, body ?? {});
  }

  @Post('changes/:recipientId/respond')
  @ApiOperation({
    summary: 'Answer one change',
    description: 'Body: { response: "ACK" | "ACCEPT" | "DECLINE" }. An override needs ACCEPT or DECLINE; anything else is ACK.',
  })
  respond(
    @Req() req: TenantRequest,
    @Param('recipientId') recipientId: string,
    @Body() body: { response?: string },
  ) {
    return this.checkIns.respond(req.tenantId!, req.userId!, recipientId, String(body?.response ?? ''));
  }
}
