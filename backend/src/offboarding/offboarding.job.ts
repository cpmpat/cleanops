import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OffboardingService } from './offboarding.service';

/** Catches deactivations made outside the app (e.g. straight in the database). */
@Injectable()
export class OffboardingJob {
  private readonly log = new Logger(OffboardingJob.name);
  constructor(private readonly offboarding: OffboardingService) {}

  @Cron('3,13,23,33,43,53 * * * *', { timeZone: 'Europe/Prague' })
  async run() {
    try {
      const done = await this.offboarding.sweep();
      if (done.length) this.log.log(`Offboarding sweep released work of ${done.length} inactive user(s)`);
    } catch (e: any) {
      this.log.error(`Offboarding sweep failed: ${e?.message ?? e}`);
    }
  }
}
