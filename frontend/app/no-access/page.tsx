'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { homeFor } from '@/lib/home';

/**
 * Where a signed-in role with no screen yet lands (RESOLUTIONS,
 * MARKETING_MANAGER). Better a plain "nothing here yet" than the cleaner app.
 */
export default function NoAccessPage() {
  const { user, loading, loadFromStorage, logout } = useAuth();
  const router = useRouter();

  useEffect(() => { loadFromStorage(); }, []);
  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace('/login'); return; }
    // A role that has gained a home since goes there.
    const home = homeFor(user.role);
    if (home !== '/no-access') router.replace(home);
  }, [user, loading]);

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <img src="/airstay-logo.svg" alt="Airstay" className="w-10 h-10 mx-auto mb-4" />
        <h1 className="text-lg font-bold text-ink">Your account has no screens yet</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Your role{user?.role ? ` (${user.role})` : ''} has not been given access to any part of the app.
          Ask your manager to set it up.
        </p>
        <button
          onClick={logout}
          className="mt-6 px-4 py-2 rounded-xl border border-surface-border text-sm font-semibold text-ink-muted hover:text-ink"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
