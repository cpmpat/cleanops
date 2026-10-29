import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

// ─── In-memory fixed-window rate limiter ───
//
// Until now the login and magic-link routes had no brute-force protection at
// all: an attacker could try passwords, or spray magic-link emails, as fast as
// the network allowed. This caps attempts per client without a new dependency
// or a schema change, in the same spirit as the account-status cache next door.
//
// Per-process. One API instance today, so one shared window; if the API is
// ever scaled horizontally, move the counter to Redis (ioredis is already a
// dependency) so the window is shared across instances. Until then each
// instance enforces its own copy, which still bounds a single attacker hitting
// a single instance.

export interface RateLimitOptions {
  /** Max requests allowed inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /**
   * Also bucket by the request body's `email`, so one IP cannot cycle through
   * accounts under a single counter and each account gets its own budget.
   * Leave off for routes with no email (refresh), where the bucket is per-IP.
   */
  byEmail?: boolean;
}

export const RATE_LIMIT_KEY = 'rate_limit';
export const RateLimit = (opts: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_KEY, opts);

interface Hit {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Hit>();
const MAX_BUCKETS = 50_000;

/** Best-effort client address. Trusts the first X-Forwarded-For hop, which is
 *  what the platform proxy sets; falls back to the socket address. */
function clientIp(req: Request): string {
  const fwd = (req.headers['x-forwarded-for'] as string | undefined)
    ?.split(',')[0]
    ?.trim();
  return fwd || req.ip || req.socket?.remoteAddress || 'unknown';
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const opts = this.reflector.getAllAndOverride<RateLimitOptions>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    // No @RateLimit on this handler — nothing to enforce.
    if (!opts) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const ip = clientIp(req);
    const handler = context.getHandler().name;
    const email =
      opts.byEmail && typeof req.body?.email === 'string'
        ? `:${req.body.email.toLowerCase().trim()}`
        : '';
    const key = `${handler}:${ip}${email}`;

    const now = Date.now();
    let hit = buckets.get(key);
    if (!hit || hit.resetAt <= now) {
      hit = { count: 0, resetAt: now + opts.windowMs };
      // Opportunistic cleanup so the map cannot grow without bound under a
      // spray of distinct keys.
      if (buckets.size >= MAX_BUCKETS) {
        for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
        if (buckets.size >= MAX_BUCKETS) {
          const oldest = buckets.keys().next().value;
          if (oldest !== undefined) buckets.delete(oldest);
        }
      }
      buckets.set(key, hit);
    }

    hit.count += 1;
    if (hit.count > opts.limit) {
      const retryAfter = Math.ceil((hit.resetAt - now) / 1000);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many attempts. Please wait and try again.',
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
