#!/usr/bin/env node
/**
 * assignment-board.js
 *
 * "Who has what assigned?" — as one self-contained HTML page.
 *
 * Answers in ten seconds what took four scripts and a dozen queries on the
 * night of 31 Jul 2026: which cleaner holds which turnover, what is sitting
 * unclaimed, and what looks wrong.
 *
 * Read-only. Plain JS, no ts-node. Writes a single HTML file with no external
 * assets, so it opens anywhere and prints cleanly.
 *
 * All times are rendered in Europe/Prague local time and labelled as such —
 * the database stores UTC, and reading UTC as local is what made a midnight
 * check-in look like it belonged to the previous day.
 *
 * Usage:
 *   railway run node scripts/assignment-board.js --tenant prague-stays
 *   railway run node scripts/assignment-board.js --tenant prague-stays --days 14
 *   railway run node scripts/assignment-board.js --tenant prague-stays \
 *     --from 2026-08-01 --to 2026-08-31 --out august.html
 *
 * Options:
 *   --tenant <id|slug>   required
 *   --days <n>           window from today, default 7
 *   --from / --to        explicit YYYY-MM-DD (overrides --days)
 *   --out <path>         default assignment-board.html
 *   --open               print the file:// URL to paste into a browser
 */

const { PrismaClient } = require('@prisma/client');
const { writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { parseArgs } = require('node:util');

const prisma = new PrismaClient();
const TZ = 'Europe/Prague';

// ── formatting ───────────────────────────────────────────────────────────────

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString('en-GB', {
    timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }) : '—';

const fmtDay = (d) =>
  d ? new Date(d).toLocaleDateString('en-GB', {
    timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short',
  }) : 'no date';

/** Day bucket key in Prague time — the same carry-forward the app uses. */
const dayKey = (t) => {
  const base = t.availableFrom ?? t.dueBy ?? t.createdAt;
  return new Date(base).toLocaleDateString('sv-SE', { timeZone: TZ }); // YYYY-MM-DD
};

// ── data ─────────────────────────────────────────────────────────────────────

async function collect(tenantId, from, to) {
  const live = {
    tenantId,
    supersededById: null,
    status: { notIn: ['CANCELLED', 'SKIPPED'] },
  };

  const inWindow = {
    ...live,
    AND: [
      { OR: [{ availableFrom: { lte: to } }, { availableFrom: null }] },
      { OR: [{ dueBy: { gte: from } }, { dueBy: null }] },
    ],
  };

  const turnovers = await prisma.turnover.findMany({
    where: inWindow,
    include: {
      property: { select: { name: true } },
      toBooking: { select: { bookingRef: true, numAdults: true, numChildren: true, channel: true } },
      fromBooking: { select: { bookingRef: true } },
      assignments: {
        where: { status: { not: 'REASSIGNED' } },
        include: { user: { select: { name: true, email: true, cdmUserId: true } } },
      },
    },
    orderBy: [{ dueBy: 'asc' }, { availableFrom: 'asc' }],
  });

  // ── anomalies ──
  const stranded = await prisma.turnoverAssignment.findMany({
    where: { turnover: { supersededById: { not: null } }, status: { not: 'REASSIGNED' } },
    include: {
      user: { select: { name: true, email: true } },
      turnover: { include: { property: { select: { name: true } } } },
    },
  });

  const inverted = turnovers.filter(
    (t) => t.availableFrom && t.dueBy && t.dueBy < t.availableFrom,
  );

  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
  const stuck = await prisma.turnover.findMany({
    where: { ...live, status: 'IN_PROGRESS', startedAt: { lt: dayAgo } },
    include: {
      property: { select: { name: true } },
      assignments: {
        where: { status: { not: 'REASSIGNED' } },
        include: { user: { select: { name: true } } },
      },
    },
    orderBy: { startedAt: 'asc' },
  });

  // Two live turnovers claiming the same arriving booking.
  const byTo = new Map();
  for (const t of await prisma.turnover.findMany({
    where: { ...live, toBookingId: { not: null } },
    select: { id: true, toBookingId: true, propertyId: true },
  })) {
    const arr = byTo.get(t.toBookingId) ?? [];
    arr.push(t);
    byTo.set(t.toBookingId, arr);
  }
  const duplicates = [...byTo.values()].filter((a) => a.length > 1);

  return { turnovers, stranded, inverted, stuck, duplicates };
}

// ── render ───────────────────────────────────────────────────────────────────

const STATUS_TONE = {
  PENDING: 'muted',
  ASSIGNED: 'info',
  IN_PROGRESS: 'warning',
  COMPLETED: 'good',
  FLAGGED: 'serious',
};

function statusChip(status) {
  return `<span class="chip chip--${STATUS_TONE[status] ?? 'muted'}">${esc(status)}</span>`;
}

function turnoverRows(list) {
  return list
    .map((t) => {
      const guests = t.toBooking
        ? `${t.toBooking.numAdults}${t.toBooking.numChildren ? ` + ${t.toBooking.numChildren}ch` : ''}`
        : '—';
      const invertedFlag =
        t.availableFrom && t.dueBy && t.dueBy < t.availableFrom
          ? ' <span class="chip chip--serious" title="Due before the unit is free">&#9888; window inverted</span>'
          : '';
      return `<tr>
        <td class="num">${esc(fmtDateTime(t.availableFrom))}</td>
        <td class="num">${esc(fmtDateTime(t.dueBy))}${invertedFlag}</td>
        <td>${esc(t.property.name)}</td>
        <td class="mono">${esc(t.toBooking?.bookingRef ?? '—')}</td>
        <td class="num">${esc(guests)}</td>
        <td>${statusChip(t.status)}${t.isOwnerStay ? ' <span class="chip chip--info">&#9819; owner</span>' : ''}</td>
      </tr>`;
    })
    .join('');
}

function cleanerSection(person, list) {
  const byDay = new Map();
  for (const t of list) {
    const k = dayKey(t);
    byDay.set(k, [...(byDay.get(k) ?? []), t]);
  }
  const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));

  return `<section class="card person">
    <header class="person__head">
      <div>
        <h3>${esc(person.name)}</h3>
        <p class="sub">${esc(person.email)}${person.cdmUserId ? ` &middot; ID ${esc(person.cdmUserId)}` : ''}</p>
      </div>
      <div class="person__count"><strong>${list.length}</strong><span>turnover${list.length === 1 ? '' : 's'}</span></div>
    </header>
    ${days
      .map(
        ([day, items]) => `<h4 class="dayhead">${esc(fmtDay(items[0].availableFrom ?? items[0].dueBy))}
          <span class="sub">${items.length}</span></h4>
        <table><thead><tr>
          <th>Free from</th><th>Due by</th><th>Unit</th><th>Booking</th><th>Guests</th><th>Status</th>
        </tr></thead><tbody>${turnoverRows(items)}</tbody></table>`,
      )
      .join('')}
  </section>`;
}

function render({ tenant, from, to, data }) {
  const { turnovers, stranded, inverted, stuck, duplicates } = data;

  // Group by assignee. A turnover with two cleaners appears under both.
  const people = new Map();
  const unassigned = [];
  for (const t of turnovers) {
    if (!t.assignments.length) { unassigned.push(t); continue; }
    for (const a of t.assignments) {
      const key = a.user.email;
      const entry = people.get(key) ?? { person: a.user, list: [] };
      entry.list.push(t);
      people.set(key, entry);
    }
  }
  const sortedPeople = [...people.values()].sort((a, b) =>
    a.person.name.localeCompare(b.person.name),
  );

  const anomalyCount =
    stranded.length + inverted.length + stuck.length + duplicates.length;

  const tile = (value, label, tone = '') =>
    `<div class="tile${tone ? ` tile--${tone}` : ''}">
      <div class="tile__value">${value}</div><div class="tile__label">${esc(label)}</div>
     </div>`;

  const anomalyBlock = anomalyCount === 0
    ? `<p class="ok">&#10003; No anomalies detected in this window.</p>`
    : `
    ${stranded.length ? `<h4 class="warn">&#9888; Stranded assignments (${stranded.length})</h4>
      <p class="sub">Assigned to a turnover that has since been retired — invisible to the cleaner, still in the database.</p>
      <table><thead><tr><th>Cleaner</th><th>Unit</th><th>Due by</th><th>Assignment status</th><th>Retired turnover</th></tr></thead><tbody>
      ${stranded.map((a) => `<tr>
        <td>${esc(a.user.name)}<div class="sub">${esc(a.user.email)}</div></td>
        <td>${esc(a.turnover.property.name)}</td>
        <td class="num">${esc(fmtDateTime(a.turnover.dueBy))}</td>
        <td>${statusChip(a.status)}</td>
        <td class="mono sub">${esc(a.turnoverId)}</td></tr>`).join('')}
      </tbody></table>` : ''}

    ${inverted.length ? `<h4 class="warn">&#9888; Inverted windows (${inverted.length})</h4>
      <p class="sub">Due before the unit is free — usually a midnight check-in in Avantio. These read as permanently overdue.</p>
      <table><thead><tr><th>Unit</th><th>Booking</th><th>Free from</th><th>Due by</th><th>Assigned to</th></tr></thead><tbody>
      ${inverted.map((t) => `<tr>
        <td>${esc(t.property.name)}</td>
        <td class="mono">${esc(t.toBooking?.bookingRef ?? '—')}</td>
        <td class="num">${esc(fmtDateTime(t.availableFrom))}</td>
        <td class="num">${esc(fmtDateTime(t.dueBy))}</td>
        <td>${esc(t.assignments.map((a) => a.user.name).join(', ') || '—')}</td></tr>`).join('')}
      </tbody></table>` : ''}

    ${stuck.length ? `<h4 class="warn">&#9888; Started over 24h ago, not finished (${stuck.length})</h4>
      <table><thead><tr><th>Unit</th><th>Started</th><th>Cleaner</th></tr></thead><tbody>
      ${stuck.map((t) => `<tr>
        <td>${esc(t.property.name)}</td>
        <td class="num">${esc(fmtDateTime(t.startedAt))}</td>
        <td>${esc(t.assignments.map((a) => a.user.name).join(', ') || '—')}</td></tr>`).join('')}
      </tbody></table>` : ''}

    ${duplicates.length ? `<h4 class="crit">&#9888; Duplicate live turnovers (${duplicates.length})</h4>
      <p class="sub">Two live turnovers claim the same arriving booking. Run the reconciler.</p>
      <table><thead><tr><th>Arriving booking</th><th>Turnover ids</th></tr></thead><tbody>
      ${duplicates.map((g) => `<tr><td class="mono sub">${esc(g[0].toBookingId)}</td>
        <td class="mono sub">${g.map((x) => esc(x.id)).join('<br>')}</td></tr>`).join('')}
      </tbody></table>` : ''}`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Assignment board — ${esc(tenant.name)}</title>
<style>
  :root{
    --plane:#f9f9f7; --surface:#fcfcfb;
    --ink:#0b0b0b; --ink-2:#52514e; --muted:#898781;
    --hair:rgba(11,11,11,0.10); --grid:#e1e0d9;
    --good:#0ca30c; --warning:#fab219; --serious:#ec835a; --critical:#d03b3b;
    --info:#2a78d6; --good-text:#006300;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--plane);color:var(--ink);
    font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;}
  .wrap{max-width:1180px;margin:0 auto;padding:32px 20px 64px}
  h1{font-size:22px;margin:0 0 4px} h2{font-size:16px;margin:32px 0 12px}
  h3{font-size:15px;margin:0} h4{font-size:13px;margin:20px 0 6px}
  .sub{color:var(--ink-2);font-size:12px;margin:0}
  .muted{color:var(--muted)}
  .card{background:var(--surface);border:1px solid var(--hair);border-radius:10px;
    padding:18px 20px;margin-bottom:16px}
  .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:20px 0 8px}
  .tile{background:var(--surface);border:1px solid var(--hair);border-radius:10px;padding:14px 16px}
  .tile--alert{border-color:var(--critical)}
  .tile__value{font-size:26px;font-weight:650;letter-spacing:-0.01em}
  .tile__label{font-size:12px;color:var(--ink-2);margin-top:2px}
  table{width:100%;border-collapse:collapse;margin:6px 0 14px;font-size:13px}
  th{text-align:left;font-weight:600;font-size:11px;letter-spacing:.04em;
    text-transform:uppercase;color:var(--muted);padding:6px 8px;border-bottom:1px solid var(--grid)}
  td{padding:7px 8px;border-bottom:1px solid var(--grid);vertical-align:top}
  tr:last-child td{border-bottom:none}
  .num{font-variant-numeric:tabular-nums;white-space:nowrap}
  .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
  .chip{display:inline-block;padding:1px 7px;border-radius:99px;font-size:11px;
    font-weight:600;border:1px solid var(--hair);white-space:nowrap}
  .chip--good{color:var(--good-text);border-color:var(--good)}
  .chip--info{color:var(--info);border-color:var(--info)}
  .chip--warning{color:#7a5200;border-color:var(--warning)}
  .chip--serious{color:#8a3d1c;border-color:var(--serious)}
  .chip--muted{color:var(--ink-2)}
  .person__head{display:flex;justify-content:space-between;align-items:flex-start;
    padding-bottom:10px;border-bottom:1px solid var(--grid);margin-bottom:4px}
  .person__count{text-align:right}
  .person__count strong{font-size:20px;display:block;line-height:1.1}
  .person__count span{font-size:11px;color:var(--ink-2)}
  .dayhead{display:flex;gap:8px;align-items:baseline;color:var(--ink);
    border-top:1px solid var(--grid);padding-top:12px}
  .dayhead:first-of-type{border-top:none}
  .warn{color:#8a3d1c} .crit{color:var(--critical)} .ok{color:var(--good-text)}
  footer{margin-top:36px;color:var(--muted);font-size:12px}
  @media print{
    body{background:#fff} .wrap{max-width:none;padding:0}
    .card{break-inside:avoid;page-break-inside:avoid;border-color:#ccc}
    .person{page-break-after:auto}
  }
</style></head><body><div class="wrap">

<h1>Assignment board — ${esc(tenant.name)}</h1>
<p class="sub">${esc(fmtDay(from))} to ${esc(fmtDay(to))} &middot; all times Europe/Prague &middot;
  generated ${esc(fmtDateTime(new Date()))}</p>

<div class="tiles">
  ${tile(sortedPeople.length, 'cleaners with work')}
  ${tile(turnovers.length - unassigned.length, 'assigned turnovers')}
  ${tile(unassigned.length, 'unclaimed in window')}
  ${tile(anomalyCount, 'anomalies', anomalyCount ? 'alert' : '')}
</div>

<h2>Needs attention</h2>
<div class="card">${anomalyBlock}</div>

<h2>By cleaner</h2>
${sortedPeople.length
  ? sortedPeople.map(({ person, list }) => cleanerSection(person, list)).join('')
  : '<div class="card"><p class="sub">Nobody has anything assigned in this window.</p></div>'}

<h2>Unclaimed (${unassigned.length})</h2>
<div class="card">
  ${unassigned.length
    ? `<table><thead><tr><th>Free from</th><th>Due by</th><th>Unit</th><th>Booking</th><th>Guests</th><th>Status</th></tr></thead>
       <tbody>${turnoverRows(unassigned)}</tbody></table>`
    : '<p class="sub">Nothing unclaimed in this window.</p>'}
</div>

<footer>
  Live turnovers only (<code>supersededById IS NULL</code>, not CANCELLED/SKIPPED), overlapping the window.
  A turnover with two cleaners is listed under both. Read-only snapshot — re-run for current state.
</footer>
</div></body></html>`;
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { values: args } = parseArgs({
    options: {
      tenant: { type: 'string' },
      days: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      out: { type: 'string', default: 'assignment-board.html' },
      open: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });

  if (!args.tenant) {
    console.error('Usage: node scripts/assignment-board.js --tenant <id|slug> [--days 7] [--from YYYY-MM-DD --to YYYY-MM-DD] [--out file.html]');
    process.exit(2);
  }

  const tenant =
    (await prisma.tenant.findUnique({ where: { id: args.tenant } })) ??
    (await prisma.tenant.findUnique({ where: { slug: args.tenant } }));
  if (!tenant) {
    const all = await prisma.tenant.findMany({ select: { slug: true } });
    console.error(`No tenant "${args.tenant}". Known: ${all.map((t) => t.slug).join(', ')}`);
    process.exit(2);
  }

  let from, to;
  if (args.from || args.to) {
    from = new Date(`${args.from ?? args.to}T00:00:00`);
    to = new Date(`${args.to ?? args.from}T23:59:59`);
  } else {
    const days = parseInt(args.days ?? '7', 10);
    from = new Date(); from.setHours(0, 0, 0, 0);
    to = new Date(from); to.setDate(from.getDate() + days);
  }

  const data = await collect(tenant.id, from, to);
  const html = render({ tenant, from, to, data });

  const outPath = resolve(args.out);
  writeFileSync(outPath, html);

  const anomalies =
    data.stranded.length + data.inverted.length + data.stuck.length + data.duplicates.length;
  console.log(
    `${tenant.name}: ${data.turnovers.length} live turnover(s) in window, ` +
    `${anomalies} anomaly/anomalies.\nWritten to ${outPath}`,
  );
  if (args.open) console.log(`file://${outPath}`);
}

// Exported so the layout can be rendered from fixtures without a database.
module.exports = { render, collect };

if (require.main === module) {
  main()
    .catch((e) => { console.error('FATAL:', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
