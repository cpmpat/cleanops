import { Controller, Get, Patch, Body, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard, RolesGuard, Roles } from '../common/guards/auth.guard';
import { TenantRequest } from '../common/middleware/tenant.middleware';
import { TenantsService } from './tenants.service';

@ApiTags('Tenants')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Roles('MANAGER')
@Controller('tenant')
export class TenantsController {
  constructor(private service: TenantsService) {}

  @Get()
  get(@Req() req: TenantRequest) {
    return this.service.findById(req.tenantId!);
  }

  @Patch('settings')
  updateSettings(@Req() req: TenantRequest, @Body() dto: any) {
    return this.service.updateSettings(req.tenantId!, dto);
  }

  @Patch('pms-config')
  updatePmsConfig(@Req() req: TenantRequest, @Body() dto: any) {
    // The actor goes with it: changing a PMS credential is an audited act.
    return this.service.updatePmsConfig(req.tenantId!, dto, req.userId);
  }
}
