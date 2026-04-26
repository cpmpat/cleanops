/**
 * prisma/seed.ts
 *
 * Seeds the local dev database with:
 *   1. The Prague Stays tenant (if missing), including Avantio PMS
 *      credentials pulled from .env so manual syncs work after a reset.
 *   2. Patrik's admin account, flagged isSyncManaged=false so the GCP
 *      staff sync will never touch it.
 *
 * Runs automatically on `npx prisma migrate reset` and can be invoked
 * manually via `npx prisma db seed`.
 */

import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const TENANT_SLUG = 'prague-stays';
const TENANT_NAME = 'Prague Stays';

const ADMIN_EMAIL = 'cpm@airstayprague.cz';
const ADMIN_NAME = 'Patrik Neto';
const ADMIN_PASSWORD = process.env.ADMIN_SEED_PASSWORD || 'changeme';

async function main() {
  console.log('🌱 Seeding database…');

  // ─── 1. Tenant with Avantio PMS config from env ────
  const avantioBaseUrl = process.env.AVANTIO_API_BASE_URL;
  const avantioApiKey = process.env.AVANTIO_API_KEY;

  if (!avantioBaseUrl || !avantioApiKey) {
    console.warn(
      '  ⚠️  AVANTIO_API_BASE_URL or AVANTIO_API_KEY missing from .env — ' +
      'tenant will be created without PMS credentials and sync will return zeros.',
    );
  }

  const tenant = await prisma.tenant.upsert({
    where: { slug: TENANT_SLUG },
    update: {
      // Refresh Avantio config on every seed run so resets repopulate it
      pmsApiBaseUrl: avantioBaseUrl ?? null,
      pmsApiKey: avantioApiKey ?? null,
    },
    create: {
      slug: TENANT_SLUG,
      name: TENANT_NAME,
      isActive: true,
      pmsProvider: 'avantio',
      pmsSyncEnabled: true,
      pmsApiBaseUrl: avantioBaseUrl ?? null,
      pmsApiKey: avantioApiKey ?? null,
    },
  });
  console.log(`  ✓ Tenant: ${tenant.name} (${tenant.id})`);
  console.log(`    - pmsApiBaseUrl: ${tenant.pmsApiBaseUrl ? 'set' : 'MISSING'}`);
  console.log(`    - pmsApiKey:     ${tenant.pmsApiKey ? 'set' : 'MISSING'}`);

  // ─── 2. Admin user (sync-exempt) ───────────────────
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);

  const admin = await prisma.user.upsert({
    where: {
      tenantId_email: { tenantId: tenant.id, email: ADMIN_EMAIL },
    },
    update: {
      isSyncManaged: false,
      isActive: true,
      role: UserRole.MANAGER,
      name: ADMIN_NAME,
    },
    create: {
      tenantId: tenant.id,
      email: ADMIN_EMAIL,
      name: ADMIN_NAME,
      role: UserRole.MANAGER,
      isActive: true,
      isSyncManaged: false,
      passwordHash,
      emailVerifiedAt: new Date(),
      language: 'en',
    },
  });

  console.log(`  ✓ Admin user: ${admin.email}`);
  console.log(`    - id: ${admin.id}`);
  console.log(`    - role: ${admin.role}`);
  console.log(`    - isSyncManaged: ${admin.isSyncManaged}`);
  if (ADMIN_PASSWORD === 'changeme') {
    console.log(`    - password: "changeme" (override via ADMIN_SEED_PASSWORD env var)`);
  }

  console.log('✅ Seed complete.');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });