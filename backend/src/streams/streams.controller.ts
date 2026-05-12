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
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AuthGuard, RolesGuard, Roles } from '../common/guards/auth.guard';
import { TenantRequest } from '../common/middleware/tenant.middleware';
import { StreamsService } from './streams.service';

@ApiTags('Streams')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('streams')
export class StreamsController {
  constructor(private service: StreamsService) {}

  // ─── Feed (any role) ───────────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'Get the streams feed (global or per-property)',
    description:
      'Returns a chronologically merged feed of cleanings, reservations, ' +
      'incidents, and manual events. Pass propertyId for a single-property ' +
      'drill-down; omit for the tenant-wide feed. Use the returned nextCursor ' +
      'for infinite scroll.',
  })
  @ApiQuery({ name: 'propertyId', required: false })
  @ApiQuery({ name: 'cursor', required: false, description: 'ISO timestamp; returns items strictly older' })
  @ApiQuery({ name: 'limit', required: false, description: 'Max 100, default 30' })
  @ApiQuery({ name: 'types', required: false, description: 'Comma-separated: RESERVATION,CLEANING,INCIDENT,REPAIR,INSPECTION,MANUAL' })
  @ApiQuery({ name: 'from', required: false, description: 'ISO date inclusive lower bound' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO date inclusive upper bound' })
  getFeed(@Req() req: TenantRequest, @Query() query: any) {
    return this.service.getFeed(req.tenantId!, query);
  }

  // ─── Manual event CRUD (manager only) ──────────────────────

  @Post('manual')
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Create a manually-logged stream event (manager only)' })
  createManual(@Req() req: TenantRequest, @Body() dto: any) {
    return this.service.createManual(
      req.tenantId!,
      { userId: req.userId!, userRole: req.userRole! },
      dto,
    );
  }

  @Patch('manual/:id')
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Update a manual stream event (manager only)' })
  updateManual(
    @Req() req: TenantRequest,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    return this.service.updateManual(
      req.tenantId!,
      { userId: req.userId!, userRole: req.userRole! },
      id,
      dto,
    );
  }

  @Delete('manual/:id')
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Delete a manual stream event (manager only)' })
  deleteManual(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.service.deleteManual(
      req.tenantId!,
      { userId: req.userId!, userRole: req.userRole! },
      id,
    );
  }
}
