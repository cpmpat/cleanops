/**
 * Role groups.
 *
 * The first real piece of permission wiring: which roles are "the office".
 * Everything else still hangs off @Roles('MANAGER') in individual controllers
 * and will be replaced by a proper table when the scope of each role is
 * decided — this file is deliberately small so that replacement stays easy.
 */

/**
 * The desk.
 *
 * These roles are members of every turnover chat from the moment it opens,
 * may invite anyone into a thread, may start a direct chat, and may open the
 * Airchat console. A cleaner writing "to the front desk" does not know who is
 * on shift; the whole desk is in the room and whoever is free answers.
 */
export const OFFICE_ROLES = [
  'MANAGER',
  'ADMIN',
  'OPERATION_MANAGER',
  'FRONT_DESK_MANAGER',
  'FRONT_DESK',
  'ASSIST',
] as const;

/** Who may open Airchat. Same set — the console is the desk's workplace. */
export const AIRCHAT_ROLES = OFFICE_ROLES;

export type OfficeRole = (typeof OFFICE_ROLES)[number];

export function isOfficeRole(role?: string | null): boolean {
  return !!role && (OFFICE_ROLES as readonly string[]).includes(role);
}
