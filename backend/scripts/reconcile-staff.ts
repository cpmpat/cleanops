/**
 * reconcile-staff.ts
 *
 * Standalone reconciliation script for the GCP cdm_user → portal staff sync.
 * Reads a CSV export of cdm_user and reports what the sync would do, without
 * touching the database or BigQuery.
 *
 * Usage:
 *   npx ts-node scripts/reconcile-staff.ts <path-to-cdm_user.csv>
 *
 * Or, if you don't have ts-node:
 *   npx tsx scripts/reconcile-staff.ts <path-to-cdm_user.csv>
 */

import * as fs from 'fs';
import * as path from 'path';

// Must match src/staff-sync/position-mapping.ts
const POSITION_TO_ROLE: Record<string, 'MANAGER' | 'CLEANER'> = {
  'Housekeeper': 'CLEANER',
  'Front desk manager': 'MANAGER',
  'Front desk assist': 'MANAGER',
  'Housekeeping manager': 'MANAGER',
  'Operation manager': 'MANAGER',
};

interface CsvRow {
  userId: string;
  firstName: string;
  lastName: string;
  position: string;
  email1: string;
  validity: string;
}

function parseCsv(filePath: string): CsvRow[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter((l) => l.trim().length > 0);
  const header = lines[0].split(',');

  const idx = (name: string) => header.indexOf(name);
  const userIdIdx = idx('userId');
  const firstNameIdx = idx('firstName');
  const lastNameIdx = idx('lastName');
  const positionIdx = idx('position');
  const email1Idx = idx('email1');
  const validityIdx = idx('validity');

  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    // Naive CSV parse — fine for this dataset, no embedded commas in real fields
    const cols = lines[i].split(',');
    rows.push({
      userId: (cols[userIdIdx] || '').trim(),
      firstName: (cols[firstNameIdx] || '').trim(),
      lastName: (cols[lastNameIdx] || '').trim(),
      position: (cols[positionIdx] || '').trim(),
      email1: (cols[email1Idx] || '').trim().toLowerCase(),
      validity: (cols[validityIdx] || '').trim(),
    });
  }
  return rows;
}

function reconcile(rows: CsvRow[]) {
  const wouldSync: CsvRow[] = [];
  const skippedInvalid: CsvRow[] = [];
  const skippedPosition: CsvRow[] = [];
  const skippedNoEmail: CsvRow[] = [];
  const blankRows: CsvRow[] = [];
  const emailCollisions = new Map<string, CsvRow[]>();
  const positionCounts = new Map<string, number>();

  for (const row of rows) {
    if (!row.position && !row.firstName && !row.lastName) {
      blankRows.push(row);
      continue;
    }

    positionCounts.set(row.position, (positionCounts.get(row.position) || 0) + 1);

    if (row.validity !== 'Valid') {
      skippedInvalid.push(row);
      continue;
    }
    if (!POSITION_TO_ROLE[row.position]) {
      skippedPosition.push(row);
      continue;
    }
    if (!row.email1) {
      skippedNoEmail.push(row);
      continue;
    }

    wouldSync.push(row);
    const list = emailCollisions.get(row.email1) || [];
    list.push(row);
    emailCollisions.set(row.email1, list);
  }

  const collisions = Array.from(emailCollisions.entries()).filter(
    ([, list]) => list.length > 1,
  );

  console.log('\n=== STAFF SYNC RECONCILIATION REPORT ===\n');
  console.log(`Total rows in CSV:           ${rows.length}`);
  console.log(`  Blank/empty rows:          ${blankRows.length}`);
  console.log(`  Skipped (Invalid):         ${skippedInvalid.length}`);
  console.log(`  Skipped (position not in map): ${skippedPosition.length}`);
  console.log(`  Skipped (no email1):       ${skippedNoEmail.length}`);
  console.log(`  WOULD SYNC:                ${wouldSync.length}`);

  console.log('\n--- Would sync, by role ---');
  const byRole = new Map<string, number>();
  for (const r of wouldSync) {
    const role = POSITION_TO_ROLE[r.position];
    byRole.set(role, (byRole.get(role) || 0) + 1);
  }
  for (const [role, count] of byRole) {
    console.log(`  ${role}: ${count}`);
  }

  console.log('\n--- Would sync, full list ---');
  for (const r of wouldSync) {
    console.log(
      `  [${r.userId}] ${r.firstName} ${r.lastName} — ${r.position} → ${r.email1}`,
    );
  }

  if (skippedNoEmail.length > 0) {
    console.log('\n⚠️  VALID + matching position but NO EMAIL (will be unreachable):');
    for (const r of skippedNoEmail) {
      console.log(`  [${r.userId}] ${r.firstName} ${r.lastName} — ${r.position}`);
    }
  }

  if (collisions.length > 0) {
    console.log('\n⚠️  EMAIL COLLISIONS (sync will only accept the first, log error for the rest):');
    for (const [email, list] of collisions) {
      console.log(`  ${email}:`);
      for (const r of list) {
        console.log(`    - [${r.userId}] ${r.firstName} ${r.lastName} (${r.position})`);
      }
    }
  }

  console.log('\n--- All distinct positions seen in CSV (for sanity check) ---');
  const sortedPositions = Array.from(positionCounts.entries()).sort(
    (a, b) => b[1] - a[1],
  );
  for (const [pos, count] of sortedPositions) {
    const inMap = POSITION_TO_ROLE[pos] ? '✓' : ' ';
    console.log(`  [${inMap}] ${pos || '(empty)'} × ${count}`);
  }

  console.log('\n=== END REPORT ===\n');
}

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: ts-node reconcile-staff.ts <path-to-csv>');
  process.exit(1);
}
if (!fs.existsSync(csvPath)) {
  console.error(`File not found: ${path.resolve(csvPath)}`);
  process.exit(1);
}

const rows = parseCsv(csvPath);
reconcile(rows);