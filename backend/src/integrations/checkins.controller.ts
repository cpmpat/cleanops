import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard, Roles, RolesGuard } from '../common/guards/auth.guard';
import { TenantRequest } from '../common/middleware/tenant.middleware';
import { CheckInAgentService } from './checkin-agent.service';

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
