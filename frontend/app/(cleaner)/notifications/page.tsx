'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Bell, MessageSquare, Megaphone, Users, Building2, ArrowRight,
  CircleX, CalendarClock, UserPlus,
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
      <div className="bg-gradient-to-b from-[#243b6b] to-[#1b2d54] text-white px-4 pt-12 pb-0">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/50">Airstay</p>
        <h1 className="text-[20px] font-bold mt-1">{m.inbox.title}</h1>

        <div className="flex gap-5 mt-3.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`pb-2.5 text-[12.5px] font-semibold flex items-center gap-1.5 border-b-2 transition ${
                tab === t.key
                  ? 'text-white border-white'
                  : 'text-white/60 border-transparent hover:text-white/80'
              }`}
            >
              {t.label}
              {t.count > 0 && (
                <span
                  className={`rounded-full px-1.5 py-px text-[10px] font-extrabold ${
                    tab === t.key ? 'bg-white text-[#1b2d54]' : 'bg-white/20 text-white'
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
            threads.map((t) => <ThreadRow key={t.id} thread={t} locale={locale} meId={user?.id} />)
          )
        ) : updates.length === 0 ? (
          <Empty icon={<Bell size={26} />} title={m.inbox.noChanges} hint={m.inbox.noChangesHint} />
        ) : (
          updates.map((u) => <ChangeCard key={u.id} update={u} locale={locale} />)
        )}
      </div>
    </div>
  );
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2.5 mt-5 mb-3 px-0.5">
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
      <div className="w-9 h-9 rounded-full bg-[#243b6b] text-white flex items-center justify-center text-[12.5px] font-bold flex-shrink-0">
        {initials(thread.turnover?.property?.name ?? '?')}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <h3 className="text-[13px] font-bold truncate">
            {thread.turnover?.property?.name ?? '—'}
          </h3>
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

function ChangeCard({ update, locale }: { update: TurnoverUpdate; locale: Locale }) {
  const m = useMessageStrings(locale);
  const kind = update.payload?.kind;

  const style =
    kind === 'BOOKING_CANCELLED'
      ? { rail: 'border-l-red-600', tone: 'text-red-700', icon: <CircleX size={11} />, label: m.changes.cancelled }
      : kind === 'STAY_EXTENDED'
      ? { rail: 'border-l-violet-500', tone: 'text-violet-700', icon: <CalendarClock size={11} />, label: m.changes.stay }
      : kind === 'STAY_SHORTENED'
      ? { rail: 'border-l-violet-500', tone: 'text-violet-700', icon: <CalendarClock size={11} />, label: m.changes.stayShortened }
      : kind === 'CHECKIN_CHANGED'
      ? { rail: 'border-l-sky-500', tone: 'text-sky-700', icon: <CalendarClock size={11} />, label: m.changes.checkIn }
      : kind === 'GUESTS_CHANGED'
      ? { rail: 'border-l-amber-400', tone: 'text-amber-700', icon: <UserPlus size={11} />, label: m.changes.guests }
      : { rail: 'border-l-amber-400', tone: 'text-amber-700', icon: <UserPlus size={11} />, label: m.changes.modified };

  const from = formatValue(update.payload?.fromValue, locale);
  const to = formatValue(update.payload?.toValue, locale);

  return (
    <div className={`bg-white border border-surface-border border-l-4 ${style.rail} rounded-2xl p-3.5 mb-2.5`}>
      <div className={`flex items-center gap-1.5 text-[9.5px] font-extrabold uppercase tracking-[0.09em] ${style.tone}`}>
        {style.icon}
        {style.label}
        <span className="ml-auto text-[10px] font-semibold text-ink-faint tracking-normal normal-case">
          {shortStamp(update.createdAt, locale)}
        </span>
      </div>

      <h3 className="text-[13.5px] font-semibold mt-1.5">
        {update.payload?.propertyName ?? update.title}
      </h3>

      {(from || to) && (
        <div className="flex items-center gap-2.5 mt-2 bg-surface-sunken rounded-xl px-3 py-2 text-[12px]">
          {from && <span className="text-ink-faint line-through">{from}</span>}
          <ArrowRight size={12} className="text-ink-faint flex-shrink-0" />
          <span className={`font-bold ${kind === 'BOOKING_CANCELLED' ? 'text-red-700' : 'text-ink'}`}>
            {to || m.changes.cancelled}
          </span>
        </div>
      )}

      <p className="text-[11.5px] text-ink-muted mt-2 leading-relaxed">
        {kind === 'BOOKING_CANCELLED' ? m.changes.cancelledMeaning : update.body}
      </p>

      {update.payload?.turnoverId && (
        <Link href="/mine" className="inline-flex items-center gap-1 text-[11.5px] font-bold text-[#243b6b] mt-2.5">
          {m.changes.openTurnover}
          <ArrowRight size={12} />
        </Link>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function systemText(body: string | null | undefined, m: any, _locale: Locale): string {
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
