import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AuthGuard, RolesGuard, Roles } from '../common/guards/auth.guard';
import { TenantRequest } from '../common/middleware/tenant.middleware';
import { RepairsService } from './repairs.service';
import { RepairMaterialsService } from './repair-materials.service';
import type {
  CreateRepairDto,
  CreateRepairFromIncidentDto,
  UpdateRepairDto,
  AssignRepairDto,
  SubmitDoneDto,
  ReportProblemDto,
} from './repairs.service';
import type { CreateMaterialDto, UpdateMaterialDto } from './repair-materials.service';

// ════════════════════════════════════════════════════════════════════
// REPAIRS CONTROLLER
// ════════════════════════════════════════════════════════════════════

@ApiTags('Repairs')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('repairs')
export class RepairsController {
  constructor(private service: RepairsService) {}

  // ─── Repairman: my assigned repairs ───────────────────────────────

  @Get('mine')
  @ApiOperation({ summary: 'List repairs assigned to the current user' })
  listMine(@Req() req: TenantRequest) {
    return this.service.listMine(req.tenantId!, req.userId!);
  }

  // ─── Manager: list / get / create / update / cancel ───────────────

  @Get()
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'propertyId', required: false })
  @ApiQuery({ name: 'assignedToId', required: false })
  @ApiQuery({ name: 'due', required: false, description: 'overdue|today|week|all' })
  list(@Req() req: TenantRequest, @Query() query: any) {
    return this.service.list(req.tenantId!, {
      status: query.status,
      propertyId: query.propertyId,
      assignedToId: query.assignedToId,
      due: query.due,
    });
  }

  @Get(':id')
  getById(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.service.getById(req.tenantId!, id, {
      userId: req.userId!,
      userRole: req.userRole! as any,
    });
  }

  @Post()
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  create(@Req() req: TenantRequest, @Body() dto: CreateRepairDto) {
    return this.service.createManual(
      req.tenantId!,
      { userId: req.userId!, userRole: req.userRole! as any },
      dto,
    );
  }

  @Post('from-incident/:incidentId')
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Create a repair linked to an existing incident' })
  createFromIncident(
    @Req() req: TenantRequest,
    @Param('incidentId') incidentId: string,
    @Body() dto: CreateRepairFromIncidentDto,
  ) {
    return this.service.createFromIncident(
      req.tenantId!,
      { userId: req.userId!, userRole: req.userRole! as any },
      incidentId,
      dto,
    );
  }

  @Patch(':id')
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  update(
    @Req() req: TenantRequest,
    @Param('id') id: string,
    @Body() dto: UpdateRepairDto,
  ) {
    return this.service.update(
      req.tenantId!,
      { userId: req.userId!, userRole: req.userRole! as any },
      id,
      dto,
    );
  }

  @Delete(':id')
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Cancel a repair (sets status=CANCELLED, does not delete)' })
  cancel(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.service.cancel(
      req.tenantId!,
      { userId: req.userId!, userRole: req.userRole! as any },
      id,
    );
  }

  // ─── Manager: assignment ──────────────────────────────────────────

  @Post(':id/assign')
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  assign(
    @Req() req: TenantRequest,
    @Param('id') id: string,
    @Body() dto: AssignRepairDto,
  ) {
    return this.service.assign(
      req.tenantId!,
      { userId: req.userId!, userRole: req.userRole! as any },
      id,
      dto,
    );
  }

  // ─── Repairman: state transitions ─────────────────────────────────

  @Post(':id/start')
  @ApiOperation({ summary: 'Repairman taps Start — marks IN_PROGRESS' })
  start(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.service.start(
      {
        userId: req.userId!,
        userRole: req.userRole! as any,
        tenantId: req.tenantId!,
      },
      id,
    );
  }

  @Post(':id/done')
  @ApiOperation({ summary: 'Repairman submits work for review' })
  submitDone(
    @Req() req: TenantRequest,
    @Param('id') id: string,
    @Body() dto: SubmitDoneDto,
  ) {
    return this.service.submitDone(
      {
        userId: req.userId!,
        userRole: req.userRole! as any,
        tenantId: req.tenantId!,
      },
      id,
      dto,
    );
  }

  @Post(':id/report')
  @ApiOperation({ summary: 'Repairman reports a problem — marks REPORTED_BACK' })
  reportProblem(
    @Req() req: TenantRequest,
    @Param('id') id: string,
    @Body() dto: ReportProblemDto,
  ) {
    return this.service.reportProblem(
      {
        userId: req.userId!,
        userRole: req.userRole! as any,
        tenantId: req.tenantId!,
      },
      id,
      dto,
    );
  }

  // ─── Manager: review actions ──────────────────────────────────────

  @Patch(':id/approve')
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Approve a repair in review (IN_REVIEW → DONE)' })
  approve(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.service.approve(
      req.tenantId!,
      { userId: req.userId!, userRole: req.userRole! as any },
      id,
    );
  }

  @Patch(':id/reject-review')
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Reject a repair in review (IN_REVIEW → IN_PROGRESS)' })
  rejectReview(
    @Req() req: TenantRequest,
    @Param('id') id: string,
    @Body() body: { note?: string },
  ) {
    return this.service.rejectReview(
      req.tenantId!,
      { userId: req.userId!, userRole: req.userRole! as any },
      id,
      body.note,
    );
  }

  // ─── Comments (both roles) ────────────────────────────────────────

  @Get(':id/comments')
  listComments(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.service.listComments(req.tenantId!, id);
  }

  @Post(':id/comments')
  addComment(
    @Req() req: TenantRequest,
    @Param('id') id: string,
    @Body() body: { body: string },
  ) {
    return this.service.addComment(
      {
        userId: req.userId!,
        userRole: req.userRole! as any,
        tenantId: req.tenantId!,
      },
      id,
      body.body,
    );
  }
}

// ════════════════════════════════════════════════════════════════════
// MATERIALS CONTROLLER (manager-only, reads available to all)
// ════════════════════════════════════════════════════════════════════

@ApiTags('Repair Materials')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('repair-materials')
export class RepairMaterialsController {
  constructor(private service: RepairMaterialsService) {}

  @Get()
  @ApiOperation({ summary: 'List active material catalog entries' })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  list(@Req() req: TenantRequest, @Query('includeInactive') includeInactive?: string) {
    return this.service.list(req.tenantId!, includeInactive === 'true');
  }

  @Post()
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  create(@Req() req: TenantRequest, @Body() dto: CreateMaterialDto) {
    return this.service.create(req.tenantId!, dto);
  }

  @Patch(':id')
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  update(
    @Req() req: TenantRequest,
    @Param('id') id: string,
    @Body() dto: UpdateMaterialDto,
  ) {
    return this.service.update(req.tenantId!, id, dto);
  }

  @Delete(':id')
  @Roles('MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Soft-delete a material (sets isActive=false)' })
  deactivate(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.service.deactivate(req.tenantId!, id);
  }
}
