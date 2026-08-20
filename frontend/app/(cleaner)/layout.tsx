'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { BottomNav } from '@/components/BottomNav';
import {
  notifications as notifApi,
  auth as authApi,
  notes as notesApi,
  conversations as conversationsApi,
  turnovers as turnoversApi,
  ensureFreshSession,
} from '@/lib/api';
import { useSocket, useRefreshOnReconnect } from '@/lib/socket';
import { NewVersionPrompt } from '@/components/NewVersionPrompt';
import { translations, type Locale } from '@/i18n/translations';

export default function CleanerLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, loadFromStorage, token, setAuth } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);
  const [unconfirmedNotes, setUnconfirmedNotes] = useState(0);
  const [todayArrivals, setTodayArrivals] = useState(0);

  useEffect(() => { loadFromStorage(); }, []);

  useEffect(() => {
    if (!loading) {
      if (!user) { router.replace('/login'); return; }
      // Managers belong in the manager app — except inside a turnover chat,
      // which is one screen both sides share. Bouncing them out of a thread
      // they were invited to would make the invitation meaningless.
      const inThread = pathname?.startsWith('/conversations');
      if ((user.role === 'MANAGER' || user.role === 'ADMIN') && !inThread) {
        router.replace('/dashboard');
        return;
      }
    }
  }, [user, loading, pathname]);

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

  // The two tab badges. Cheap count endpoints, not the full lists — this runs
  // on every cleaner screen, including the ones that show neither.
  const loadBadges = useCallback(async () => {
    // One number on the Inbox tab: things waiting for this person, whatever
    // kind they are. Splitting it across three counters would only move the
    // arithmetic into her head.
    const [notes, threads, changes] = await Promise.allSettled([
      notesApi.count(),
      conversationsApi.count(),
      notifApi.turnoverUpdatesCount(),
    ]);
    setUnconfirmedNotes(
      (notes.status === 'fulfilled' ? notes.value.count : 0) +
      (threads.status === 'fulfilled' ? threads.value.count : 0) +
      (changes.status === 'fulfilled' ? changes.value.count : 0),
    );
    turnoversApi.todayArrivalCount().then(r => setTodayArrivals(r.count)).catch(() => {});
  }, []);

  useEffect(() => { loadBadges(); }, [loadBadges]);
  useSocket({
    'note:changed': loadBadges,
    'conversation:changed': loadBadges,
    'event:updated': loadBadges,
    'event:cancelled': loadBadges,
    'event:created': loadBadges,
  });
  useRefreshOnReconnect(loadBadges);

  // These tabs stay open for weeks and the access token lives 30 days. Renew it
  // before it lapses, and again whenever the tab comes back to the foreground —
  // otherwise the first symptom is every request quietly failing with a 401.
  useEffect(() => {
    const refresh = () => { ensureFreshSession().catch(() => {}); };
    refresh();
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', refresh);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', refresh);
    };
  }, []);

  const locale = (user?.language as Locale) ?? 'en';
  const t = translations[locale];

  if (loading || !user) {
    return <div className="min-h-screen bg-surface flex items-center justify-center"><div className="w-8 h-8 rounded-xl bg-ink animate-pulse" /></div>;
  }

  return (
    <div className="min-h-screen bg-surface pb-20 no-bounce">
      {children}
      <NewVersionPrompt locale={locale} />
      <BottomNav
        t={t}
        locale={locale}
        unconfirmedNotes={unconfirmedNotes}
        todayArrivals={todayArrivals}
      />
    </div>
  );
}
