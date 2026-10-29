'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Bell, MessageSquare, Megaphone, Users, ArrowRight,
  CircleX, CalendarClock, UserPlus, UserMinus, Undo2, Clock, ChevronDown,
} from 'lucide-react';
import {
  notes as notesApi,
  conversations as conversationsApi,
  notifications as notifApi,
  type MyNote,
  type Conversation,
  type TurnoverUpdate,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSocket, useRefreshOnReconnect } from '@/lib/socket';
import { MessageCard } from '@/components/MessageCard';
import { useMessageStrings } from '@/i18n/messages';
import type { Locale } from '@/i18n/translations';

/**
 * Inbox & Notifications.
 *
 * Three kinds of thing arrive here and they behave differently, so they get
 * three tabs rather than one merged stream:
 *
 *   Oznámení    top-down, must be confirmed, cannot be replied to
 *   Konverzace  two-way, tied to a turnover
 *   Změny       the system reporting what happened to work I am holding
 *
 * The blue header owns the section; every other screen wears the black one.
 */

type Tab = 'announcements' | 'conversations' | 'changes';

export default function InboxPage() {
  const { user } = useAuth();
  const locale = (user?.language as Locale) ?? 'cs';
  const m = useMessageStrings(locale);

  const [tab, setTab] = useState<Tab>('announcements');
  const [notes, setNotes] = useState<MyNote[]>([]);
  const [threads, setThreads] = useState<Conversation[]>([]);
  const [updates, setUpdates] = useState<TurnoverUpdate[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [n, c, u] = await Promise.allSettled([
      notesApi.mine(),
      conversationsApi.list(),
      notifApi.turnoverUpdates(),
    ]);
    if (n.status === 'fulfilled') setNotes(n.value);
    if (c.status === 'fulfilled') setThreads(c.value);
    if (u.status === 'fulfilled') setUpdates(u.value);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useSocket({
    'note:changed': () => load(),
    'conversation:changed': () => load(),
    'event:updated': () => load(),
  });
  useRefreshOnReconnect(load);

  /**
   * Newest change at the top, oldest at the bottom.
   *
   * The API already returns them in that order; sorting here too means the
   * screen does not depend on that, and an update pushed in over the socket
   * lands where it belongs rather than wherever it was appended.
   */
  const sortedUpdates = useMemo(
    () => [...updates].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    [updates],
  );

  /**
   * Changes that were unread when she looked at Změny in this visit. They are
   * marked read on the server a moment after the tab opens (until 29 Oct 2026
   * nothing ever marked them, so the badge only grew) but stay grouped under
   * "Nové" until she leaves the screen — the group should not empty itself
   * while she is reading it.
   */
  const [seenNew, setSeenNew] = useState<Set<string>>(new Set());
  const unreadIds = useMemo(
    () => updates.filter((u) => !u.readAt).map((u) => u.id).join(','),
    [updates],
  );
  useEffect(() => {
    if (tab !== 'changes' || !unreadIds) return;
    const ids = unreadIds.split(',');
    const timer = setTimeout(async () => {
      setSeenNew((prev) => new Set(Array.from(prev).concat(ids)));
      try {
        await notifApi.markTurnoverUpdatesRead();
      } catch {
        // Older backend without the scoped endpoint: on a cleaner's account
        // "everything" is exactly what this tab shows.
        await notifApi.markAllRead().catch(() => {});
      }
      const now = new Date().toISOString();
      setUpdates((prev) => prev.map((u) => (ids.includes(u.id) ? { ...u, readAt: now } : u)));
      // The Bell badge lives in the layout and only reloads on socket events.
      window.dispatchEvent(new Event('cleanops:badges'));
    }, 1200);
    return () => clearTimeout(timer);
  }, [tab, unreadIds]);

  const newUpdates = useMemo(
    () => sortedUpdates.filter((u) => !u.readAt || seenNew.has(u.id)),
    [sortedUpdates, seenNew],
  );
  const olderByDay = useMemo(() => {
    const groups: { key: string; label: string; items: TurnoverUpdate[] }[] = [];
    for (const u of sortedUpdates) {
      if (!u.readAt || seenNew.has(u.id)) continue;
      const key = new Date(u.createdAt).toDateString();
      let g = groups.find((x) => x.key === key);
      if (!g) {
        g = { key, label: dayLabel(u.createdAt, locale, m), items: [] };
        groups.push(g);
      }
      g.items.push(u);
    }
    return groups;
  }, [sortedUpdates, seenNew, locale, m]);

  const unreadThreadList = useMemo(() => threads.filter((t) => (t.unreadCount ?? 0) > 0), [threads]);
  const readThreadList = useMemo(() => threads.filter((t) => !(t.unreadCount ?? 0)), [threads]);

  const pending = useMemo(() => notes.filter((n) => !n.acknowledged), [notes]);
  const confirmed = useMemo(() => notes.filter((n) => n.acknowledged), [notes]);
  const unreadThreads = threads.reduce((sum, t) => sum + (t.unreadCount ?? 0), 0);
  const unreadUpdates = updates.filter((u) => !u.readAt).length;

  function handleAcknowledged(id: string) {
    setNotes((prev) =>
      prev.map((n) =>
        n.id === id ? { ...n, acknowledged: true, ackedAt: new Date().toISOString() } : n,
      ),
    );
    load();
  }

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: 'announcements', label: m.inbox.tabAnnouncements, count: pending.length },
    { key: 'conversations', label: m.inbox.tabConversations, count: unreadThreads },
    { key: 'changes', label: m.inbox.tabChanges, count: unreadUpdates },
  ];

  return (
    <div className="min-h-screen bg-surface">
      <div className="bg-gradient-to-b from-[#243b6b] to-[#1b2d54] text-white px-4 pt-12">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/50">Airstay</p>
        <h1 className="text-[20px] font-bold mt-1">{m.inbox.title}</h1>

        {/* One switch, three buttons: a bigger target for a thumb than the
            underlined text tabs it replaced (29 Oct 2026). */}
        <div className="flex gap-1 mt-3.5 mb-3.5 bg-white/[0.12] rounded-xl p-[3px]">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 min-w-0 py-2 px-1 rounded-[9px] text-[12.5px] font-semibold flex items-center justify-center gap-1.5 transition ${
                tab === t.key ? 'bg-white text-[#1b2d54]' : 'text-white/75 hover:text-white'
              }`}
            >
              <span className="truncate">{t.label}</span>
              {t.count > 0 && (
                <span
                  className={`rounded-full px-1.5 py-px text-[10px] font-extrabold flex-shrink-0 ${
                    tab === t.key ? 'bg-[#243b6b] text-white' : 'bg-white/20 text-white'
                  }`}
                >
                  {t.count > 9 ? '9+' : t.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="px-3.5 py-3.5">
        {loading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-32 bg-white rounded-2xl border border-surface-border animate-pulse" />
            ))}
          </div>
        ) : tab === 'announcements' ? (
          pending.length === 0 && confirmed.length === 0 ? (
            <Empty icon={<Megaphone size={26} />} title={m.inbox.noAnnouncements} />
          ) : (
            <>
              {pending.length > 0 && <Divider label={m.inbox.toConfirm(pending.length)} first />}
              {pending.map((n) => (
                <MessageCard key={n.id} note={n} locale={locale} onAcknowledged={handleAcknowledged} />
              ))}
              {confirmed.length > 0 && (
                <Divider label={m.section.confirmedDivider} />
              )}
              {confirmed.map((n) => (
                <MessageCard key={n.id} note={n} locale={locale} onAcknowledged={handleAcknowledged} />
              ))}
            </>
          )
        ) : tab === 'conversations' ? (
          threads.length === 0 ? (
            <Empty
              icon={<MessageSquare size={26} />}
              title={m.inbox.noConversations}
              hint={m.inbox.noConversationsHint}
            />
          ) : (
            <>
              {/* Unread first: the server orders by last message, which put a
                  chat she has read above one waiting for her. */}
              {unreadThreadList.length > 0 && <Divider label={m.inbox.unreadThreads} first />}
              {unreadThreadList.map((t) => <ThreadRow key={t.id} thread={t} locale={locale} meId={user?.id} />)}
              {readThreadList.length > 0 && unreadThreadList.length > 0 && <Divider label={m.inbox.otherThreads} />}
              {readThreadList.map((t) => <ThreadRow key={t.id} thread={t} locale={locale} meId={user?.id} />)}
            </>
          )
        ) : sortedUpdates.length === 0 ? (
          <Empty icon={<Bell size={26} />} title={m.inbox.noChanges} hint={m.inbox.noChangesHint} />
        ) : (
          <>
            {newUpdates.length > 0 && <Divider label={m.inbox.groupNew} first />}
            {newUpdates.map((u) => (
              <ChangeCard key={u.id} update={u} locale={locale} unread={!u.readAt || seenNew.has(u.id)} />
            ))}
            {olderByDay.map((g, i) => (
              <div key={g.key}>
                <Divider label={g.label} first={i === 0 && newUpdates.length === 0} />
                {g.items.map((u) => (
                  <ChangeCard key={u.id} update={u} locale={locale} compact />
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

function Divider({ label, first = false }: { label: string; first?: boolean }) {
  return (
    <div className={`flex items-center gap-2.5 ${first ? 'mt-0.5' : 'mt-5'} mb-2.5 px-0.5`}>
      <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-faint">{label}</span>
      <span className="flex-1 h-px bg-surface-border" />
    </div>
  );
}

function Empty({ icon, title, hint }: { icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-10 py-20">
      <div className="w-[60px] h-[60px] rounded-full bg-[#eef2fa] text-[#243b6b] flex items-center justify-center mb-3.5">
        {icon}
      </div>
      <p className="font-semibold text-ink">{title}</p>
      {hint && <p className="text-sm text-ink-muted mt-1.5">{hint}</p>}
    </div>
  );
}

function ThreadRow({
  thread, locale, meId,
}: { thread: Conversation; locale: Locale; meId?: string }) {
  const m = useMessageStrings(locale);
  const unread = thread.unreadCount ?? 0;
  const last = thread.lastMessage;
  const preview = last
    ? last.kind === 'SYSTEM'
      ? systemText(last.body, m, locale)
      : `${last.author?.id === meId ? '' : `${firstName(last.author?.name)}: `}${
          last.body ?? (last.attachments.length ? `📷 ${m.thread.photo}` : '')
        }`
    : '';

  return (
    <Link
      href={`/conversations/${thread.id}`}
      className={`flex gap-3 bg-white border rounded-2xl p-3 mb-2.5 transition ${
        unread > 0
          ? 'border-[#c8d4ea] shadow-[0_2px_10px_rgba(36,59,107,0.08)]'
          : 'border-surface-border'
      }`}
    >
      <div
        className={`w-9 h-9 rounded-full text-white flex items-center justify-center text-[12.5px] font-bold flex-shrink-0 ${
          thread.kind === 'DIRECT' ? 'bg-ink' : 'bg-[#243b6b]'
        }`}
      >
        {initials(threadName(thread))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <h3 className="text-[13px] font-bold truncate">{threadName(thread)}</h3>
          <span className="ml-auto text-[10px] text-ink-faint flex-shrink-0">
            {thread.lastMessageAt ? shortStamp(thread.lastMessageAt, locale) : ''}
          </span>
        </div>
        <p className="text-[11.5px] text-ink-muted mt-0.5 line-clamp-2">{preview}</p>
        <div className="flex items-center gap-2 mt-1.5">
          <span className="inline-flex items-center gap-1 text-[9.5px] font-semibold text-[#243b6b] bg-[#eef2fa] rounded-full px-2 py-0.5">
            <Users size={9} />
            {m.thread.participants(thread.members?.length ?? 0)}
          </span>
        </div>
      </div>
      {unread > 0 && (
        <span className="self-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-[#243b6b] text-white text-[10.5px] font-extrabold flex items-center justify-center">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  );
}

/**
 * One change to work she holds.
 *
 * New ones are full cards. Once seen they shrink to one line (kind, unit,
 * the change, when) and open again on a tap: the list is mostly looked back
 * through, and full cards made a week of changes four screens long.
 */
function ChangeCard({
  update, locale, unread = false, compact = false,
}: { update: TurnoverUpdate; locale: Locale; unread?: boolean; compact?: boolean }) {
  const m = useMessageStrings(locale);
  const [open, setOpen] = useState(false);
  const kind = update.payload?.kind;
  const style = kindStyle(kind, m);
  const isAssignment = kind === 'ASSIGNED' || kind === 'REMOVED' || kind === 'RETURNED_TO_POOL';

  const from = formatValue(update.payload?.fromValue, locale);
  const to = formatValue(update.payload?.toValue, locale);
  const dueBy = formatValue(update.payload?.dueBy, locale);
  const cancelled = kind === 'BOOKING_CANCELLED';
  const unit = update.payload?.propertyName ?? update.title;

  const meaning =
    cancelled ? m.changes.cancelledMeaning
    : kind === 'ASSIGNED' ? m.changes.assignedMeaning
    : kind === 'REMOVED' ? m.changes.removedMeaning
    : kind === 'RETURNED_TO_POOL' ? m.changes.returnedMeaning
    : update.body;

  // Removed or back in the pool: it is not hers any more, so no link to it.
  const showLink = !!update.payload?.turnoverId && kind !== 'REMOVED' && kind !== 'RETURNED_TO_POOL';

  if (compact && !open) {
    const inline =
      isAssignment ? (dueBy ? m.changes.deadline(dueBy) : '')
      : cancelled ? m.changes.noArrival
      : kind === 'GUESTS_CHANGED' && (from || to) ? `${from} → ${to}`
      : to;
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full text-left bg-white border border-surface-border rounded-2xl px-3 py-2.5 mb-2"
      >
        <span className={`inline-flex items-center gap-1 text-[10.5px] font-bold rounded-full px-2 py-0.5 ${style.chip}`}>
          {style.icon}
          {style.label}
        </span>
        <span className="flex items-baseline gap-2 mt-1.5">
          <span className="text-[13px] font-semibold truncate">{unit}</span>
          {inline && <span className="text-[11.5px] text-ink-muted truncate">{inline}</span>}
          <span className="ml-auto text-[10.5px] text-ink-faint flex-shrink-0">{receivedStamp(update.createdAt, locale)}</span>
          <ChevronDown size={12} className="text-ink-faint flex-shrink-0 self-center" />
        </span>
      </button>
    );
  }

  return (
    <div className="bg-white border border-surface-border rounded-2xl p-3.5 mb-2.5">
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center gap-1 text-[10.5px] font-bold rounded-full px-2 py-0.5 ${style.chip}`}>
          {style.icon}
          {style.label}
        </span>
        {unread && <span className="ml-auto w-2 h-2 rounded-full bg-[#243b6b]" aria-label="new" />}
      </div>

      <h3 className="text-[14px] font-semibold mt-2">{unit}</h3>

      {isAssignment ? (
        dueBy && (
          <div className="flex items-center gap-2 mt-2 bg-surface-sunken rounded-xl px-3 py-2 text-[12px]">
            <Clock size={12} className="text-ink-faint flex-shrink-0" />
            <span className="font-semibold">{m.changes.deadline(dueBy)}</span>
          </div>
        )
      ) : (from || to || cancelled) && (
        <div className="flex items-center gap-2.5 mt-2 bg-surface-sunken rounded-xl px-3 py-2 text-[12px]">
          {from && <span className="text-ink-faint line-through">{from}</span>}
          <ArrowRight size={12} className="text-ink-faint flex-shrink-0" />
          <span className={`font-bold ${cancelled ? 'text-coral-deep' : 'text-ink'}`}>
            {cancelled ? m.changes.noArrival : to}
          </span>
        </div>
      )}

      <p className="text-[12px] text-ink-muted mt-2 leading-relaxed">{meaning}</p>

      <div className="flex items-center gap-1 mt-2.5 text-[10.5px] text-ink-faint">
        <Clock size={10} className="flex-shrink-0" />
        {m.changes.received(receivedStamp(update.createdAt, locale))}
        {showLink && (
          <Link href="/mine" className="ml-auto inline-flex items-center gap-1 text-[12px] font-bold text-[#243b6b]">
            {m.changes.openTurnover}
            <ArrowRight size={12} />
          </Link>
        )}
      </div>
    </div>
  );
}

/** Kind → label, icon and chip colour, on the office palette (redesign Oct 2026). */
function kindStyle(kind: string | undefined, m: ReturnType<typeof useMessageStrings>) {
  switch (kind) {
    case 'BOOKING_CANCELLED':
      return { chip: 'bg-coral-soft text-coral-deep', icon: <CircleX size={11} />, label: m.changes.cancelled };
    case 'STAY_EXTENDED':
      return { chip: 'bg-[#EFEAF3] text-[#5E4B75]', icon: <CalendarClock size={11} />, label: m.changes.stay };
    case 'STAY_SHORTENED':
      return { chip: 'bg-[#EFEAF3] text-[#5E4B75]', icon: <CalendarClock size={11} />, label: m.changes.stayShortened };
    case 'CHECKIN_CHANGED':
      return { chip: 'bg-[#E6EEF8] text-[#2F5DA8]', icon: <Clock size={11} />, label: m.changes.checkIn };
    case 'GUESTS_CHANGED':
      return { chip: 'bg-sand-soft text-sand-deep', icon: <Users size={11} />, label: m.changes.guests };
    case 'ASSIGNED':
      return { chip: 'bg-accent-soft text-accent', icon: <UserPlus size={11} />, label: m.changes.assigned };
    case 'REMOVED':
      return { chip: 'bg-surface-sunken text-ink-soft', icon: <UserMinus size={11} />, label: m.changes.removed };
    case 'RETURNED_TO_POOL':
      return { chip: 'bg-sand-soft text-sand-deep', icon: <Undo2 size={11} />, label: m.changes.returnedToPool };
    default:
      return { chip: 'bg-sand-soft text-sand-deep', icon: <CalendarClock size={11} />, label: m.changes.modified };
  }
}

/** "Dnes", "Včera", or the date — the day a change landed. */
function dayLabel(iso: string, locale: Locale, m: ReturnType<typeof useMessageStrings>): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return m.inbox.groupToday;
  if (d.toDateString() === yesterday.toDateString()) return m.inbox.groupYesterday;
  return d.toLocaleDateString(localeTag(locale), { weekday: 'short', day: 'numeric', month: 'numeric' });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function systemText(body: string | null | undefined, m: any, _locale: Locale): string {
  if (!body) return '';
  try {
    const data = JSON.parse(body);
    if (data.event === 'opened') return m.thread.opened(data.property ?? '');
    if (data.event === 'member_added') return m.thread.memberAdded(data.actor ?? '', data.target ?? '');
    return '';
  } catch {
    return body;
  }
}

/**
 * A turnover chat is named by the flat it is about; a direct chat by its
 * subject, or failing that by who is in it.
 */
function threadName(thread: Conversation): string {
  if (thread.kind === 'DIRECT') {
    return (
      thread.title ||
      thread.members.map((mem) => mem.user.name.split(' ')[0]).slice(0, 3).join(', ') ||
      '—'
    );
  }
  return thread.turnover?.property?.name ?? '—';
}

function initials(value: string): string {
  const parts = value.split(/[\s,]+/).filter(Boolean);
  return (parts[0]?.[0] ?? '?').toUpperCase() + (parts[1]?.[0] ?? '').toUpperCase();
}

function firstName(name?: string | null): string {
  return (name ?? '').split(' ')[0];
}

function localeTag(locale: Locale) {
  return locale === 'en' ? 'en-GB' : locale === 'cs' ? 'cs-CZ' : locale === 'ru' ? 'ru-RU' : 'uk-UA';
}

function shortStamp(iso: string, locale: Locale): string {
  const d = new Date(iso);
  const tag = localeTag(locale);
  return new Date().toDateString() === d.toDateString()
    ? d.toLocaleTimeString(tag, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(tag, { day: 'numeric', month: 'numeric' });
}

/**
 * When a change landed, in full: day, month and time.
 *
 * The card used to carry the same compact stamp as a chat row — "12:34", with
 * no way to tell 12:34 of which day. For a change to work someone is holding,
 * the day is the half that matters.
 */
function receivedStamp(iso: string, locale: Locale): string {
  const d = new Date(iso);
  const tag = localeTag(locale);
  return (
    d.toLocaleDateString(tag, { day: 'numeric', month: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString(tag, { hour: '2-digit', minute: '2-digit' })
  );
}

function formatValue(v: string | number | null | undefined, locale: Locale): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return String(v);
  const d = new Date(v);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleDateString(localeTag(locale), { day: 'numeric', month: 'numeric' }) +
      ' ' + d.toLocaleTimeString(localeTag(locale), { hour: '2-digit', minute: '2-digit' });
  }
  return String(v);
}
