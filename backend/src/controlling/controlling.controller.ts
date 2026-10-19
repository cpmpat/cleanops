import { Controller, ForbiddenException, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard, RolesGuard, Roles } from '../common/guards/auth.guard';
import { TenantRequest } from '../common/middleware/tenant.middleware';
import { ControllingService } from './controlling.service';

/**
 * Controlling — manager only. RolesGuard lets ADMIN through every role check,
 * so the role is checked here as well: this module is for the MANAGER alone.
 */
@ApiTags('Controlling')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller('controlling')
export class ControllingController {
  constructor(private readonly controlling: ControllingService) {}

  private only(req: TenantRequest) {
    if (req.userRole !== 'MANAGER') throw new ForbiddenException('Controlling is for the manager only');
  }

  @Get()
  @Roles('MANAGER')
  @ApiOperation({ summary: 'The Controlling sources' })
  sources(@Req() req: TenantRequest) {
    this.only(req);
    return this.controlling.list();
  }

  @Get(':source')
  @Roles('MANAGER')
  @ApiOperation({ summary: 'One source, whole (cached 10 min; ?refresh=1 re-reads it)' })
  read(@Req() req: TenantRequest, @Param('source') source: string, @Query('refresh') refresh?: string) {
    this.only(req);
    return this.controlling.read(req.tenantId!, source, refresh === '1' || refresh === 'true');
  }
}
