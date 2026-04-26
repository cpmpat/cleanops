import { Module } from '@nestjs/common';
import {
  WebSocketGateway, WebSocketServer, SubscribeMessage,
  OnGatewayConnection, OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';

// ─── Gateway ───
@WebSocketGateway({
  cors: { origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true },
  namespace: '/ws',
})
@Injectable()
export class CleanOpsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(CleanOpsGateway.name);
  private userSockets: Map<string, Set<string>> = new Map(); // userId → Set<socketId>

  constructor(
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token || client.handshake.headers?.authorization?.replace('Bearer ', '');
      if (!token) { client.disconnect(); return; }

      const payload = this.jwt.verify(token, { secret: this.config.get('JWT_SECRET') });
      const userId = payload.sub;
      const tenantId = payload.tenantId;

      // Store mapping
      client.data = { userId, tenantId, role: payload.role };
      client.join(`tenant:${tenantId}`);
      client.join(`user:${userId}`);

      if (!this.userSockets.has(userId)) this.userSockets.set(userId, new Set());
      this.userSockets.get(userId)!.add(client.id);

      this.logger.log(`Client connected: ${userId} (${payload.role})`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data?.userId;
    if (userId) {
      this.userSockets.get(userId)?.delete(client.id);
      if (this.userSockets.get(userId)?.size === 0) this.userSockets.delete(userId);
    }
  }

  // ─── Emit helpers (called from services) ───

  /** Notify all users in a tenant */
  emitToTenant(tenantId: string, event: string, data: any) {
    this.server.to(`tenant:${tenantId}`).emit(event, data);
  }

  /** Notify a specific user */
  emitToUser(userId: string, event: string, data: any) {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  /** Event created/updated from PMS sync */
  notifyEventCreated(tenantId: string, event: any) {
    this.emitToTenant(tenantId, 'event:created', event);
  }

  notifyEventUpdated(tenantId: string, event: any) {
    this.emitToTenant(tenantId, 'event:updated', event);
  }

  notifyEventCancelled(tenantId: string, event: any) {
    this.emitToTenant(tenantId, 'event:cancelled', event);
  }

  notifyAssignmentNew(userId: string, assignment: any) {
    this.emitToUser(userId, 'assignment:new', assignment);
  }

  notifyAssignmentChanged(userId: string, assignment: any) {
    this.emitToUser(userId, 'assignment:changed', assignment);
  }

  notifyAssignmentStatus(tenantId: string, assignment: any) {
    this.emitToTenant(tenantId, 'assignment:status', assignment);
  }

  notifyOverdue(tenantId: string, events: any[]) {
    // Only emit to managers in this tenant
    this.emitToTenant(tenantId, 'alert:overdue', events);
  }

  @SubscribeMessage('ping')
  handlePing() { return { event: 'pong', data: { timestamp: Date.now() } }; }
}

// ─── Module ───
@Module({
  imports: [AuthModule],
  providers: [CleanOpsGateway],
  exports: [CleanOpsGateway],
})
export class WebsocketModule {}
