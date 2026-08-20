import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { NotificationType, NotificationChannel } from '@prisma/client';

interface SendNotificationDto {
  tenantId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  payload?: any;
  channels?: NotificationChannel[];
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private prisma: PrismaService) {}

  async send(dto: SendNotificationDto) {
    const channels = dto.channels || ['IN_APP', 'PUSH', 'EMAIL'];
    const notifications = [];

    for (const channel of channels) {
      const notif = await this.prisma.notification.create({
        data: {
          tenantId: dto.tenantId,
          userId: dto.userId,
          type: dto.type,
          channel: channel as NotificationChannel,
          title: dto.title,
          body: dto.body,
          payload: dto.payload || {},
        },
      });
      notifications.push(notif);

      // Dispatch to actual channel
      if (channel === 'PUSH') await this.sendPush(dto.userId, dto.title, dto.body);
      if (channel === 'EMAIL') await this.sendEmail(dto.userId, dto.title, dto.body);
    }

    return notifications;
  }

  async getUnread(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId, readAt: null },
      orderBy: { sentAt: 'desc' },
      take: 50,
    });
  }

  async getAll(userId: string, limit = 50, offset = 0) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { sentAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  /**
   * Changes to the work I am holding — the "Změny" tab.
   *
   * Deliberately a narrow slice of the notification table: things that alter a
   * cleaning someone already took. Assignment notifications are not here; those
   * are answered by the cleaning appearing in "Mine".
   */
  async getTurnoverUpdates(userId: string, limit = 50) {
    return this.prisma.notification.findMany({
      where: {
        userId,
        channel: 'IN_APP',
        type: { in: ['CANCELLATION', 'BOOKING_MODIFIED'] },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getTurnoverUpdatesCount(userId: string): Promise<{ count: number }> {
    const count = await this.prisma.notification.count({
      where: {
        userId,
        channel: 'IN_APP',
        readAt: null,
        type: { in: ['CANCELLATION', 'BOOKING_MODIFIED'] },
      },
    });
    return { count };
  }

  async markRead(userId: string, notificationId: string) {
    return this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, readAt: null },
    });
  }

  // ─── Channel Dispatchers ───

  private async sendPush(userId: string, title: string, body: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.pushSubscription) return;

    try {
      // Web Push via FCM or web-push library
      // const subscription = user.pushSubscription as any;
      // await webpush.sendNotification(subscription, JSON.stringify({ title, body }));
      this.logger.log(`Push notification sent to ${user.email}: ${title}`);
    } catch (err) {
      this.logger.warn(`Push failed for ${userId}: ${err.message}`);
    }
  }

  private async sendEmail(userId: string, title: string, body: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    try {
      // Send via Resend/SendGrid
      // const resend = new Resend(process.env.RESEND_API_KEY);
      // await resend.emails.send({ from: process.env.EMAIL_FROM, to: user.email, subject: title, text: body });
      this.logger.log(`Email sent to ${user.email}: ${title}`);
    } catch (err) {
      this.logger.warn(`Email failed for ${userId}: ${err.message}`);
    }
  }

  // ─── Convenience methods for specific notification types ───

  async notifyNewAssignment(tenantId: string, userId: string, eventName: string, eventId: string) {
    return this.send({
      tenantId, userId,
      type: 'NEW_ASSIGNMENT',
      title: 'New Cleaning Assignment',
      body: `You have been assigned to clean ${eventName}.`,
      payload: { eventId },
      channels: ['IN_APP', 'PUSH', 'EMAIL'],
    });
  }

  async notifyReassignment(tenantId: string, oldUserId: string, newUserId: string, eventName: string, eventId: string) {
    await this.send({
      tenantId, userId: oldUserId,
      type: 'REASSIGNMENT',
      title: 'Assignment Removed',
      body: `You have been unassigned from ${eventName}.`,
      payload: { eventId },
      channels: ['IN_APP', 'PUSH', 'EMAIL'],
    });
    await this.send({
      tenantId, userId: newUserId,
      type: 'REASSIGNMENT',
      title: 'New Assignment (Reassigned)',
      body: `You have been assigned to clean ${eventName}.`,
      payload: { eventId },
      channels: ['IN_APP', 'PUSH', 'EMAIL'],
    });
  }

  async notifyCancellation(tenantId: string, userId: string, eventName: string, eventId: string) {
    return this.send({
      tenantId, userId,
      type: 'CANCELLATION',
      title: 'Cleaning Cancelled',
      body: `The cleaning for ${eventName} has been cancelled.`,
      payload: { eventId },
      channels: ['IN_APP', 'PUSH', 'EMAIL'],
    });
  }
}
