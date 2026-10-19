'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Newspaper, Check, CheckCheck, Loader2, RefreshCw, Sheet, PencilLine, ArrowUp, ArrowDown, ArrowUpDown, ChevronRight } from 'lucide-react';
import { newsfeed as api, announceNewsfeed, type NewsItem, type NewsPart } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Newsfeed: what happened in the CDM lists that people should know about —
 * a unit going offline, a unit going live on a channel. Each item is a
 * recorded change that a rule turned into a sentence (backend
 * src/newsfeed/rules.ts). Closing an item hides it for this person only.
 *
 * Oct 2026 redesign: one card grouped by day, a tile per kind (live / offline
 * / other), filters for the kinds, and a side column with the counts.
 */

type Kind = 'live' | 'off' | 'other';
type Show = 'all' | Kind | 'closed';

function kindOf(rule: string): Kind {
  if (rule.includes('offboard')) return 'off';
  if (rule.endsWith('Online')) return 'live';
  return 'other';
}

const TILE: Record<Kind, { cls: string; icon: React.ReactNode }> = {
  live: { cls: 'bg-accent-soft text-accent', icon: <ArrowUp size={16} strokeWidth={2.4} /> },
  off: { cls: 'bg-coral-soft text-coral-deep', icon: <ArrowDown size={16} strokeWidth={2.4} /> },
  other: { cls: 'bg-sand-soft text-sand-deep', icon: <ArrowUpDown size={15} strokeWidth={2.2} /> },
};

const CHANNEL: Record<'airbnb' | 'booking', { src: string; name: string }> = {
  airbnb: { src: '/brands/airbnb.png', name: 'Airbnb.com' },
  booking: { src: '/brands/booking.png', name: 'Booking.com' },
};

/**
 * The logos are lettering with an arrow: UP's arrow rises above the letters,
 * DOWN's falls below them. Each is sized so its letters match the text's
 * capitals and sit on the baseline, and the arrow hangs into the line gap
 * through a negative margin, so the line is no taller than its neighbours.
 */
const MOVE: Record<'up' | 'down', { src: string; name: string; cls: string }> = {
  up: { src: '/brands/up.svg', name: 'up', cls: 'h-[1.45em] -mt-[0.75em] align-baseline' },
  down: { src: '/brands/down.png', name: 'down', cls: 'h-[1.25em] -mb-[0.53em] align-baseline' },
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
            className={cn('inline-block w-auto mx-[0.15em]', MOVE[p.v].cls)}
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
        : <span key={i} className="text-ink-soft">{p.v}</span>,
      )}
    </>
  );
}

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)} d`;
  return new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Europe/Prague', day: 'numeric', month: 'short' });
}

const pragueDay = (d: string | Date) => new Date(d).toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' });

function dayLabel(day: string): string {
  const today = pragueDay(new Date());
  const yesterday = pragueDay(new Date(Date.now() - 86_400_000));
  if (day === today) return 'Today';
  if (day === yesterday) return 'Yesterday';
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function NewsfeedPage() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [show, setShow] = useState<Show>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const showClosed = show === 'closed';

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

  // Counts are over the open items, whatever the filter shows.
  const counts = useMemo(() => {
    const c: Record<Kind, number> = { live: 0, off: 0, other: 0 };
    for (const n of items) if (!n.dismissed) c[kindOf(n.rule)]++;
    return c;
  }, [items]);
  const openTotal = counts.live + counts.off + counts.other;

  const groups = useMemo(() => {
    const shown = items.filter((n) =>
      show === 'closed' ? true : show === 'all' ? true : kindOf(n.rule) === show,
    );
    const out: Array<{ day: string; items: NewsItem[] }> = [];
    for (const n of shown) {
      const d = pragueDay(n.createdAt);
      const last = out[out.length - 1];
      if (last && last.day === d) last.items.push(n); else out.push({ day: d, items: [n] });
    }
    return out;
  }, [items, show]);

  const tabs: Array<[Show, string]> = [['all', 'All'], ['live', 'Went live'], ['off', 'Went offline'], ['closed', 'Closed']];
  const today = pragueDay(new Date());

  return (
    <div className="p-6 max-w-[1280px] flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-ink flex items-center gap-2.5">
            Newsfeed
            {unread > 0 && (
              <span className="rounded-full bg-coral text-white text-xs font-bold px-2.5 py-0.5 tabular-nums">{unread} new</span>
            )}
          </h1>
          <p className="text-sm text-ink-muted">Changes in the accommodation list that people should know about. Confirm each with ✓ once read.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div role="group" aria-label="Show" className="flex gap-1 bg-white border border-surface-border rounded-[10px] p-[3px]">
            {tabs.map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setShow(k)}
                className={cn('rounded-lg px-3 py-1.5 text-[13px] transition',
                  show === k ? 'bg-accent text-white font-semibold' : 'text-ink-soft hover:bg-surface-sunken')}
              >
                {label}
              </button>
            ))}
          </div>
          {unread > 0 && (
            <button
              onClick={closeAll}
              className="h-9 flex items-center gap-1.5 px-3 rounded-[10px] border border-surface-border bg-white text-[13px] font-semibold text-ink-soft hover:text-ink"
            >
              <CheckCheck size={14} /> Mark all as read
            </button>
          )}
          <button
            onClick={() => load(showClosed)}
            disabled={loading}
            title="Refresh"
            aria-label="Refresh"
            className="h-9 w-9 flex items-center justify-center rounded-[10px] border border-surface-border bg-white text-ink-muted hover:text-ink disabled:opacity-50"
          >
            <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {error && <p className="rounded-xl bg-coral-soft px-4 py-3 text-sm text-coral-deep">{error}</p>}

      <div className="flex flex-wrap gap-3.5 items-start">
        <section className="flex-[999_1_520px] min-w-0 bg-white border border-surface-border rounded-2xl flex flex-col overflow-hidden">
          {loading && items.length === 0 ? (
            <div className="py-16 text-center text-ink-muted"><Loader2 size={20} className="inline animate-spin" /></div>
          ) : groups.length === 0 ? (
            <div className="py-14 text-center">
              <Newspaper size={28} className="mx-auto text-ink-faint" />
              <p className="mt-3 text-sm text-ink-muted">You are all caught up.</p>
            </div>
          ) : groups.map((g) => (
            <div key={g.day}>
              <h2 className="px-4 pt-3 pb-2 text-[10px] font-semibold tracking-[0.08em] uppercase text-ink-muted border-b border-[#EFEAE0]">
                {dayLabel(g.day)}
              </h2>
              <ul>
                {g.items.map((n) => {
                  const k = kindOf(n.rule);
                  return (
                    <li
                      key={n.id}
                      className={cn(
                        'flex items-center gap-3 px-4 py-3 border-b border-[#F3EFE7] transition',
                        n.dismissed ? 'opacity-55' : g.day === today && 'bg-[#FBFAF6]',
                      )}
                    >
                      <span className={cn('w-[34px] h-[34px] rounded-[10px] flex items-center justify-center flex-shrink-0', TILE[k].cls)}>
                        {TILE[k].icon}
                      </span>
                      <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                        <p className="text-[13.5px] text-ink leading-snug">
                          <Sentence
                            parts={n.parts ?? [{ t: 'text', v: n.text }]}
                            title={
                              <Link
                                href={`/datasets?d=${encodeURIComponent(n.ref.dataset)}&row=${encodeURIComponent(n.ref.rowId)}`}
                                className="font-semibold text-ink hover:text-accent hover:underline"
                                title={`Open in Data → ${n.ref.list}${n.ref.key ? ` (${n.ref.key})` : ''}`}
                              >
                                {n.title}
                              </Link>
                            }
                          />
                        </p>
                        <p className="flex items-center gap-1.5 text-[11.5px] text-ink-muted">
                          {n.source === 'import' ? <Sheet size={11} /> : <PencilLine size={11} />}
                          <span>{n.ref.list}</span>
                          <span>·</span>
                          {n.source === 'import' ? <span>from the sheet</span> : <span>{n.actorEmail ?? 'in the app'}</span>}
                        </p>
                      </div>
                      <span
                        className="w-14 text-right font-mono text-[11.5px] text-ink-muted flex-shrink-0"
                        title={new Date(n.createdAt).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' })}
                      >
                        {ago(n.createdAt)}
                      </span>
                      {n.dismissed ? <span className="w-7 flex-shrink-0" /> : (
                        <button
                          onClick={() => close(n.id)}
                          title="I've read it — confirm"
                          aria-label="I've read it — confirm"
                          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-ink-faint hover:text-accent hover:bg-accent-soft transition"
                        >
                          <Check size={15} />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <div className="px-4 py-3 flex justify-between items-center text-[11.5px] text-ink-muted">
            <span>Confirming an item hides it only for you.</span>
            {!showClosed && (
              <button type="button" onClick={() => setShow('closed')} className="font-semibold text-accent hover:text-accent-hover flex items-center gap-0.5">
                Show closed <ChevronRight size={12} />
              </button>
            )}
          </div>
        </section>

        <aside className="flex-[1_1_280px] flex flex-col gap-3">
          <section className="bg-white border border-surface-border rounded-2xl px-4 py-3.5 flex flex-col gap-2.5">
            <h2 className="text-[10px] font-semibold tracking-[0.08em] uppercase text-ink-muted">In this feed</h2>
            {([
              ['live', 'Went live on a channel', 'bg-accent'],
              ['off', 'Went offline', 'bg-coral'],
              ['other', 'Other changes', 'bg-sand'],
            ] as const).map(([k, label, fill]) => (
              <button key={k} type="button" onClick={() => setShow(show === k ? 'all' : k)} className="flex flex-col gap-1.5 text-left group">
                <span className="flex justify-between w-full text-[13px]">
                  <span className="flex items-center gap-2 text-ink-soft group-hover:text-ink">
                    <span className={cn('w-2 h-2 rounded-sm', fill)} />{label}
                  </span>
                  <strong className="font-semibold text-ink tabular-nums">{counts[k]}</strong>
                </span>
                <span className="h-1.5 w-full bg-surface-sunken rounded-full overflow-hidden">
                  <span className={cn('block h-full', fill)} style={{ width: `${openTotal ? (counts[k] / openTotal) * 100 : 0}%` }} />
                </span>
              </button>
            ))}
          </section>
          <section className="bg-white border border-surface-border rounded-2xl px-4 py-3.5 flex flex-col gap-2">
            <h2 className="text-[10px] font-semibold tracking-[0.08em] uppercase text-ink-muted">Where it comes from</h2>
            <p className="text-[13px] text-ink-soft leading-relaxed">
              Each item is a recorded change in Data → Accommodation, turned into a sentence. Click a unit to open its record.
            </p>
            <Link href="/datasets" className="self-start rounded-[9px] bg-[#F3F0E9] px-3 py-1.5 text-[13px] font-semibold text-accent hover:bg-surface-sunken">
              Open Data ›
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
