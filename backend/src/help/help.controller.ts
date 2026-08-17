import {
  Controller, Get, Post, Put, Body, Param, Query, UseGuards, Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard, RolesGuard, Roles } from '../common/guards/auth.guard';
import { TenantRequest } from '../common/middleware/tenant.middleware';
import { HelpService } from './help.service';

@ApiTags('Help')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('help')
export class HelpController {
  constructor(private service: HelpService) {}

  // ─── Any role ──────────────────────────────────────────────────────────────

  @Get('meta')
  @ApiOperation({
    summary: 'Version of the manual for this user',
    description: 'A few bytes — used for the "new manual" dot, so the app does not pull the whole document to answer that question.',
  })
  meta(@Req() req: TenantRequest) {
    return this.service.metaForUser(req.tenantId!, req.userId!);
  }

  @Get()
  @ApiOperation({ summary: 'The manual in the user’s language, Czech as fallback' })
  get(@Req() req: TenantRequest, @Query('locale') locale?: string) {
    return this.service.forUser(req.tenantId!, req.userId!, locale);
  }

  // ─── Manager only ──────────────────────────────────────────────────────────

  @Get('docs')
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Every stored language with version and size' })
  list(@Req() req: TenantRequest) {
    return this.service.list(req.tenantId!);
  }

  @Post('import')
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({
    summary: 'Import the exported multi-language manual',
    description: 'Splits the file on its language panes and stores one document per language.',
  })
  import(@Req() req: TenantRequest, @Body() dto: { html: string }) {
    return this.service.importBundle(req.tenantId!, req.userId!, dto?.html);
  }

  @Put(':locale')
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Publish one language on its own' })
  publish(
    @Req() req: TenantRequest,
    @Param('locale') locale: string,
    @Body() dto: { html: string; title?: string },
  ) {
    return this.service.publish(
      req.tenantId!, req.userId!, locale, dto?.html, dto?.title,
    );
  }
}
