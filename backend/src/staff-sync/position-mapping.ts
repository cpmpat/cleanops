import { UserRole } from '@prisma/client';

/**
 * Maps GCP cdm_user.position → portal UserRole.
 * Positions not in this map are ignored entirely (not synced).
 *
 * Must stay in sync with scripts/reconcile-staff.ts.
 */
export const POSITION_TO_ROLE: Record<string, UserRole> = {
  'Housekeeper': UserRole.CLEANER,
  'Front desk manager': UserRole.MANAGER,
  'Front desk assist': UserRole.MANAGER,
  'Housekeeping manager': UserRole.MANAGER,
  'Operation manager': UserRole.MANAGER,
};

export const SYNCED_POSITIONS = Object.keys(POSITION_TO_ROLE);

export function resolveRole(position: string): UserRole | null {
  return POSITION_TO_ROLE[position] ?? null;
}
