import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard, RolesGuard, Roles } from '../common/guards/auth.guard';
import { TenantRequest } from '../common/middleware/tenant.middleware';
import { IncidentsService } from './incidents.service';

@ApiTags('Incidents')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('incidents')
export class IncidentsController {
  constructor(private service: IncidentsService) {}

  // ─── Read (manager + cleaner; service applies role scope) ───

  @Get()
  @ApiOperation({ summary: 'List incidents (role-scoped)' })
  list(@Req() req: TenantRequest, @Query() query: any) {
    return this.service.list(
      req.tenantId!,
      {
        userId: req.userId!,
        userRole: req.userRole!,
      },
      query,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get incident by ID (role-scoped)' })
  get(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.service.get(
      req.tenantId!,
      { userId: req.userId!, userRole: req.userRole! },
      id,
    );
  }

  // ─── Write (manager only) ───────────────────────────────────

  @Post()
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Create incident (manager only)' })
  create(@Req() req: TenantRequest, @Body() dto: any) {
    return this.service.create(
      req.tenantId!,
      { userId: req.userId!, userRole: req.userRole! },
      dto,
    );
  }

  @Patch(':id')
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Update incident (manager only)' })
  update(
    @Req() req: TenantRequest,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    return this.service.update(
      req.tenantId!,
      { userId: req.userId!, userRole: req.userRole! },
      id,
      dto,
    );
  }

  @Post(':id/attachments')
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Add attachment (manager only)' })
  addAttachment(
    @Req() req: TenantRequest,
    @Param('id') id: string,
    @Body() dto: { url: string; mimeType?: string },
  ) {
    return this.service.addAttachment(
      req.tenantId!,
      { userId: req.userId!, userRole: req.userRole! },
      id,
      dto,
    );
  }

  @Delete(':id/attachments/:attachmentId')
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Delete attachment (manager only)' })
  deleteAttachment(
    @Req() req: TenantRequest,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.service.deleteAttachment(
      req.tenantId!,
      { userId: req.userId!, userRole: req.userRole! },
      id,
      attachmentId,
    );
  }
}
