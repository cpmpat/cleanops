import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma.service';
import { EmailService } from './email.service';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';

const SETUP_TOKEN_PURPOSE = 'password_setup';
const SETUP_TOKEN_EXPIRY = '15m';
const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private email: EmailService,
  ) {}

  /**
   * Step 1: User requests a magic link via email.
   * Used for first-time setup AND password reset — both flows are identical
   * up to the point where the user lands on the set-password screen.
   */
  async requestMagicLink(email: string): Promise<{ sent: boolean; _devToken?: string }> {
    const normalizedEmail = email.toLowerCase().trim();

    const user = await this.prisma.user.findFirst({
      where: { email: normalizedEmail, isActive: true },
    });

    if (!user) {
      // Don't reveal whether the email exists — just claim success.
      // Real users will check their inbox; attackers learn nothing.
      return { sent: true };
    }

    const token = randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 15 * 60 * 1000); // 15 min

    await this.prisma.user.update({
      where: { id: user.id },
      data: { magicLinkToken: token, magicLinkExpiry: expiry },
    });

    const isFirstTime = !user.passwordHash;

    await this.email.sendMagicLink({
      to: user.email,
      name: user.name,
      token,
      isFirstTime,
    });

    const isDev = process.env.NODE_ENV !== 'production';
    return {
      sent: true,
      ...(isDev && { _devToken: token }),
    };
  }

  /**
   * Step 2: User clicks magic link.
   *
   * Does NOT log the user in — instead returns a short-lived setup token
   * that the frontend uses to call set-password. This is true for both
   * first-time setup and password reset flows.
   */
  async verifyMagicLink(token: string): Promise<{
    setupToken: string;
    email: string;
    name: string;
    isFirstTime: boolean;
  }> {
    const user = await this.prisma.user.findFirst({
      where: { magicLinkToken: token, isActive: true },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid magic link');
    }
    if (!user.magicLinkExpiry || user.magicLinkExpiry < new Date()) {
      throw new UnauthorizedException('Magic link has expired');
    }

    const isFirstTime = !user.passwordHash;

    // Mark email as verified, clear the magic link
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        magicLinkToken: null,
        magicLinkExpiry: null,
      },
    });

    // Issue a short-lived setup token (15 min) — different purpose claim
    // from a regular session JWT, so it can't be used as one
    const setupToken = this.jwt.sign(
      { sub: user.id, purpose: SETUP_TOKEN_PURPOSE },
      { expiresIn: SETUP_TOKEN_EXPIRY },
    );

    return {
      setupToken,
      email: user.email,
      name: user.name,
      isFirstTime,
    };
  }

  /**
   * Step 3: User submits a new password using the setup token from verify.
   * On success, hashes the password and issues a real session JWT.
   */
  async setPassword(
    setupToken: string,
    newPassword: string,
  ): Promise<{ accessToken: string; refreshToken: string; user: any }> {
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }

    let payload: any;
    try {
      payload = this.jwt.verify(setupToken);
    } catch {
      throw new UnauthorizedException('Setup token is invalid or expired');
    }
    if (payload.purpose !== SETUP_TOKEN_PURPOSE) {
      throw new UnauthorizedException('Wrong token type');
    }

    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, isActive: true },
      include: { tenant: true },
    });
    if (!user) {
      throw new UnauthorizedException('User not found or disabled');
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        lastLoginAt: new Date(),
      },
    });

    return this.issueSession(user);
  }

  /**
   * Email + password login. Primary login path for users who already
   * have a passwordHash set.
   */
  async loginWithPassword(
    email: string,
    password: string,
  ): Promise<{ accessToken: string; refreshToken: string; user: any }> {
    const normalizedEmail = email.toLowerCase().trim();

    const user = await this.prisma.user.findFirst({
      where: { email: normalizedEmail, isActive: true },
      include: { tenant: true },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!user.passwordHash) {
      throw new UnauthorizedException(
        'No password set for this account. Use the magic link to set one up.',
      );
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.issueSession(user);
  }

  /**
   * Refresh an expired access token using a valid refresh token.
   */
  async refreshTokens(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    try {
      const payload = this.jwt.verify(refreshToken);
      const session = await this.prisma.session.findFirst({
        where: { refreshToken, userId: payload.sub },
      });
      if (!session) throw new UnauthorizedException('Session not found');

      // Re-check the user is still active (covers sync-disable mid-session)
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });
      if (!user || !user.isActive) {
        throw new UnauthorizedException('Account is inactive');
      }

      const newPayload = {
        sub: payload.sub,
        tenantId: payload.tenantId,
        role: payload.role,
        email: payload.email,
      };
      const newAccessToken = this.jwt.sign(newPayload, { expiresIn: '30d' });
      const newRefreshToken = this.jwt.sign(newPayload, { expiresIn: '90d' });

      await this.prisma.session.update({
        where: { id: session.id },
        data: {
          token: newAccessToken,
          refreshToken: newRefreshToken,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      return { accessToken: newAccessToken, refreshToken: newRefreshToken };
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(userId: string, token: string): Promise<void> {
    await this.prisma.session.deleteMany({
      where: { userId, token },
    });
  }

  async getCurrentUser(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        language: true,
        tenantId: true,
        preferences: true,
        tenant: { select: { name: true, slug: true, settings: true } },
      },
    });
  }

  // ─── Internal helpers ───────────────────────────

  private async issueSession(user: any): Promise<{
    accessToken: string;
    refreshToken: string;
    user: any;
  }> {
    const payload = {
      sub: user.id,
      tenantId: user.tenantId,
      role: user.role,
      email: user.email,
    };
    const accessToken = this.jwt.sign(payload, { expiresIn: '30d' });
    const refreshToken = this.jwt.sign(payload, { expiresIn: '90d' });

    await this.prisma.session.create({
      data: {
        userId: user.id,
        token: accessToken,
        refreshToken,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        language: user.language,
        tenantId: user.tenantId,
        tenantName: user.tenant?.name,
        preferences: user.preferences,
      },
    };
  }
}