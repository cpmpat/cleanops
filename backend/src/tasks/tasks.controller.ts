import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard, RolesGuard, Roles } from '../common/guards/auth.guard';
import { TenantRequest } from '../common/middleware/tenant.middleware';
import { TASK_ROLES } from '../common/roles';
import { Actor, TasksService } from './tasks.service';

/**
 * Tasks (16 Oct 2026). Every route needs an office-app role; what each person
 * may then do (create, close, move, edit) is decided in TasksService.
 */
@ApiTags('Tasks')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Roles(...TASK_ROLES)
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  private actor(req: TenantRequest): Actor {
    return { userId: req.userId!, role: req.userRole as string };
  }

  @Get()
  @ApiOperation({ summary: 'The board: open tasks plus those closed in the last 14 days (?done=all for every closed one)' })
  board(@Req() req: TenantRequest, @Query('done') done?: string) {
    return this.tasks.board(req.tenantId!, this.actor(req), { allDone: done === 'all' });
  }

  @Get('badge')
  @ApiOperation({ summary: 'Tasks hanging on the caller, and unread Tasks notifications' })
  badge(@Req() req: TenantRequest) {
    return this.tasks.badge(req.tenantId!, this.actor(req));
  }

  @Get('people')
  @ApiOperation({ summary: 'Who can be assigned or tagged (active office-app users)' })
  people(@Req() req: TenantRequest) {
    return this.tasks.people(req.tenantId!);
  }

  @Get('link-targets')
  @ApiOperation({ summary: 'Data lists the caller can link a task to' })
  linkTargets(@Req() req: TenantRequest) {
    return this.tasks.linkTargets(req.tenantId!, this.actor(req));
  }

  @Get('link-targets/:dataset')
  @ApiOperation({ summary: 'Records of one list to link (access matrix + row filter), with the attributes the caller may see' })
  pick(@Req() req: TenantRequest, @Param('dataset') dataset: string, @Query('q') q?: string) {
    return this.tasks.pickRecords(req.tenantId!, this.actor(req), dataset, q ?? '');
  }

  @Get('notifications')
  notifications(@Req() req: TenantRequest) {
    return this.tasks.notifications(req.tenantId!, this.actor(req));
  }

  @Post('notifications/read')
  markRead(@Req() req: TenantRequest, @Body() body: { ids?: string[]; taskId?: string; all?: boolean }) {
    return this.tasks.markRead(req.tenantId!, this.actor(req), body ?? {});
  }

  @Post()
  @ApiOperation({ summary: 'Create a task (task managers)' })
  create(@Req() req: TenantRequest, @Body() body: any) {
    return this.tasks.create(req.tenantId!, this.actor(req), body ?? {});
  }

  @Get(':id')
  detail(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.tasks.detail(req.tenantId!, id, this.actor(req));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit title, description, priority, due date, hold reason (task managers)' })
  update(@Req() req: TenantRequest, @Param('id') id: string, @Body() body: any) {
    return this.tasks.update(req.tenantId!, id, this.actor(req), body ?? {});
  }

  @Put(':id/assignees')
  assign(@Req() req: TenantRequest, @Param('id') id: string, @Body() body: { userIds?: string[] }) {
    return this.tasks.setAssignees(req.tenantId!, id, this.actor(req), body?.userIds ?? []);
  }

  @Post(':id/move')
  @ApiOperation({ summary: 'Change stage and/or position. DONE and reopening: task managers only' })
  move(@Req() req: TenantRequest, @Param('id') id: string, @Body() body: any) {
    return this.tasks.move(req.tenantId!, id, this.actor(req), body ?? {});
  }

  @Post(':id/watch')
  watch(@Req() req: TenantRequest, @Param('id') id: string, @Body() body: { watching?: boolean }) {
    return this.tasks.watch(req.tenantId!, id, this.actor(req), body?.watching !== false);
  }

  @Post(':id/comments')
  @ApiOperation({ summary: 'Reply. mentionIds notify; waitOnIds (a subset of them) also put the task on those people until they reply' })
  comment(@Req() req: TenantRequest, @Param('id') id: string, @Body() body: { body?: string; mentionIds?: string[]; waitOnIds?: string[] }) {
    return this.tasks.comment(req.tenantId!, id, this.actor(req), body ?? {});
  }

  @Post(':id/links')
  addLink(@Req() req: TenantRequest, @Param('id') id: string, @Body() body: { dataset?: string; rowId?: string; field?: string | null }) {
    return this.tasks.addLink(req.tenantId!, id, this.actor(req), { dataset: body?.dataset ?? '', rowId: body?.rowId ?? '', field: body?.field ?? null });
  }

  @Delete(':id/links/:linkId')
  removeLink(@Req() req: TenantRequest, @Param('id') id: string, @Param('linkId') linkId: string) {
    return this.tasks.removeLink(req.tenantId!, id, this.actor(req), linkId);
  }

  @Post(':id/waits')
  addWait(@Req() req: TenantRequest, @Param('id') id: string, @Body() body: { userId?: string }) {
    return this.tasks.addWait(req.tenantId!, id, this.actor(req), body?.userId ?? '');
  }

  @Delete(':id/waits/:waitId')
  clearWait(@Req() req: TenantRequest, @Param('id') id: string, @Param('waitId') waitId: string) {
    return this.tasks.clearWait(req.tenantId!, id, this.actor(req), waitId);
  }
}
