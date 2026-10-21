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
import { PrismaService } from '../common/prisma.service';
import { accountStatus } from '../common/guards/auth.guard';
import { isOfficeRole } from '../common/roles';

/** What a non-office socket learns from a tenant broadcast: that something changed, not what. */
function nudge(data: any) {
  if (Array.isArray(data)) return { count: data.length };
  if (!data || typeof data !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const k of ['id', 'status', 'source', 'at', 'bookingId', 'created', 'updated', 'cancelled']) {
    const v = data[k];
    if (v === undefined) continue;
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) out[k] = v;
  }
  return out;
}

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
    private prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token || client.handshake.headers?.authorization?.replace('Bearer ', '');
      if (!token) { client.disconnect(); return; }

      const payload = this.jwt.verify(token, { secret: this.config.get('JWT_SECRET') });
      const userId = payload.sub;
      const tenantId = payload.tenantId;

      // Same rule as the HTTP guard: a deactivated account gets no live
      // updates, and the role is the current one.
      const status = await accountStatus(this.prisma, userId);
      if (!status.active || status.tenantId !== tenantId) { client.disconnect(); return; }

      // Store mapping
      client.data = { userId, tenantId, role: status.role ?? payload.role };
      // Two tenant rooms: the office gets every broadcast in full; everyone
      // else (cleaners, agents, read-only office roles) only a nudge — id,
      // status, source, time — enough to know to reload, through endpoints
      // that apply their own access rules. Until 15 Oct 2026 every signed-in
      // socket received whole bookings, incidents and turnovers.
      const role = status.role ?? payload.role;
      client.join(isOfficeRole(role) ? `office:${tenantId}` : `staff:${tenantId}`);
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

  /** Notify all users in a tenant: the office in full, everyone else a nudge. */
  emitToTenant(tenantId: string, event: string, data: any) {
    this.server.to(`office:${tenantId}`).emit(event, data);
    this.server.to(`staff:${tenantId}`).emit(event, nudge(data));
  }

  /** Notify a specific user */
  emitToUser(userId: string, event: string, data: any) {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  /** Close every open socket of a person (deactivated account). */
  disconnectUser(userId: string) {
    this.server.in(`user:${userId}`).disconnectSockets(true);
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
