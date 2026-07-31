import {
  Controller, Get, Post, Patch, Body, Param, Query,
  UseGuards, Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard, RolesGuard, Roles } from '../common/guards/auth.guard';
import { TenantRequest } from '../common/middleware/tenant.middleware';
import { todayInAppZone } from '../common/time';
import { AssignmentsService } from './assignments.service';

@ApiTags('Assignments')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('assignments')
export class AssignmentsController {
  constructor(private service: AssignmentsService) {}

  @Get('my')
  @ApiOperation({ summary: 'Get my assignments for a date (cleaner)' })
  getMyAssignments(@Req() req: TenantRequest, @Query('date') date: string) {
    return this.service.getMyAssignments(
      req.userId!,
      date || todayInAppZone(),
    );
  }

  @Post('assign')
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Assign a cleaner to an event (manager only)' })
  assign(
    @Req() req: TenantRequest,
    @Body() dto: { cleaningId: string; userId: string },
  ) {
    return this.service.assign(req.tenantId!, dto.cleaningId, dto.userId, req.userId!);
  }

  @Post('reassign')
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Reassign event from one cleaner to another (manager only)' })
  reassign(
    @Req() req: TenantRequest,
    @Body() dto: { cleaningId: string; oldUserId: string; newUserId: string },
  ) {
    return this.service.reassign(
      req.tenantId!, dto.cleaningId, dto.oldUserId, dto.newUserId, req.userId!,
    );
  }

  @Patch(':id/start')
  @ApiOperation({ summary: 'Start a cleaning (cleaner)' })
  start(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.service.start(id, req.userId!);
  }

  @Patch(':id/complete')
  @ApiOperation({ summary: 'Complete a cleaning (cleaner)' })
  complete(
    @Req() req: TenantRequest,
    @Param('id') id: string,
    @Body() dto: { cleanerNote?: string },
  ) {
    return this.service.complete(id, req.userId!, dto.cleanerNote);
  }

  @Patch(':id/reject')
  @ApiOperation({ summary: 'Reject an assignment (cleaner)' })
  reject(
    @Req() req: TenantRequest,
    @Param('id') id: string,
    @Body() dto: { reason?: string },
  ) {
    return this.service.reject(id, req.userId!, dto.reason);
  }
}
