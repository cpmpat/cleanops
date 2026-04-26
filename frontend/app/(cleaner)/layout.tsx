'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { BottomNav } from '@/components/BottomNav';
import { notifications as notifApi } from '@/lib/api';
import { translations, type Locale } from '@/i18n/translations';

export default function CleanerLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, loadFromStorage } = useAuth();
  const router = useRouter();
  const [unread, setUnread] = useState(0);

  useEffect(() => { loadFromStorage(); }, []);

  useEffect(() => {
    if (!loading) {
      if (!user) { router.replace('/login'); return; }
      if (user.role === 'MANAGER') { router.replace('/dashboard'); return; }
    }
  }, [user, loading]);

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
