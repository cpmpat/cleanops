import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { AssignmentStatus, CleaningEventStatus } from '@prisma/client';

@Injectable()
export class AssignmentsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Manager assigns a cleaner to an event.
   * Max 3 cleaners per event (1 primary + 2 secondary).
   */
  async assign(tenantId: string, eventId: string, userId: string, assignedById: string) {
    // Verify event belongs to tenant
    const event = await this.prisma.cleaningEvent.findFirst({
      where: { id: eventId, tenantId },
      include: { assignments: true },
    });
    if (!event) throw new NotFoundException('Event not found');

    // Check max 3 assignments
    const activeAssignments = event.assignments.filter(
      a => a.status !== AssignmentStatus.REASSIGNED,
    );
    if (activeAssignments.length >= 3) {
      throw new BadRequestException('Maximum 3 cleaners per event');
    }

    // Check if user is already assigned
    if (activeAssignments.some(a => a.userId === userId)) {
      throw new BadRequestException('User is already assigned to this event');
    }

    const isPrimary = activeAssignments.length === 0;

    const assignment = await this.prisma.cleaningAssignment.create({
      data: {
        cleaningEventId: eventId,
        userId,
        assignedById,
        isPrimary,
        status: AssignmentStatus.ASSIGNED,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        assignedBy: { select: { id: true, name: true } },
      },
    });

    // Update event status to ASSIGNED if it was PENDING
    if (event.status === CleaningEventStatus.PENDING) {
      await this.prisma.cleaningEvent.update({
        where: { id: eventId },
        data: { status: CleaningEventStatus.ASSIGNED },
      });
    }

    return assignment;
  }

  /**
   * Cleaner starts a cleaning.
   */
  async start(assignmentId: string, userId: string) {
    const assignment = await this.prisma.cleaningAssignment.findFirst({
      where: { id: assignmentId, userId },
      include: { cleaningEvent: true },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');
    if (assignment.status !== AssignmentStatus.ASSIGNED) {
      throw new BadRequestException(`Cannot start: current status is ${assignment.status}`);
    }

    const updated = await this.prisma.cleaningAssignment.update({
      where: { id: assignmentId },
      data: { status: AssignmentStatus.STARTED, startedAt: new Date() },
    });

    // Update event status to IN_PROGRESS
    await this.prisma.cleaningEvent.update({
      where: { id: assignment.cleaningEventId },
      data: {
        status: CleaningEventStatus.IN_PROGRESS,
        startedAt: assignment.cleaningEvent.startedAt || new Date(),
      },
    });

    return updated;
  }

  /**
   * Cleaner completes a cleaning.
   */
  async complete(assignmentId: string, userId: string, cleanerNote?: string) {
    const assignment = await this.prisma.cleaningAssignment.findFirst({
      where: { id: assignmentId, userId },
      include: {
        cleaningEvent: { include: { assignments: true } },
      },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');
    if (assignment.status !== AssignmentStatus.STARTED) {
      throw new BadRequestException(`Cannot complete: current status is ${assignment.status}`);
    }

    const updated = await this.prisma.cleaningAssignment.update({
      where: { id: assignmentId },
      data: { status: AssignmentStatus.COMPLETED, completedAt: new Date() },
    });

    // Check if ALL active assignments are completed
    const allAssignments = assignment.cleaningEvent.assignments.filter(
      a => a.status !== AssignmentStatus.REASSIGNED && a.id !== assignmentId,
    );
    const allCompleted = allAssignments.every(a => a.status === AssignmentStatus.COMPLETED);

    if (allCompleted) {
      await this.prisma.cleaningEvent.update({
        where: { id: assignment.cleaningEventId },
        data: {
          status: CleaningEventStatus.COMPLETED,
          completedAt: new Date(),
          ...(cleanerNote && { cleanerNote }),
        },
      });
    }

    return updated;
  }

  /**
   * Cleaner rejects an assignment.
   */
  async reject(assignmentId: string, userId: string, reason?: string) {
    const assignment = await this.prisma.cleaningAssignment.findFirst({
      where: { id: assignmentId, userId },
      include: { cleaningEvent: { include: { assignments: true } } },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');
    if (assignment.status !== AssignmentStatus.ASSIGNED) {
      throw new BadRequestException(`Cannot reject: current status is ${assignment.status}`);
    }

    const updated = await this.prisma.cleaningAssignment.update({
      where: { id: assignmentId },
      data: {
        status: AssignmentStatus.REJECTED,
        rejectedReason: reason,
      },
    });

    // If all assignments are rejected/reassigned, set event to FLAGGED
    const activeAssignments = assignment.cleaningEvent.assignments.filter(
      a => a.id !== assignmentId && !['REJECTED', 'REASSIGNED'].includes(a.status),
    );
    if (activeAssignments.length === 0) {
      await this.prisma.cleaningEvent.update({
        where: { id: assignment.cleaningEventId },
        data: { status: CleaningEventStatus.FLAGGED },
      });
    }

    return updated;
  }

  /**
   * Manager reassigns: removes old cleaner, assigns new one.
   * Both the old and new cleaner receive in-app notifications.
   */
  async reassign(
    tenantId: string,
    eventId: string,
    oldUserId: string,
    newUserId: string,
    managerId: string,
  ) {
    // Fetch event for the accommodation name used in notifications
    const event = await this.prisma.cleaningEvent.findFirst({
      where: { id: eventId, tenantId },
    });
    if (!event) throw new NotFoundException('Event not found');

    // Mark old assignment as REASSIGNED
    const oldAssignment = await this.prisma.cleaningAssignment.findFirst({
      where: {
        cleaningEventId: eventId,
        userId: oldUserId,
        status: { in: ['ASSIGNED', 'STARTED'] },
      },
    });
    if (!oldAssignment) throw new NotFoundException('Original assignment not found');

    await this.prisma.cleaningAssignment.update({
      where: { id: oldAssignment.id },
      data: { status: AssignmentStatus.REASSIGNED },
    });

    // Notify old cleaner they have been removed
    await this.prisma.notification.create({
      data: {
        tenantId,
        userId: oldUserId,
        type: 'REASSIGNMENT' as any,
        channel: 'IN_APP',
        title: 'Assignment Removed',
        body: `You have been unassigned from the cleaning at ${event.accommodationName}.`,
        payload: { eventId },
      },
    });

    // Create new assignment (assigns + updates event status)
    const newAssignment = await this.assign(tenantId, eventId, newUserId, managerId);

    // Notify new cleaner they have been assigned
    await this.prisma.notification.create({
      data: {
        tenantId,
        userId: newUserId,
        type: 'NEW_ASSIGNMENT' as any,
        channel: 'IN_APP',
        title: 'New Cleaning Assigned',
        body: `You have been assigned to clean ${event.accommodationName}.`,
        payload: { eventId },
      },
    });

    return newAssignment;
  }

  /**
   * Get my assignments (for cleaner view).
   */
  async getMyAssignments(userId: string, date: string) {
    const startOfDay = new Date(`${date}T00:00:00.000Z`);
    const endOfDay = new Date(`${date}T23:59:59.999Z`);

    return this.prisma.cleaningAssignment.findMany({
      where: {
        userId,
        status: { not: AssignmentStatus.REASSIGNED },
        cleaningEvent: {
          timeSlot: { gte: startOfDay, lte: endOfDay },
          status: { not: CleaningEventStatus.CANCELLED },
        },
      },
      include: {
        cleaningEvent: {
          include: {
            property: { select: { id: true, name: true, address: true, locationLat: true, locationLng: true } },
            eventTags: { include: { tag: true } },
            photos: true,
          },
        },
      },
      orderBy: { cleaningEvent: { timeSlot: 'asc' } },
    });
  }
}