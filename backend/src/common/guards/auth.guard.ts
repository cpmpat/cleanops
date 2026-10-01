import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TenantRequest } from '../middleware/tenant.middleware';
import { PrismaService } from '../prisma.service';

// ─── Account status, cached ───
//
// A login token lives 30 days, and until 30 Sep 2026 the guard trusted it for
// all of them: a deactivated cleaner who was already logged in kept using the
// app (and claiming cleanings) until the token ran out, and a changed role
// only took effect at the next login. The guard now asks the database whether
// the account is still active and what its role is — once per user per
// minute, so the cost is one indexed primary-key read per user per minute.

const STATUS_TTL_MS = 60_000;
const STATUS_MAX_ENTRIES = 5_000;

export interface AccountStatus {
  at: number;
  active: boolean;
  role: string | null;
  tenantId: string | null;
}

const statusCache = new Map<string, AccountStatus>();

/** Is this account usable right now, and with which role? Cached 60 s per user. */
export async function accountStatus(prisma: PrismaService, userId: string): Promise<AccountStatus> {
  const hit = statusCache.get(userId);
  if (hit && Date.now() - hit.at < STATUS_TTL_MS) return hit;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isActive: true, role: true, tenantId: true },
  });
  const entry: AccountStatus = {
    at: Date.now(),
    active: !!user?.isActive,
    role: user?.role ?? null,
    tenantId: user?.tenantId ?? null,
  };
  if (statusCache.size >= STATUS_MAX_ENTRIES) {
    // Drop the oldest entry; Map iterates in insertion order.
    const oldest = statusCache.keys().next().value;
    if (oldest !== undefined) statusCache.delete(oldest);
  }
  statusCache.delete(userId);
  statusCache.set(userId, entry);
  return entry;
}

// ─── Auth Guard ───
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private jwt: JwtService,
    private config: ConfigService,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<TenantRequest>();
    const token =
      req.cookies?.access_token ||
      req.headers.authorization?.replace('Bearer ', '');

    if (!token) throw new UnauthorizedException('No token provided');

    let payload: any;
    try {
      payload = this.jwt.verify(token, {
        secret: this.config.get('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // A valid token is not enough: the account must still be active, and the
    // role is the one it has now, not the one it had when the token was
    // issued. 401 sends the app to its session refresh, which also refuses a
    // deactivated account — so the person is logged out within a minute.
    const status = await accountStatus(this.prisma, payload.sub);
    if (!status.active || status.tenantId !== payload.tenantId) {
      throw new UnauthorizedException('This account is not active');
    }

    req.tenantId = payload.tenantId;
    req.userId = payload.sub;
    req.userRole = (status.role ?? payload.role) as any;
    return true;
  }
}

// ─── Role Guard ───
export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) return true;

    const req = context.switchToHttp().getRequest<TenantRequest>();
    if (!req.userRole) throw new ForbiddenException('No role assigned');

    // ADMIN satisfies every requirement. Without this an admin account would
    // be locked out of the app it administers the moment its role is set,
    // because every guarded endpoint names concrete roles.
    if (req.userRole === 'ADMIN') return true;

    if (!requiredRoles.includes(req.userRole)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
