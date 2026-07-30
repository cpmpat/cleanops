// backend/scripts/lib/script-context.ts
//
// Shared bootstrap for the maintenance scripts.
//
// Two things matter here:
//
//  1. We boot a MINIMAL Nest module, not AppModule. AppModule pulls in
//     ScheduleModule.forRoot() and JobsModule, so importing it from a script
//     would start the 30-minute PMS sync cron inside the script process — two
//     writers on the same tenant at once.
//
//  2. Scripts run the REAL services (AvantioAdapter, BookingSyncService,
//     TurnoverSyncService, TurnoverReconcileService). Nothing about Avantio or
//     the turnover chain is reimplemented at script level; that is how the last
//     standalone script silently drifted away from production behaviour.

import { Module, INestApplicationContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { PrismaModule } from '../../src/common/prisma.module';
import { StorageModule } from '../../src/storage/storage.module';
import { AvantioAdapter } from '../../src/integrations/avantio/avantio.adapter';
import { BookingSyncService } from '../../src/integrations/booking-sync.service';
import { TurnoverSyncService } from '../../src/integrations/turnover-sync.service';
import { TurnoverReconcileService } from '../../src/integrations/turnover-reconcile.service';
import { PrismaService } from '../../src/common/prisma.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    StorageModule,
  ],
  providers: [
    AvantioAdapter,
    BookingSyncService,
    TurnoverSyncService,
    TurnoverReconcileService,
  ],
})
class ScriptsModule {}

export interface ScriptContext {
  app: INestApplicationContext;
  prisma: PrismaService;
  bookingSync: BookingSyncService;
  turnoverSync: TurnoverSyncService;
  reconcile: TurnoverReconcileService;
  close: () => Promise<void>;
}

export async function bootScriptContext(
  opts: { quiet?: boolean } = {},
): Promise<ScriptContext> {
  // Unlocks BookingSyncService.runWithoutNotifications(), which refuses to run
  // in a server process.
  process.env.CLEANOPS_SCRIPT_MODE = 'true';

  const app = await NestFactory.createApplicationContext(ScriptsModule, {
    logger: opts.quiet ? ['error'] : ['error', 'warn', 'log'],
  });

  return {
    app,
    prisma: app.get(PrismaService),
    bookingSync: app.get(BookingSyncService),
    turnoverSync: app.get(TurnoverSyncService),
    reconcile: app.get(TurnoverReconcileService),
    close: () => app.close(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Small CLI helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve `--tenant` as either a UUID or a slug, so nobody has to paste a UUID
 * from the database to run a script.
 */
export async function resolveTenant(
  prisma: PrismaService,
  tenantRef: string,
): Promise<{ id: string; name: string; slug: string }> {
  const tenant =
    (await prisma.tenant.findUnique({ where: { id: tenantRef } })) ??
    (await prisma.tenant.findUnique({ where: { slug: tenantRef } }));

  if (!tenant) {
    const all = await prisma.tenant.findMany({ select: { slug: true, name: true } });
    throw new Error(
      `No tenant matches "${tenantRef}". Known slugs: ` +
      (all.map((t) => t.slug).join(', ') || '(none)'),
    );
  }
  return { id: tenant.id, name: tenant.name, slug: tenant.slug };
}

/**
 * Parse `7d`, `36h`, `2026-07-01` or a full ISO timestamp into a Date.
 * Relative forms are resolved against now.
 */
export function parseSince(value: string): Date {
  const rel = value.match(/^(\d+)\s*([dhm])$/i);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unitMs = { d: 86_400_000, h: 3_600_000, m: 60_000 }[rel[2].toLowerCase() as 'd' | 'h' | 'm'];
    return new Date(Date.now() - n * unitMs);
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    throw new Error(`Cannot parse "${value}" as a date. Use 7d, 36h, 2026-07-01 or an ISO timestamp.`);
  }
  return d;
}

/** Split a repeatable/comma-joined CLI value into clean tokens. */
export function splitList(values: string[] | undefined): string[] {
  if (!values) return [];
  return values
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}
