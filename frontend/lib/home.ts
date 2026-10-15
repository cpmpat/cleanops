/**
 * Where each role starts after signing in — by password (login page) or by
 * the emailed link (auth/verify). One function so the two cannot drift: they
 * did, and desk roles landed in the cleaners' pool.
 */
/**
 * Every role with the Newsfeed starts on it (15 Oct 2026) — the same set as
 * NEWSFEED_ROLES in backend/src/common/roles.ts, plus ADMIN.
 */
export const NEWSFEED_HOME_ROLES = [
  'MANAGER', 'ADMIN', 'FRONT_DESK_MANAGER', 'OPERATIONS_ASSISTANT', 'FRONT_DESK', 'EVIDENCE',
  'DIRECTOR', 'FINANCE', 'REVENUE_MANAGER', 'MARKETING_MANAGER', 'MARKETING_SPECIALIST',
];

export function homeFor(role?: string | null): string {
  if (role && NEWSFEED_HOME_ROLES.includes(role)) return '/newsfeed';
  if (role === 'AGENT') return '/availability';
  if (role === 'OPERATION_MANAGER' || role === 'ASSIST') return '/airchat';
  if (role === 'TERENAK') return '/datasets';
  if (role === 'REPAIRMAN') return '/my-repairs';
  if (role === 'CLEANER') return '/cleanings';
  // A role with no screen yet (RESOLUTIONS) is told so,
  // rather than dropped into the cleaner app.
  return '/no-access';
}
