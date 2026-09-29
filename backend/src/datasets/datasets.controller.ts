import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard, RolesGuard, Roles } from '../common/guards/auth.guard';
import type { Response } from 'express';
import { TenantRequest } from '../common/middleware/tenant.middleware';
import { DatasetsService } from './datasets.service';

@ApiTags('Datasets')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller('datasets')
export class DatasetsController {
  constructor(private readonly datasets: DatasetsService) {}

  // Access is decided per list and per column by the dataset access matrix
  // (dataset_field_access), not by a role list on this controller: any
  // signed-in user may ask, and sees only what the matrix grants their role.

  @Get()
  @ApiOperation({ summary: 'The lists this role may open' })
  list(@Req() req: TenantRequest) {
    return this.datasets.list(req.tenantId!, req.userRole as any);
  }

  @Get(':key')
  @ApiOperation({
    summary: 'Read one dataset from the tenant spreadsheet',
    description:
      'Columns are those the access matrix lets the caller role view; each ' +
      'carries access view|edit. Migrated lists also return rowIds and ' +
      'versions (updatedAt) for saving.',
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
  @Roles('MANAGER')
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
  @ApiOperation({ summary: 'Add a row — switched off for every list and role for now' })
  create() {
    return this.datasets.create();
  }

  @Patch(':key/rows/:rowId')
  @ApiOperation({
    summary: 'Save one row\'s edits',
    description:
      'Body: { version: <updatedAt as read>, values: { field: value, … } }. Every field needs an ' +
      'edit grant for the caller role, or nothing is saved. 409 when the row changed since it ' +
      'was read. Each save writes an audit event plus one field change per changed field.',
  })
  update(
    @Req() req: TenantRequest,
    @Param('key') key: string,
    @Param('rowId') rowId: string,
    @Body() body: { version?: string; values?: Record<string, unknown> },
  ) {
    return this.datasets.update(req.tenantId!, key, req.userRole as any, req.userId, rowId, body ?? {});
  }

  @Get(':key/rows/:rowId/history')
  @ApiOperation({ summary: 'Field-level change history of one row, for the fields the caller may view' })
  history(@Req() req: TenantRequest, @Param('key') key: string, @Param('rowId') rowId: string) {
    return this.datasets.history(req.tenantId!, key, req.userRole as any, rowId);
  }
}
