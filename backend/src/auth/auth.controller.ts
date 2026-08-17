import {
  Controller, Post, Body, Res, Req, HttpCode, Get, UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { TenantRequest } from '../common/middleware/tenant.middleware';

class RequestMagicLinkDto {
  @IsEmail()
  email: string;
}

class VerifyMagicLinkDto {
  @IsString()
  token: string;
}

class SetPasswordDto {
  @IsString()
  setupToken: string;

  @IsString()
  @MinLength(8)
  password: string;
}

class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  password: string;
}

class RefreshTokenDto {
  /**
   * Optional: the browser holds the refresh token in an httpOnly cookie and
   * sends nothing in the body. Required here, the silent refresh would fail
   * validation before the cookie fallback below ever ran.
   */
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

const ACCESS_COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;  // 30 days
const REFRESH_COOKIE_MAX_AGE = 90 * 24 * 60 * 60 * 1000; // 90 days

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('magic-link')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Request a magic link for first-time setup or password reset',
  })
  async requestMagicLink(@Body() dto: RequestMagicLinkDto) {
    const result = await this.authService.requestMagicLink(dto.email);
    return {
      message: 'If an account exists for this email, a link has been sent.',
      ...(result._devToken && { _dev_token: result._devToken }),
    };
  }

  @Post('verify')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Verify a magic link token; returns a setup token for set-password',
  })
  async verifyMagicLink(@Body() dto: VerifyMagicLinkDto) {
    const result = await this.authService.verifyMagicLink(dto.token);
    return {
      setupToken: result.setupToken,
      email: result.email,
      name: result.name,
      isFirstTime: result.isFirstTime,
    };
  }

  @Post('set-password')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Set a new password using a setup token; logs the user in',
  })
  async setPassword(
    @Body() dto: SetPasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.setPassword(
      dto.setupToken,
      dto.password,
    );
    this.setSessionCookies(res, result.accessToken, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Email + password login' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.loginWithPassword(
      dto.email,
      dto.password,
    );
    this.setSessionCookies(res, result.accessToken, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Refresh access token' })
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Req() req: TenantRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = dto.refreshToken || req.cookies?.refresh_token;
    const result = await this.authService.refreshTokens(refreshToken);

    res.cookie('access_token', result.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: ACCESS_COOKIE_MAX_AGE,
      path: '/',
    });

    return { accessToken: result.accessToken };
  }

  @Post('logout')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  @ApiOperation({ summary: 'Logout and destroy session' })
  async logout(
    @Req() req: TenantRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token =
      req.cookies?.access_token ||
      req.headers.authorization?.replace('Bearer ', '');
    await this.authService.logout(req.userId!, token);

    res.clearCookie('access_token');
    res.clearCookie('refresh_token');

    return { message: 'Logged out' };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Get current authenticated user' })
  async me(@Req() req: TenantRequest) {
    return this.authService.getCurrentUser(req.userId!);
  }

  // ─── Helpers ───────────────────────────────

  private setSessionCookies(
    res: Response,
    accessToken: string,
    refreshToken: string,
  ) {
    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: ACCESS_COOKIE_MAX_AGE,
      path: '/',
    });
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: REFRESH_COOKIE_MAX_AGE,
      path: '/api/v1/auth/refresh',
    });
  }
}
