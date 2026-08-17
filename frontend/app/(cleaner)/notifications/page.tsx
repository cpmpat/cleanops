'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell } from 'lucide-react';
import { notes as notesApi, type MyNote } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSocket, useRefreshOnReconnect } from '@/lib/socket';
import { MessageCard } from '@/components/MessageCard';
import { useMessageStrings } from '@/i18n/messages';
import type { Locale } from '@/i18n/translations';

/**
 * Notifikace — everything the manager has sent this person.
 *
 * The blue header is what tells them where they are before they read a word;
 * every other screen in the app wears the black one.
 */
export default function NotificationsPage() {
  const { user } = useAuth();
  const locale = (user?.language as Locale) ?? 'cs';
  const m = useMessageStrings(locale);

  const [list, setList] = useState<MyNote[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setList(await notesApi.mine());
    } catch {
      // Offline — keep what is on screen rather than blanking it.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useSocket({ 'note:changed': () => load() });
  useRefreshOnReconnect(load);

  const { pending, confirmed } = useMemo(() => ({
    pending: list.filter((n) => !n.acknowledged),
    confirmed: list.filter((n) => n.acknowledged),
  }), [list]);

  /** Optimistic: the card moves down to "confirmed" before the refetch lands. */
  function handleAcknowledged(id: string) {
    setList((prev) =>
      prev.map((n) =>
        n.id === id ? { ...n, acknowledged: true, ackedAt: new Date().toISOString() } : n,
      ),
    );
    load();
  }

  return (
    <div className="min-h-screen bg-surface">
      <div className="bg-gradient-to-b from-[#243b6b] to-[#1b2d54] text-white px-4 pt-12 pb-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/50">Airstay</p>
        <h1 className="text-[22px] font-bold mt-1">{m.section.title}</h1>
        {pending.length > 0 && (
          <span className="mt-2.5 inline-flex items-center gap-2 bg-white/[0.14] rounded-full px-3 py-1.5 text-[11.5px] font-semibold">
            <span className="bg-white text-[#1b2d54] rounded-full min-w-[18px] h-[18px] px-1.5 inline-flex items-center justify-center text-[11px] font-extrabold">
              {pending.length}
            </span>
            {m.section.waiting(pending.length)}
          </span>
        )}
      </div>

      <div className="px-3.5 py-3.5">
        {loading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-40 bg-white rounded-2xl border border-surface-border animate-pulse" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center px-10 py-20">
            <div className="w-[60px] h-[60px] rounded-full bg-[#eef2fa] flex items-center justify-center mb-3.5">
              <Bell size={26} className="text-[#243b6b]" strokeWidth={1.8} />
            </div>
            <p className="font-semibold text-ink">{m.section.emptyTitle}</p>
            <p className="text-sm text-ink-muted mt-1.5">{m.section.emptyHint}</p>
          </div>
        ) : (
          <>
            {pending.map((n) => (
              <MessageCard key={n.id} note={n} locale={locale} onAcknowledged={handleAcknowledged} />
            ))}

            {confirmed.length > 0 && (
              <div className="flex items-center gap-2.5 mt-5 mb-3 px-0.5">
                <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-faint">
                  {m.section.confirmedDivider}
                </span>
                <span className="flex-1 h-px bg-surface-border" />
              </div>
            )}
            {confirmed.map((n) => (
              <MessageCard key={n.id} note={n} locale={locale} onAcknowledged={handleAcknowledged} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
