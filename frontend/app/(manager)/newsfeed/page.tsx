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
 * / other). 21 Oct 2026: the All / Went live / Went offline / Closed switch is
 * gone; beside the list a pick list of the types of change seen in the last
 * three months (the feed's whole window, NEWSFEED_DAYS) filters it.
 */

type Kind = 'live' | 'off' | 'other';

/** What each rule (backend src/newsfeed/rules.ts) is called in the pick list. */
const RULE_LABEL: Record<string, string> = {
  'accommodation.airbnbOnline': 'Went live on Airbnb',
  'accommodation.bookingOnline': 'Went live on Booking.com',
  'accommodation.offboard': 'Going offline (delisted)',
  'accommodation.move.pricingGroup': 'Pricing group changed',
};
const ruleLabel = (rule: string) =>
  RULE_LABEL[rule] ?? rule.split('.').pop()!.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

/** The info mark from the supplied artwork (outline speech bubble with an "i"), redrawn as a flat glyph. */
function InfoBubble({ size = 34, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className={className}>
      <path
        d="M12 2.5 A8.5 8.5 0 1 1 7.9 18.45 L3.9 20.1 A.55 .55 0 0 1 3.2 19.4 L4.8 15.5 A8.5 8.5 0 0 1 12 2.5 Z"
        fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"
      />
      <circle cx="12.75" cy="7.2" r="1.3" fill="currentColor" />
      <path d="M10.5 10.3 H12.5 L11.35 15.4 Q11.15 16.45 12.15 16.15 L13.3 15.7"
        fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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
  // Types picked in the pick list; empty = every type.
  const [types, setTypes] = useState<string[]>([]);
  const [showClosed, setShowClosed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Always the whole window (closed included): the pick list counts what
  // happened in the last three months, read or not.
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await api.list(true);
      setItems(res.items); setUnread(res.unread);
      // The menu badge shows the same number as this page, at once.
      announceNewsfeed(res.unread);
    } catch (e: any) {
      setError(e?.message ?? 'Could not load the newsfeed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const close = async (id: string) => {
    // Optimistic: the item goes (or greys out) at once; a failure brings it back.
    const before = items;
    const next = Math.max(0, unread - 1);
    setItems((xs) => xs.map((x) => x.id === id ? { ...x, dismissed: true } : x));
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
    load();
  };

  // The pick list: every type of change in the window, with how many (read or not).
  const typeOptions = useMemo(() => {
    const c = new Map<string, number>();
    for (const n of items) c.set(n.rule, (c.get(n.rule) ?? 0) + 1);
    return Array.from(c.entries())
      .map(([rule, n]) => ({ rule, n, label: ruleLabel(rule) }))
      .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  }, [items]);
  const toggleType = (rule: string) =>
    setTypes((ts) => ts.includes(rule) ? ts.filter((t) => t !== rule) : [...ts, rule]);

  const groups = useMemo(() => {
    const shown = items.filter((n) =>
      (showClosed || !n.dismissed) && (types.length === 0 || types.includes(n.rule)),
    );
    const out: Array<{ day: string; items: NewsItem[] }> = [];
    for (const n of shown) {
      const d = pragueDay(n.createdAt);
      const last = out[out.length - 1];
      if (last && last.day === d) last.items.push(n); else out.push({ day: d, items: [n] });
    }
    return out;
  }, [items, showClosed, types]);
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
          {unread > 0 && (
            <button
              onClick={closeAll}
              className="h-9 flex items-center gap-1.5 px-3 rounded-[10px] border border-surface-border bg-white text-[13px] font-semibold text-ink-soft hover:text-ink"
            >
              <CheckCheck size={14} /> Mark all as read
            </button>
          )}
          <button
            onClick={() => load()}
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
              <p className="mt-3 text-sm text-ink-muted">{types.length ? 'Nothing of the picked types to show.' : 'You are all caught up.'}</p>
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
            <button type="button" onClick={() => setShowClosed((v) => !v)} className="font-semibold text-accent hover:text-accent-hover flex items-center gap-0.5">
              {showClosed ? 'Hide closed' : 'Show closed'} <ChevronRight size={12} />
            </button>
          </div>
        </section>

        <aside className="flex-[1_1_280px] flex flex-col gap-3">
          {/* Pick list: the types of change seen in the last three months; picking narrows the list. */}
          <section className="bg-white border border-surface-border rounded-2xl px-3 py-3 flex flex-col gap-1">
            <div className="flex items-center justify-between px-1 pb-1">
              <h2 className="text-[10px] font-semibold tracking-[0.08em] uppercase text-ink-muted">Type of change · last 3 months</h2>
              {types.length > 0 && (
                <button type="button" onClick={() => setTypes([])} className="text-[11.5px] font-semibold text-accent hover:text-accent-hover">Clear</button>
              )}
            </div>
            {typeOptions.length === 0 && <p className="px-1 py-1 text-[13px] text-ink-muted">No changes in the last 3 months.</p>}
            {typeOptions.map((o) => {
              const on = types.includes(o.rule);
              const k = kindOf(o.rule);
              return (
                <button
                  key={o.rule}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => toggleType(o.rule)}
                  className={cn('flex items-center gap-2.5 rounded-xl px-1.5 py-1.5 text-left transition',
                    on ? 'bg-accent-soft' : 'hover:bg-surface')}
                >
                  <span className={cn('w-4 h-4 rounded border flex items-center justify-center flex-shrink-0',
                    on ? 'bg-accent border-accent text-white' : 'border-surface-border bg-white')}>
                    {on && <Check size={11} />}
                  </span>
                  <span className={cn('w-6 h-6 rounded-[7px] flex items-center justify-center flex-shrink-0 [&>svg]:w-3.5 [&>svg]:h-3.5', TILE[k].cls)}>
                    {TILE[k].icon}
                  </span>
                  <span className={cn('flex-1 min-w-0 text-[13px]', on ? 'text-ink font-semibold' : 'text-ink-soft')}>{o.label}</span>
                  <span className="text-[12px] font-semibold text-ink tabular-nums">{o.n}</span>
                </button>
              );
            })}
          </section>
          {/* Where the news comes from — no heading. The info mark sits in the top-right
              corner, three quarters of it above the text; text and button share the left edge. */}
          <section className="relative bg-white border border-surface-border rounded-2xl px-4 pt-[38px] pb-3.5 flex flex-col items-start gap-3">
            <InfoBubble size={34} className="absolute top-3 right-4 text-accent" />
            <p className="text-[13px] text-ink-soft leading-relaxed">
              {/* Keeps the first line clear of the icon's lower quarter. */}
              <span aria-hidden className="float-right w-[38px] h-[10px]" />
              These updates come from our Accommodation table. Whenever something important changes there, it
              appears here. Click a unit&apos;s name to see all its details.
            </p>
            <Link href="/datasets?d=accommodation" className="rounded-[9px] bg-[#F3F0E9] px-3 py-1.5 text-[13px] font-semibold text-accent hover:bg-surface-sunken">
              Data › CDM › Accommodation
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
