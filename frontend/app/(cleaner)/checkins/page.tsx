'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { checkins as checkinsApi, type MyCheckIns, type CheckInPendingChange } from '@/lib/api';
import { HelpLink } from '@/components/HelpLink';
import { translations, type Locale } from '@/i18n/translations';
import { useCheckInStrings } from '@/i18n/checkins';
import { addDays, dayParts } from '@/i18n/availability';
import { useRefreshOnReconnect, useSocket } from '@/lib/socket';
import { cn } from '@/lib/utils';
import { AlertCircle, ChevronRight, ExternalLink, LogOut, UserCheck, UserMinus, Users } from 'lucide-react';

/**
 * Agent · Check-ins.
 *
 * Acknowledging is state, not an event: what needs an answer comes from the
 * server on every load (socket nudge, reconnect, focus and a 60 s poll), so a
 * phone that slept through the socket still shows it.
 */
export default function CheckInsPage() {
  const { user, logout } = useAuth();
  const locale = (user?.language as Locale) ?? 'en';
  const t = translations[locale];
  const s = useCheckInStrings(locale);

  const [data, setData] = useState<MyCheckIns | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await checkinsApi.mine());
      setError('');
    } catch (e: any) {
      setError(e?.message ?? 'Failed');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useRefreshOnReconnect(load);
  useSocket({ 'checkin:changed': () => void load() });

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 3000);
    return () => clearTimeout(id);
  }, [toast]);

  async function answer(p: CheckInPendingChange, response: 'ACK' | 'ACCEPT' | 'DECLINE') {
    setBusy(p.id);
    try {
      await checkinsApi.respond(p.id, response);
    } catch (e: any) {
      setToast(e?.status === 409 ? s.replaced : (e?.message ?? 'Failed'));
    } finally {
      setBusy(null);
      void load();
    }
  }

  const dayLabel = (day: string | null) => {
    if (!day || !data) return '';
    if (day === data.today) return s.today;
    if (day === addDays(data.today, 1)) return s.tomorrow;
    if (day < data.today) return `${s.earlier} · ${dayParts(day, locale).short}`;
    return dayParts(day, locale).short;
  };

  const byDay = useMemo(() => {
    const map = new Map<string, MyCheckIns['items']>();
    for (const i of data?.items ?? []) map.set(i.day, [...(map.get(i.day) ?? []), i]);
    return Array.from(map.entries());
  }, [data]);

  const greeting = user?.name ? `${t.greeting}, ${user.name.split(' ')[0]}` : t.greeting;

  return (
    <div className="min-h-screen bg-surface tabular-nums">
      <div className="bg-ink text-white px-4 pt-12 pb-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-white/60 text-sm font-medium">{greeting}</p>
            <h1 className="text-xl font-bold mt-0.5">{s.title}</h1>
            <p className="text-white/60 text-xs mt-1 leading-relaxed">{s.subtitle}</p>
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <button
              onClick={logout}
              className="flex items-center gap-1.5 text-white/60 hover:text-white transition text-xs py-1.5 px-2 rounded-lg hover:bg-white/10"
            >
              <LogOut size={14} />
              {t.general.logout}
            </button>
            <HelpLink locale={locale} />
          </div>
        </div>
      </div>

      <div className="px-4 py-4 space-y-3">
        {!data && !error && (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <div key={i} className="h-20 rounded-2xl bg-white border border-surface-border animate-pulse" />)}
          </div>
        )}
        {error && !data && (
          <div className="text-center py-12">
            <p className="text-sm text-red-600 mb-3">{error}</p>
            <button onClick={() => void load()} className="text-xs text-accent underline">{t.general.retry}</button>
          </div>
        )}

        {/* Changes from the desk: always first, until answered. */}
        {data && data.pending.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-amber-700 px-1 pt-1">{s.needsAnswer}</h2>
            {data.pending.map(p => {
              const gaining = p.role === 'GAINING';
              return (
                <div
                  key={p.id}
                  className={cn(
                    'rounded-2xl border p-4',
                    gaining ? 'bg-amber-50 border-amber-300' : 'bg-white border-red-200',
                  )}
                >
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide">
                    {gaining
                      ? <><UserCheck size={14} className="text-amber-700" /><span className="text-amber-800">{s.gained}</span></>
                      : <><UserMinus size={14} className="text-red-600" /><span className="text-red-700">{s.lost}</span></>}
                  </div>
                  <p className="mt-1.5 text-sm font-semibold text-ink">{p.accommodationName}</p>
                  <p className="text-xs text-ink-muted">
                    {dayLabel(p.day)} · {p.time}
                    {p.arrivalAssumed && <span className="text-amber-700"> · {s.timeNotConfirmed}</span>}
                  </p>
                  {gaining && p.override && (
                    <p className="mt-2 text-xs text-amber-900 flex gap-1.5">
                      <AlertCircle size={14} className="flex-shrink-0 mt-px" />
                      {s.overrideAsk}
                    </p>
                  )}
                  <div className="flex gap-2 mt-3">
                    {p.answers.includes('ACCEPT') && (
                      <button
                        disabled={busy === p.id}
                        onClick={() => void answer(p, 'ACCEPT')}
                        className="flex-1 py-2.5 rounded-xl bg-ink text-white text-sm font-semibold disabled:opacity-50"
                      >
                        {s.accept}
                      </button>
                    )}
                    {p.answers.includes('DECLINE') && (
                      <button
                        disabled={busy === p.id}
                        onClick={() => void answer(p, 'DECLINE')}
                        className="flex-1 py-2.5 rounded-xl border border-surface-border bg-white text-sm font-semibold text-ink-soft disabled:opacity-50"
                      >
                        {s.decline}
                      </button>
                    )}
                    {p.answers.includes('ACK') && (
                      <button
                        disabled={busy === p.id}
                        onClick={() => void answer(p, 'ACK')}
                        className="flex-1 py-2.5 rounded-xl bg-ink text-white text-sm font-semibold disabled:opacity-50"
                      >
                        {s.gotIt}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {data && data.items.length === 0 && data.pending.length === 0 && (
          <p className="text-center text-sm text-ink-faint py-12">{s.nothing}</p>
        )}

        {data && byDay.map(([day, items]) => (
          <section key={day} className="space-y-2">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-ink-muted px-1 pt-2">{dayLabel(day)}</h2>
            {items.map(i => (
              <Link key={i.id} href={`/checkins/${i.id}`} className={cn('block rounded-2xl bg-white border p-4 active:scale-[0.99] transition', i.day < (data?.today ?? '') && !i.reported ? 'border-amber-300' : 'border-surface-border')}>
                <div className="flex items-start gap-3">
                  <div className="text-center flex-shrink-0 w-14">
                    <p className={cn('text-lg font-bold', i.arrivalAssumed ? 'text-amber-700' : 'text-ink')}>{i.time}</p>
                    {i.arrivalAssumed && <p className="text-[10px] leading-tight text-amber-700">{s.timeNotConfirmed}</p>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">{i.accommodationName}</p>
                    <p className="text-xs text-ink-muted flex items-center gap-1 mt-0.5">
                      <Users size={12} />
                      {i.numAdults}{i.numChildren ? `+${i.numChildren}` : ''}
                      <span className="font-mono text-ink-faint ml-1.5">{i.bookingRef}</span>
                    </p>
                    {i.awaitingMyAnswer && (
                      <span className="inline-block mt-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 bg-amber-100 rounded-full px-2 py-0.5">
                        {s.awaiting}
                      </span>
                    )}
                    {i.day <= (data?.today ?? '') && (
                      <span className={cn(
                        'inline-block mt-1.5 ml-1 text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5',
                        i.reported ? 'text-emerald-800 bg-emerald-100' : 'text-amber-800 bg-amber-100',
                      )}>
                        {i.reported ? s.reported : s.reportMissing}
                      </span>
                    )}
                    {i.checkInLinkUrl && (
                      <span className="mt-2 flex items-center gap-1 text-xs font-semibold text-accent">
                        <ExternalLink size={12} />
                        {s.openChekin}
                      </span>
                    )}
                  </div>
                  <ChevronRight size={18} className="text-ink-faint self-center flex-shrink-0" />
                </div>
              </Link>
            ))}
          </section>
        ))}
      </div>

      {toast && (
        <div className="fixed bottom-24 left-4 right-4 z-50 bg-ink text-white text-sm rounded-xl px-4 py-3 shadow-modal text-center">
          {toast}
        </div>
      )}
    </div>
  );
}
