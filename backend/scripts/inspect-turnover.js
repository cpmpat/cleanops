#!/usr/bin/env node
/**
 * inspect-turnover.js
 *
 * Forensics for "a cleaning disappeared from someone's list".
 *
 * Give it a turnover id, a booking id, a booking ref, or a pmsBookingId and it
 * prints:
 *   1. the booking(s) it resolves to, and their Cleaning row
 *   2. the turnover itself, with every assignment (including REASSIGNED)
 *   3. the full supersession chain — backwards to the original, forwards to
 *      whatever is live now — so you can see what replaced what
 *   4. every turnover, live or retired, that references those bookings
 *   5. the property's current live chain around that date
 *   6. the audit trail for all of those turnover ids
 *
 * Read-only. Plain JS so it needs no ts-node.
 *
 * Usage (production, credentials from backend/.env.production):
 *   ./scripts/prod.sh inspect:turnover -- <turnover id | booking ref>
 *
 * Or:
 *   railway run node scripts/inspect-turnover.js <turnover id>
 *   railway run node scripts/inspect-turnover.js <booking id, e.g. a fromBookingId>
 *   railway run node scripts/inspect-turnover.js A203-HME9J22T2S
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const ASSIGNMENT_SELECT = {
  include: { user: { select: { name: true, email: true } } },
};

const iso = (d) => (d ? new Date(d).toISOString() : 'null');
const short = (id) => (id ? String(id).slice(0, 8) : 'NULL');

function printTurnover(t, label) {
  const live = t.supersededById === null;
  console.log(
    `  ${label} ${t.id}\n` +
    `      status=${t.status}${t.skipReason ? ` (${t.skipReason})` : ''}  ` +
    `${live ? 'LIVE' : `RETIRED -> ${t.supersededById}`}\n` +
    `      slot [${short(t.fromBookingId)} -> ${short(t.toBookingId)}]  ` +
    `availableFrom=${iso(t.availableFrom)}  dueBy=${iso(t.dueBy)}\n` +
    `      ownerStay=${t.isOwnerStay}  created=${iso(t.createdAt)}  updated=${iso(t.updatedAt)}`,
  );
  for (const a of t.assignments || []) {
    console.log(
      `        assignment ${a.id} -> ${a.user.email} (${a.user.name})  ` +
      `status=${a.status}  assignedAt=${iso(a.assignedAt)}  ` +
      `started=${iso(a.startedAt)}  completed=${iso(a.completedAt)}`,
    );
  }
  if (!(t.assignments || []).length) console.log('        (no assignments)');
}

async function main() {
  // pnpm forwards a literal `--`; npm strips it.
  const needle = process.argv.slice(2).filter((a) => a !== '--')[0];
  if (!needle) {
    console.error('Usage: node scripts/inspect-turnover.js <turnoverId|bookingRef|pmsBookingId>');
    process.exit(2);
  }

  console.log('='.repeat(78));
  console.log(`Inspecting: ${needle}`);
  console.log('='.repeat(78));

  // ── Resolve the starting point ──
  let turnover = await prisma.turnover.findUnique({
    where: { id: needle },
    include: { assignments: ASSIGNMENT_SELECT, property: { select: { name: true } } },
  });

  const bookings = await prisma.booking.findMany({
    // id too: a turnover's fromBookingId/toBookingId is a Booking id, and that
    // is usually what you have in hand when reading the turnovers table.
    where: { OR: [{ id: needle }, { bookingRef: needle }, { pmsBookingId: needle }] },
    include: { cleaning: { include: { assignments: ASSIGNMENT_SELECT } } },
  });

  if (!turnover && bookings.length === 0) {
    console.log('\nNothing found for that identifier.');
    return;
  }

  // ── 1. Bookings ──
  if (bookings.length) {
    console.log('\n── BOOKINGS ──────────────────────────────────────────────');
    for (const b of bookings) {
      console.log(
        `  ${b.id}\n` +
        `      ref=${b.bookingRef}  pmsId=${b.pmsBookingId}  status=${b.status}` +
        `${b.cancelledAt ? ` cancelledAt=${iso(b.cancelledAt)}` : ''}\n` +
        `      ${b.accommodationName}  propertyId=${b.propertyId}\n` +
        `      checkIn=${iso(b.checkInTime)}  checkOut=${iso(b.checkOutTime)}  ownerStay=${b.isOwnerStay}\n` +
        `      created=${iso(b.createdAt)}  updated=${iso(b.updatedAt)}`,
      );
      if (b.cleaning) {
        console.log(
          `      cleaning ${b.cleaning.id} status=${b.cleaning.status} ` +
          `timeSlot=${iso(b.cleaning.timeSlot)} ` +
          `bookingCancelledAt=${iso(b.cleaning.bookingCancelledAt)}`,
        );
        for (const a of b.cleaning.assignments) {
          console.log(`        cleaning-assignment -> ${a.user.email} status=${a.status}`);
        }
      } else {
        console.log('      (no Cleaning row)');
      }
    }
  }

  // ── 2 + 3. The turnover and its supersession chain ──
  const chainIds = new Set();

  if (!turnover && bookings.length) {
    const related = await prisma.turnover.findMany({
      where: {
        OR: [
          { fromBookingId: { in: bookings.map((b) => b.id) } },
          { toBookingId: { in: bookings.map((b) => b.id) } },
        ],
      },
      include: { assignments: ASSIGNMENT_SELECT, property: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    turnover = related.find((t) => t.supersededById === null) || related[0];
  }

  if (turnover) {
    console.log(`\n── SUPERSESSION CHAIN (${turnover.property?.name ?? ''}) ─────────────`);

    // Walk backwards to the origin. A row can have SEVERAL predecessors:
    // supersede() retires the row it copies, and enforceUniqueActive() also
    // points every other active row sharing a booking at the new one. Follow
    // all of them, or a healthy row retired that way never shows up here.
    const backwards = [];
    const guard = new Set();
    let level = [turnover];
    while (level.length) {
      const nextLevel = [];
      for (const row of level) {
        if (guard.has(row.id)) continue;
        guard.add(row.id);
        backwards.unshift(row);
        const preds = await prisma.turnover.findMany({
          where: { supersededById: row.id },
          include: { assignments: ASSIGNMENT_SELECT },
          orderBy: { createdAt: 'desc' },
        });
        if (preds.length > 1) {
          console.log(
            `  note: ${short(row.id)} replaced ${preds.length} rows at once: ` +
            preds.map((p) => `${short(p.id)}(${p.status})`).join(', '),
          );
        }
        nextLevel.push(...preds);
      }
      level = nextLevel;
    }
    backwards.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    let cursor;

    // Walk forwards to whatever is live.
    const forwards = [];
    cursor = turnover;
    guard.clear();
    guard.add(turnover.id);
    while (cursor && cursor.supersededById) {
      if (guard.has(cursor.supersededById)) { console.log('  !! cycle detected, stopping'); break; }
      guard.add(cursor.supersededById);
      cursor = await prisma.turnover.findUnique({
        where: { id: cursor.supersededById },
        include: { assignments: ASSIGNMENT_SELECT },
      });
      if (cursor) forwards.push(cursor);
    }

    const chain = [...backwards, ...forwards];
    chain.forEach((t, i) => {
      chainIds.add(t.id);
      const marker = t.id === turnover.id ? '>>' : `${i + 1}.`;
      printTurnover(t, marker);
    });

    const head = chain[chain.length - 1];
    console.log(
      `\n  Chain head: ${head.id} — ${head.supersededById === null ? 'LIVE' : 'still retired (!)'}` +
      `, ${(head.assignments || []).length} assignment(s)`,
    );
  }

  // ── 4. Everything referencing these bookings ──
  if (bookings.length) {
    console.log('\n── ALL TURNOVERS REFERENCING THESE BOOKINGS ──────────────');
    const all = await prisma.turnover.findMany({
      where: {
        OR: [
          { fromBookingId: { in: bookings.map((b) => b.id) } },
          { toBookingId: { in: bookings.map((b) => b.id) } },
        ],
      },
      include: { assignments: ASSIGNMENT_SELECT },
      orderBy: { createdAt: 'asc' },
    });
    if (!all.length) console.log('  (none)');
    all.forEach((t) => { chainIds.add(t.id); printTurnover(t, '  -'); });
  }

  // ── 4b. Every booking any version of this turnover pointed at ──
  const chainRows = await prisma.turnover.findMany({ where: { id: { in: [...chainIds] } } });
  const chainBookingIds = [
    ...new Set(chainRows.flatMap((t) => [t.fromBookingId, t.toBookingId]).filter(Boolean)),
  ];
  for (const b of bookings) chainBookingIds.includes(b.id) || chainBookingIds.push(b.id);
  if (chainBookingIds.length) {
    console.log('\n── BOOKINGS ANY VERSION POINTED AT ───────────────────────');
    const bs = await prisma.booking.findMany({
      where: { id: { in: chainBookingIds } },
      orderBy: { checkInTime: 'asc' },
    });
    for (const b of bs) {
      console.log(
        `  ${short(b.id)} ${b.bookingRef}  ${b.status}${b.cancelledAt ? ` cancelledAt=${iso(b.cancelledAt)}` : ''}  ` +
        `in=${iso(b.checkInTime)} out=${iso(b.checkOutTime)}  created=${iso(b.createdAt)} updated=${iso(b.updatedAt)}`,
      );
    }
  }

  // ── 5. The property's live chain nearby ──
  const propertyId = turnover?.propertyId || bookings[0]?.propertyId;
  const anchor =
    turnover?.dueBy || turnover?.availableFrom || bookings[0]?.checkInTime || new Date();
  if (propertyId) {
    const from = new Date(new Date(anchor).getTime() - 14 * 864e5);
    const to = new Date(new Date(anchor).getTime() + 14 * 864e5);
    console.log(
      `\n── LIVE CHAIN AT THIS PROPERTY, ${iso(from).slice(0, 10)} .. ${iso(to).slice(0, 10)} ──`,
    );
    const live = await prisma.turnover.findMany({
      where: {
        propertyId,
        supersededById: null,
        OR: [
          { dueBy: { gte: from, lte: to } },
          { availableFrom: { gte: from, lte: to } },
        ],
      },
      include: { assignments: ASSIGNMENT_SELECT },
      orderBy: [{ dueBy: 'asc' }],
    });
    if (!live.length) console.log('  (none)');
    live.forEach((t) => printTurnover(t, '  *'));

    // Every booking at the unit in the window, cancelled ones included: an
    // extra or since-cancelled booking between two guests is what makes the
    // reconcile see a different neighbour than the chain.
    console.log(`\n── ALL BOOKINGS AT THIS PROPERTY, ${iso(from).slice(0, 10)} .. ${iso(to).slice(0, 10)} ──`);
    const around = await prisma.booking.findMany({
      where: {
        propertyId,
        OR: [
          { checkInTime: { gte: from, lte: to } },
          { checkOutTime: { gte: from, lte: to } },
        ],
      },
      orderBy: [{ checkInTime: 'asc' }, { id: 'asc' }],
    });
    if (!around.length) console.log('  (none)');
    for (const b of around) {
      console.log(
        `  ${short(b.id)} ${String(b.bookingRef).padEnd(20)} ${b.status.padEnd(9)} ` +
        `in=${iso(b.checkInTime)} out=${iso(b.checkOutTime)}  ` +
        `created=${iso(b.createdAt)}${b.cancelledAt ? ` cancelledAt=${iso(b.cancelledAt)}` : ''}`,
      );
    }
  }

  // ── 6. Audit trail ──
  if (chainIds.size) {
    console.log('\n── AUDIT EVENTS ──────────────────────────────────────────');
    const events = await prisma.auditEvent.findMany({
      where: {
        OR: [
          { targetType: 'Turnover', targetId: { in: [...chainIds] } },
          { targetType: 'Booking', targetId: { in: chainBookingIds } },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!events.length) console.log('  (none — nothing the audit trail covers touched these rows)');
    for (const e of events) {
      console.log(
        `  ${iso(e.createdAt)}  ${e.action}  by ${e.actorEmail || e.actorId || 'system'}\n` +
        `      target=${e.targetId}  ${JSON.stringify(e.metadata)}`,
      );
    }
  }

  console.log('\nDone.');
}

main()
  .catch((e) => { console.error('FATAL:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
