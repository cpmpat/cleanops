import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend;
  private readonly from: string;
  private readonly frontendUrl: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    if (!apiKey) {
      this.logger.warn(
        'RESEND_API_KEY not set — email sending will fail at runtime',
      );
    }
    this.resend = new Resend(apiKey);
    this.from =
      this.config.get<string>('RESEND_FROM_EMAIL') ||
      'Airstay Portal <onboarding@resend.dev>';
    this.frontendUrl =
      this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000';
  }

  async sendMagicLink(opts: {
    to: string;
    name: string;
    token: string;
    isFirstTime: boolean;
  }): Promise<void> {
    const verifyUrl = `${this.frontendUrl}/auth/verify?token=${opts.token}`;
    const subject = opts.isFirstTime
      ? 'Set up your Airstay Portal account'
      : 'Reset your Airstay Portal password';

    const intro = opts.isFirstTime
      ? 'Welcome to the Airstay Portal! Click the button below to verify your email and set your password.'
      : 'You requested a password reset for the Airstay Portal. Click the button below to set a new password.';

    const html = `
      <!DOCTYPE html>
      <html>
        <head><meta charset="utf-8"><title>${subject}</title></head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: #f5f5f5; padding: 32px; margin: 0;">
          <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
            <h1 style="color: #111; font-size: 22px; margin: 0 0 16px;">Hi ${opts.name},</h1>
            <p style="color: #444; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">${intro}</p>
            <div style="text-align: center; margin: 32px 0;">
              <a href="${verifyUrl}"
                 style="display: inline-block; background: #111; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 15px;">
                ${opts.isFirstTime ? 'Set up account' : 'Reset password'}
              </a>
            </div>
            <p style="color: #888; font-size: 13px; line-height: 1.6; margin: 24px 0 0;">
              This link expires in 15 minutes. If you didn't request this, you can safely ignore this email.
            </p>
            <p style="color: #aaa; font-size: 12px; margin: 24px 0 0; word-break: break-all;">
              Or copy this link: ${verifyUrl}
            </p>
          </div>
          <p style="text-align: center; color: #aaa; font-size: 12px; margin-top: 24px;">
            Airstay Portal — Prague Stays
          </p>
        </body>
      </html>
    `;

    try {
      const result = await this.resend.emails.send({
        from: this.from,
        to: opts.to,
        subject,
        html,
      });
      this.logger.log(`Magic link email sent to ${opts.to} (id: ${result.data?.id})`);
    } catch (err) {
      this.logger.error(`Failed to send magic link to ${opts.to}`, err);
      throw err;
    }
  }
}
