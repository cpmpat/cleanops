/**
 * Where each role starts after signing in — by password (login page) or by
 * the emailed link (auth/verify). One function so the two cannot drift: they
 * did, and desk roles landed in the cleaners' pool.
 */
export function homeFor(role?: string | null): string {
  if (role === 'ADMIN' || role === 'FRONT_DESK_MANAGER' || role === 'FRONT_DESK') return '/planning';
  if (role === 'MANAGER') return '/dashboard';
  if (role === 'AGENT') return '/availability';
  if (role === 'OPERATION_MANAGER' || role === 'ASSIST') return '/airchat';
  if (role === 'DIRECTOR' || role === 'FINANCE' || role === 'REVENUE_MANAGER' || role === 'MARKETING_MANAGER') return '/newsfeed';
  if (role === 'EVIDENCE' || role === 'TERENAK') return '/datasets';
  if (role === 'REPAIRMAN') return '/my-repairs';
  if (role === 'CLEANER') return '/cleanings';
  // A role with no screen yet (RESOLUTIONS) is told so,
  // rather than dropped into the cleaner app.
  return '/no-access';
}
