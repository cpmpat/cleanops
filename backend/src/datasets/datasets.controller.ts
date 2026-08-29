import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard, RolesGuard, Roles } from '../common/guards/auth.guard';
import { TenantRequest } from '../common/middleware/tenant.middleware';
import { DatasetsService } from './datasets.service';

@ApiTags('Datasets')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Roles('MANAGER')
@Controller('datasets')
export class DatasetsController {
  constructor(private readonly datasets: DatasetsService) {}

  @Get()
  @ApiOperation({ summary: 'List the datasets this tenant exposes' })
  list() {
    return this.datasets.list();
  }

  @Get(':key')
  @ApiOperation({
    summary: 'Read one dataset from the tenant spreadsheet',
    description:
      'Read-only. Served from a 60s cache unless refresh=1 is passed. ' +
      'Columns are filtered by the caller role.',
  })
  read(
    @Req() req: TenantRequest,
    @Param('key') key: string,
    @Query('refresh') refresh?: string,
  ) {
    return this.datasets.read(req.tenantId!, key, req.userRole as any, {
      refresh: refresh === '1' || refresh === 'true',
    });
  }
}
