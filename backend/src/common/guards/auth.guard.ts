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

// ─── Auth Guard ───
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<TenantRequest>();
    const token =
      req.cookies?.access_token ||
      req.headers.authorization?.replace('Bearer ', '');

    if (!token) throw new UnauthorizedException('No token provided');

    try {
      const payload = this.jwt.verify(token, {
        secret: this.config.get('JWT_SECRET'),
      });
      req.tenantId = payload.tenantId;
      req.userId = payload.sub;
      req.userRole = payload.role;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
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
