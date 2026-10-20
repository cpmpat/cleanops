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
  /** FRONT_DESK_MANAGER's modules (15 Oct 2026). */
  'OPERATIONS_ASSISTANT',
  'FRONT_DESK',
  'ASSIST',
] as const;

/** Who may open Airchat. Same set — the console is the desk's workplace. */
export const AIRCHAT_ROLES = OFFICE_ROLES;

export type OfficeRole = (typeof OFFICE_ROLES)[number];

/**
 * Who may use Planning (Check-In, Check-Out, Agents): read the list, push
 * times to the PMS, record setup requests, and assign / reassign cleaners
 * (ADMIN passes every check).
 */
export const PLANNING_ROLES = [
  'MANAGER', 'FRONT_DESK_MANAGER', 'OPERATIONS_ASSISTANT', 'FRONT_DESK',
  /** Planning + Dashboard → Cleaning (20 Oct 2026). */
  'DIRECTOR', 'MARKETING_MANAGER',
] as const;

/**
 * Who reads the turnover list (Dashboard → Cleaning, GET /turnovers) and the
 * Agents board: the desk plus the Planning roles outside it. Kept apart from
 * OFFICE_ROLES on purpose — OFFICE_ROLES also means "member of every turnover
 * chat" and "full socket broadcasts"; DIRECTOR and MARKETING_MANAGER get the
 * nudges, which is all the Dashboard and Planning need to reload.
 */
export const DESK_READ_ROLES = [...OFFICE_ROLES, 'DIRECTOR', 'MARKETING_MANAGER'] as const;

export function isOfficeRole(role?: string | null): boolean {
  return !!role && (OFFICE_ROLES as readonly string[]).includes(role);
}

/**
 * Who has Notifications → Data: the feed of changes to the CDM lists. Which
 * changes each of them sees is the notify matrix (dataset_field_notify), on
 * top of the access matrix. ADMIN passes every check.
 */
// FRONT_DESK_MANAGER, OPERATIONS_ASSISTANT and EVIDENCE lost Notifications on
// 15 Oct 2026 (they have the Newsfeed). ADMIN passes every role check anyway.
export const NOTIFY_ROLES = ['MANAGER'] as const;

/**
 * Who has the Newsfeed (7 Oct 2026). What each sees is further narrowed by the
 * access matrix: a news item about a field shows only to a role that may view
 * that field. ADMIN passes every check.
 */
export const NEWSFEED_ROLES = [
  'MANAGER', 'FRONT_DESK_MANAGER', 'OPERATIONS_ASSISTANT', 'FRONT_DESK', 'EVIDENCE', 'FINANCE', 'REVENUE_MANAGER', 'DIRECTOR',
  'MARKETING_MANAGER', 'MARKETING_SPECIALIST',
] as const;

/**
 * Tasks (16 Oct 2026).
 *
 * TASK_ROLES: who opens the board — every role of the office app, and AGENT
 * (TERENAK until 19 Oct 2026), who sees the whole board for now. Cleaners and
 * repairmen will get some level of access later; when they do,
 * TasksService.visibleWhere() is where "only tasks I am involved in" goes.
 *
 * TASK_MANAGER_ROLES: who creates, closes (Done / Won't do), reopens, edits
 * and assigns. ADMIN passes every check.
 */
export const TASK_ROLES = [
  'MANAGER', 'ADMIN', 'OPERATION_MANAGER', 'FRONT_DESK_MANAGER', 'OPERATIONS_ASSISTANT', 'FRONT_DESK', 'ASSIST',
  'EVIDENCE', 'AGENT', 'DIRECTOR', 'FINANCE', 'REVENUE_MANAGER', 'MARKETING_MANAGER', 'MARKETING_SPECIALIST',
] as const;

export const TASK_MANAGER_ROLES = ['MANAGER', 'FRONT_DESK_MANAGER', 'DIRECTOR', 'REVENUE_MANAGER'] as const;

export function isTaskManager(role?: string | null): boolean {
  return role === 'ADMIN' || (!!role && (TASK_MANAGER_ROLES as readonly string[]).includes(role));
}
