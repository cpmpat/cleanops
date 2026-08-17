import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

export interface TenantRequest extends Request {
  tenantId?: string;
  userId?: string;
  userRole?: string;
}

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  use(req: TenantRequest, res: Response, next: NextFunction) {
    try {
      const token =
        req.cookies?.access_token ||
        req.headers.authorization?.replace('Bearer ', '');

      if (token) {
        const payload = this.jwt.verify(token, {
          secret: this.config.get('JWT_SECRET'),
        });
        req.tenantId = payload.tenantId;
        req.userId = payload.sub;
        req.userRole = payload.role;
      }
    } catch {
      // Token invalid or expired — let guards handle it
    }

    next();
  }
}
