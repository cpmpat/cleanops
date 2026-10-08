'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Newspaper, Check, CheckCheck, Loader2, RefreshCw, Sheet, PencilLine, ArrowUpDown } from 'lucide-react';
import { newsfeed as api, announceNewsfeed, type NewsItem, type NewsPart } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Newsfeed: what happened in the CDM lists that people should know about —
 * a unit going offline, a unit going live on a channel. Each item is a
 * recorded change that a rule turned into a sentence (backend
 * src/newsfeed/rules.ts). Closing an item hides it for this person only.
 */

/** A plain globe: green = listed / online, red and crossed = going offline. */
function GlobeMark({ off }: { off?: boolean }) {
  const c = off ? '#E5484D' : '#30A46C';
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.7" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3 12h18M4.6 7.5h14.8M4.6 16.5h14.8" />
      {off && <path d="M4.5 19.5 19.5 4.5" strokeWidth="2" />}
    </svg>
  );
}

const RULE_ICON: Record<string, React.ReactNode> = {
  'accommodation.offboard': <GlobeMark off />,
  'accommodation.airbnbOnline': <GlobeMark />,
  'accommodation.bookingOnline': <GlobeMark />,
  'accommodation.move.pricingGroup': <ArrowUpDown size={20} strokeWidth={1.5} className="text-[#8E8E93]" />,
};

const CHANNEL: Record<'airbnb' | 'booking', { src: string; name: string }> = {
  airbnb: { src: '/brands/airbnb.png', name: 'Airbnb.com' },
  booking: { src: '/brands/booking.png', name: 'Booking.com' },
};

const MOVE: Record<'up' | 'down', { src: string; name: string }> = {
  up: { src: '/brands/up.svg', name: 'up' },
  down: { src: '/brands/down.png', name: 'down' },
};

/** The sentence: "online"/"delisted" and dates bold, channels and moves as
 *  their logo a little larger than the text (name on hover). The record's name
 *  goes where the sentence puts it (`ref`), or in front. */
function Sentence({ parts, title }: { parts: NewsPart[]; title: React.ReactNode }) {
  const placed = parts.some((p) => p.t === 'ref');
  return (
    <>
      {!placed && <>{title}{' '}</>}
      {parts.map((p, i) =>
        p.t === 'ref' ? <span key={i}>{title}</span>
        : p.t === 'move' ? (
          <img
            key={i}
            src={MOVE[p.v].src}
            alt={MOVE[p.v].name}
            title={MOVE[p.v].name}
            className="inline-block h-[1.4em] w-auto align-[-0.32em] mx-[0.15em]"
          />
        )
        : p.t === 'date' || p.t === 'strong' ? <strong key={i} className="font-semibold">{p.v}</strong>
        : p.t === 'channel' ? (
          <img
            key={i}
            src={CHANNEL[p.v].src}
            alt={CHANNEL[p.v].name}
            title={CHANNEL[p.v].name}
            className="inline-block h-[1.4em] w-[1.4em] align-[-0.32em] mx-[0.15em]"
          />
        )
        : <span key={i}>{p.v}</span>,
      )}
    </>
  );
}

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)} d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Europe/Prague', day: 'numeric', month: 'short', year: 'numeric' });
}

export default function NewsfeedPage() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [showClosed, setShowClosed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (all: boolean) => {
    setLoading(true); setError(null);
    try {
      const res = await api.list(all);
      setItems(res.items); setUnread(res.unread);
      // The menu badge shows the same number as this page, at once.
      announceNewsfeed(res.unread);
    } catch (e: any) {
      setError(e?.message ?? 'Could not load the newsfeed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(showClosed); }, [showClosed, load]);

  const close = async (id: string) => {
    // Optimistic: the item goes (or greys out) at once; a failure brings it back.
    const before = items;
    const next = Math.max(0, unread - 1);
    setItems((xs) => showClosed ? xs.map((x) => x.id === id ? { ...x, dismissed: true } : x) : xs.filter((x) => x.id !== id));
    setUnread(next);
    announceNewsfeed(next);
    try {
      await api.dismiss(id);
    } catch {
      setItems(before); setUnread(unread); announceNewsfeed(unread);
    }
  };

  const closeAll = async () => {
    await api.dismissAll();
    announceNewsfeed(0);
    load(showClosed);
  };

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
            <Newspaper size={22} className="text-ink-muted" /> Newsfeed
            {unread > 0 && (
              <span className="ml-1 min-w-[22px] h-[22px] px-1.5 rounded-full bg-[#FF3B30] text-white text-xs font-bold leading-[22px] text-center">
                {unread}
              </span>
            )}
          </h1>
          <p className="text-sm text-ink-muted mt-0.5">Updates from the CDM lists. Confirm each item with ✓ once you have read it.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-ink-muted select-none">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
            Show closed
          </label>
          {unread > 0 && (
            <button
              onClick={closeAll}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-surface-border bg-surface text-sm font-semibold text-ink-muted hover:text-ink"
            >
              <CheckCheck size={14} /> Mark all as read
            </button>
          )}
          <button
            onClick={() => load(showClosed)}
            disabled={loading}
            title="Refresh"
            className="p-2 rounded-xl border border-surface-border bg-surface text-ink-muted hover:text-ink disabled:opacity-50"
          >
            <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {error && <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {loading && items.length === 0 ? (
        <div className="py-16 text-center text-ink-muted"><Loader2 size={20} className="inline animate-spin" /></div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-surface-border bg-white py-14 text-center">
          <Newspaper size={28} className="mx-auto text-ink-faint" />
          <p className="mt-3 text-sm text-ink-muted">You are all caught up.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((n) => {
            const icon = RULE_ICON[n.rule] ?? <Newspaper size={20} strokeWidth={1.5} className="text-[#8E8E93]" />;
            return (
              <li
                key={n.id}
                className={cn(
                  'flex items-start gap-3 rounded-2xl border bg-white px-4 py-3 transition',
                  n.dismissed ? 'border-surface-border opacity-60' : 'border-surface-border shadow-sm',
                )}
              >
                <span className="mt-0.5 flex-shrink-0">{icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink leading-snug">
                    <Sentence
                      parts={n.parts ?? [{ t: 'text', v: n.text }]}
                      title={
                        <Link
                          href={`/datasets?d=${encodeURIComponent(n.ref.dataset)}&row=${encodeURIComponent(n.ref.rowId)}`}
                          className="font-semibold text-accent hover:underline"
                          title={`Open in Data → ${n.ref.list}${n.ref.key ? ` (${n.ref.key})` : ''}`}
                        >
                          {n.title}
                        </Link>
                      }
                    />
                  </p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-faint">
                    {n.source === 'import' ? <Sheet size={11} /> : <PencilLine size={11} />}
                    <span title={new Date(n.createdAt).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' })}>{ago(n.createdAt)}</span>
                    <span>·</span>
                    {n.source === 'import'
                      ? <span>from the sheet</span>
                      : <span className="text-ink-muted">{n.actorEmail ?? 'in the app'}</span>}
                  </p>
                </div>
                {!n.dismissed && (
                  <button
                    onClick={() => close(n.id)}
                    title="I've read it — confirm"
                    aria-label="I've read it — confirm"
                    className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-surface-border text-ink-faint hover:text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50 transition"
                  >
                    <Check size={14} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
