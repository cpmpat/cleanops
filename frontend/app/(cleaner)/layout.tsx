'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { BottomNav } from '@/components/BottomNav';
import { notifications as notifApi, auth as authApi } from '@/lib/api';
import { translations, type Locale } from '@/i18n/translations';

export default function CleanerLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, loadFromStorage, token, setAuth } = useAuth();
  const router = useRouter();
  const [unread, setUnread] = useState(0);

  useEffect(() => { loadFromStorage(); }, []);

  useEffect(() => {
    if (!loading) {
      if (!user) { router.replace('/login'); return; }
      if (user.role === 'MANAGER') { router.replace('/dashboard'); return; }
    }
  }, [user, loading]);

  // After auth hydration, refresh the current user from /auth/me. The login
  // response may not include all profile fields (notably `preferences`), so
  // re-fetching here guarantees every cleaner page renders against the latest
  // server-side state. Runs once per hydration; we intentionally do NOT
  // depend on `user`/`token` so setAuth() inside this effect doesn't loop.
  useEffect(() => {
    if (loading || !user || !token) return;
    let cancelled = false;
    (async () => {
      try {
        const fresh = await authApi.me();
        if (!cancelled) setAuth(token, fresh);
      } catch {
        // ignore — cached user stays; AuthGuard handles real auth failures
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  useEffect(() => {
    notifApi.unreadCount().then(r => setUnread(r.count)).catch(() => {});
  }, []);

  const locale = (user?.language as Locale) ?? 'en';
  const t = translations[locale];

  if (loading || !user) {
    return <div className="min-h-screen bg-surface flex items-center justify-center"><div className="w-8 h-8 rounded-xl bg-ink animate-pulse" /></div>;
  }

  return (
    <div className="min-h-screen bg-surface pb-20 no-bounce">
      {children}
      <BottomNav t={t} unreadCount={unread} />
    </div>
  );
}
