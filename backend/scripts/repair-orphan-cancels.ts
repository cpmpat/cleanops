#!/usr/bin/env ts-node
/**
 * repair-orphan-cancels.ts
 *
 * Finds turnovers that are still cancelled only because an old reconcile
 * orphan-cancel was copied onto them, and tags them so the fixed code can
 * bring them back.
 *
 * THE BUG THIS REPAIRS
 *   `reconcile:turnovers --apply` cancels a live turnover that matches no slot
 *   ("orphan"). The row stayed in the chain, so when a booking's times changed
 *   later, TurnoverSyncService.supersede() moved it forward and copied
 *   status CANCELLED and cancelledAt onto the new version. The bookings were
 *   pointing at a real cleaning, but every version was born cancelled and the
 *   cleaner pool never showed it. Example: the turnover due Mon 5 Oct 2026
 *   carried the cancelledAt of the 25 Sep reconcile run.
 *
 * HOW A ROW IS RECOGNISED
 *   Start from every audit event 'turnover.orphan_cancelled' (its targetId is
 *   the row the reconcile cancelled), then follow supersededById forward. Each
 *   version that is CANCELLED, has no skipReason, and carries the SAME
 *   cancelledAt as the original was copied, not cancelled again. A manager's
 *   cancel writes a new cancelledAt, so it never matches.
 *
 * WHAT IT WRITES (only with --apply)
 *   skipReason = 'ORPHAN_RECONCILE' on those copied rows (and the original),
 *   plus one audit event 'turnover.orphan_cancel_tagged' per chain.
 *   Nothing turns live here. After tagging, run the reconcile: it revives the
 *   tagged rows whose slot the bookings justify, using the same slot rules as
 *   always, and leaves real orphans cancelled. The script prints that command.
 *
 * DRY RUN IS THE DEFAULT.
 *
 * Usage:
 *   ./scripts/prod.sh repair:orphan-cancels -- --tenant prague-stays
 *   ./scripts/prod.sh repair:orphan-cancels -- --tenant prague-stays --apply
 *
 * Exit codes: 0 success · 1 apply failed · 2 bad usage
 */

import { parseArgs } from 'node:util';
import { bootScriptContext, resolveTenant, fmtDuration } from './lib/script-context';
import { ORPHAN_CANCEL_REASON } from '../src/integrations/turnover-sync.service';
import { todayInAppZone, timeInAppZone } from '../src/common/time';

type Chain = {
  originId: string;
  tipId: string;
  propertyId: string;
  property: string;
  pmsPropertyId: string | null;
  fromRef: string | null;
  toRef: string | null;
  when: Date | null; // carry-forward date: availableFrom ?? dueBy
  dueBy: Date | null;
  rowsToTag: string[];
  state: 'CARRIED' | 'NEVER_MOVED' | 'MOVED_ON' | 'ALREADY_TAGGED';
  note?: string;
};

const fmt = (d: Date | null) => (d ? `${todayInAppZone(d)} ${timeInAppZone(d)}` : '—');

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--') argv.shift();
  const { values } = parseArgs({
    args: argv,
    options: {
      tenant: { type: 'string' },
      apply: { type: 'boolean', default: false },
    },
  });
  if (!values.tenant) {
    console.error('Missing --tenant <id|slug>');
    process.exit(2);
  }

  const started = Date.now();
  const ctx = await bootScriptContext({ quiet: true });
  try {
    const prisma = ctx.prisma;
    const tenant = await resolveTenant(prisma, values.tenant);
    console.log(`\nTenant: ${tenant.name} (${tenant.slug})`);
    console.log(values.apply ? 'Mode:   APPLY — tagging rows' : 'Mode:   DRY RUN — nothing will be written');

    const events = await prisma.auditEvent.findMany({
      where: { tenantId: tenant.id, action: 'turnover.orphan_cancelled', targetType: 'Turnover' },
      select: { targetId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    const originIds = [...new Set(events.map((e) => e.targetId).filter((x): x is string => !!x))];
    console.log(`\nOrphan-cancel audit events: ${events.length} (${originIds.length} turnovers)`);

    const chains: Chain[] = [];
    for (const originId of originIds) {
      const origin = await prisma.turnover.findUnique({ where: { id: originId } });
      if (!origin || origin.status !== 'CANCELLED' || !origin.cancelledAt) continue;

      const rowsToTag: string[] = [];
      let cur = origin;
      let state: Chain['state'] = 'NEVER_MOVED';
      let note: string | undefined;
      const seen = new Set<string>();
      while (true) {
        if (seen.has(cur.id)) { note = 'supersession cycle'; break; }
        seen.add(cur.id);
        const copied =
          cur.status === 'CANCELLED' &&
          cur.cancelledAt?.getTime() === origin.cancelledAt.getTime();
        if (!copied) {
          state = 'MOVED_ON';
          note = `chain continued into ${cur.id} (${cur.status}${cur.skipReason ? `, ${cur.skipReason}` : ''})`;
          break;
        }
        if (cur.skipReason === null) rowsToTag.push(cur.id);
        else if (cur.skipReason !== ORPHAN_CANCEL_REASON) {
          state = 'MOVED_ON';
          note = `row ${cur.id} has skipReason ${cur.skipReason}`;
          break;
        }
        if (!cur.supersededById) {
          if (cur.id !== origin.id) state = 'CARRIED';
          break;
        }
        const next = await prisma.turnover.findUnique({ where: { id: cur.supersededById } });
        if (!next) { note = `missing successor ${cur.supersededById}`; break; }
        cur = next;
      }
      if (state !== 'MOVED_ON' && rowsToTag.length === 0) state = 'ALREADY_TAGGED';

      const [property, from, to] = await Promise.all([
        prisma.property.findUnique({ where: { id: cur.propertyId }, select: { name: true, pmsPropertyId: true } }),
        cur.fromBookingId ? prisma.booking.findUnique({ where: { id: cur.fromBookingId }, select: { bookingRef: true } }) : null,
        cur.toBookingId ? prisma.booking.findUnique({ where: { id: cur.toBookingId }, select: { bookingRef: true } }) : null,
      ]);

      chains.push({
        originId,
        tipId: cur.id,
        propertyId: cur.propertyId,
        property: property?.name ?? cur.propertyId,
        pmsPropertyId: property?.pmsPropertyId ?? null,
        fromRef: from?.bookingRef ?? null,
        toRef: to?.bookingRef ?? null,
        when: cur.availableFrom ?? cur.dueBy,
        dueBy: cur.dueBy,
        rowsToTag: state === 'MOVED_ON' ? [] : rowsToTag,
        state,
        note,
      });
    }

    const now = new Date();
    // No dates at all means no bookings: a real orphan, nothing to revive.
    const upcoming = (c: Chain) => { const d = c.dueBy ?? c.when; return d !== null && d >= now; };
    const groups: [string, Chain[]][] = [
      ['CARRIED — bookings moved this row on, but it stayed cancelled (the bug)', chains.filter((c) => c.state === 'CARRIED')],
      ['NEVER MOVED — still the original orphan; the reconcile decides', chains.filter((c) => c.state === 'NEVER_MOVED')],
      ['MOVED ON — chain already live again or retired; nothing to do', chains.filter((c) => c.state === 'MOVED_ON')],
      ['ALREADY TAGGED', chains.filter((c) => c.state === 'ALREADY_TAGGED')],
    ];
    for (const [title, rows] of groups) {
      if (!rows.length) continue;
      console.log(`\n─ ${title}: ${rows.length} ─`);
      for (const c of rows) {
        const pair = `${c.fromRef ?? '(none)'} → ${c.toRef ?? '(none)'}`;
        const flag = upcoming(c) ? 'UPCOMING' : 'past    ';
        console.log(
          `  ${flag} ${c.property.slice(0, 28).padEnd(30)} ${pair.padEnd(34)} ` +
          `from ${fmt(c.when)} due ${fmt(c.dueBy)}  tip ${c.tipId}` +
          (c.note ? `  (${c.note})` : ''),
        );
      }
    }

    const toTag = chains.filter((c) => c.rowsToTag.length > 0);
    const rowCount = toTag.reduce((n, c) => n + c.rowsToTag.length, 0);
    console.log(`\nRows to tag ${ORPHAN_CANCEL_REASON}: ${rowCount} across ${toTag.length} chain(s)`);

    let failed = false;
    if (values.apply && toTag.length) {
      try {
        await prisma.$transaction(async (tx) => {
          for (const c of toTag) {
            await tx.turnover.updateMany({
              where: { id: { in: c.rowsToTag }, status: 'CANCELLED', skipReason: null },
              data: { skipReason: ORPHAN_CANCEL_REASON },
            });
            await tx.auditEvent.create({
              data: {
                tenantId: tenant.id,
                category: 'SYSTEM',
                action: 'turnover.orphan_cancel_tagged',
                actorId: null,
                actorEmail: 'repair-orphan-cancels@cleanops',
                targetType: 'Turnover',
                targetId: c.tipId,
                metadata: { originId: c.originId, rows: c.rowsToTag, state: c.state },
              },
            });
          }
        });
        console.log('Tagged.');
      } catch (err) {
        failed = true;
        console.error(`Apply failed, nothing written: ${(err as Error).message}`);
      }
    } else if (toTag.length) {
      console.log('Dry run — nothing written. Re-run with --apply to tag.');
    }

    const props = [...new Set(toTag.filter(upcoming).map((c) => c.pmsPropertyId ?? c.propertyId))];
    if (props.length) {
      console.log(
        `\nNext, let the reconcile revive the upcoming ones (dry run first, then add --apply):\n` +
        `  ./scripts/prod.sh reconcile:turnovers -- --tenant ${tenant.slug} --since 1d --property ${props.join(',')}`,
      );
    }

    console.log(`\nDone in ${fmtDuration(Date.now() - started)}.\n`);
    process.exit(failed ? 1 : 0);
  } finally {
    await ctx.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
