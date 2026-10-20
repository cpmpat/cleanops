import type { PrismaService } from './prisma.service';

/**
 * Areas (20 Oct 2026). A unit's area is derived from its Avantio name, a
 * person's is set on their user row. A person with an area sees only units of
 * that area; without one, every area.
 */

/** "Za Poříčskou bránou 14, unit F2 - Praha 8" → "Praha"; "… - Karlovy Vary" → "Karlovy Vary"; no " - " → null. */
export function areaFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  const cut = name.lastIndexOf(' - ');
  if (cut < 0) return null;
  const tail = name.slice(cut + 3).trim().replace(/\s*\d+$/, '').trim();
  return tail || null;
}

/** The caller's area, or null for "every area". */
export async function areaOf(prisma: PrismaService, tenantId: string, userId?: string | null): Promise<string | null> {
  if (!userId) return null;
  const u = await prisma.user.findFirst({ where: { id: userId, tenantId }, select: { area: true } as any }) as any;
  return u?.area ?? null;
}

/** Prisma fragment for a booking / turnover: its property is in the area. Empty when no area. */
export const propertyInArea = (area: string | null): Record<string, unknown> =>
  area ? { property: { area } } : {};
