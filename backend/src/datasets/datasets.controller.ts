import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard, RolesGuard, Roles } from '../common/guards/auth.guard';
import type { Response } from 'express';
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

  @Post(':key/export')
  @ApiOperation({
    summary: 'Export a dataset as CSV or XLSX',
    description:
      'Served from the same read the screen uses, so the file contains exactly ' +
      'the columns this role may see — no more. The body may carry the current ' +
      'view (columns, filters, search, sort) to make the file match what is on ' +
      'screen; every one of those can only narrow the result. Each export ' +
      'writes an AuditEvent naming any sensitive columns included.',
  })
  async exportDataset(
    @Req() req: TenantRequest,
    @Param('key') key: string,
    @Body() body: any,
    @Res() res: Response,
  ) {
    const out = await this.datasets.exportDataset(
      req.tenantId!,
      key,
      req.userRole as any,
      req.userId,
      body ?? {},
    );
    res.setHeader('Content-Type', out.contentType);
    // The quoted form matters: a filename is built from the dataset key and a
    // date, but a header without quotes breaks on the first one containing a
    // space and silently saves the file as "attachment".
    res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
    res.setHeader('Content-Length', String(out.body.length));
    res.end(out.body);
  }

  @Post(':key')
  @ApiOperation({
    summary: 'Add a row to a dataset',
    description:
      'Only for lists that have been migrated into Postgres. A list still ' +
      'served from the spreadsheet rejects this, because the app holds ' +
      'read-only scope on the sheet and always will.',
  })
  create(
    @Req() req: TenantRequest,
    @Param('key') key: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.datasets.create(
      req.tenantId!,
      key,
      req.userRole as any,
      req.userId,
      body ?? {},
    );
  }
}
