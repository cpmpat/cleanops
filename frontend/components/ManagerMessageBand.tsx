'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Mail, MessageSquareWarning } from 'lucide-react';
import { notes as notesApi, type ActiveNote } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSocket, useRefreshOnReconnect } from '@/lib/socket';
import { useMessageStrings } from '@/i18n/messages';
import type { Locale } from '@/i18n/translations';

/**
 * "Zpráva od manažera" — the confirmation band above the cleaning list.
 *
 * Shape is deliberately nothing like a cleaning card: full-bleed, square
 * corners, dark blue, white text, sitting flush under the black header. A
 * cleaner glancing at the screen must not confuse a team message with work.
 *
 * Delivery is state-based. The socket event only says "re-read"; the same read
 * happens on tab focus, on the network coming back and on a slow interval,
 * because these tabs stay open for days and miss frames.
 */

const LONG_BODY = 220;
const READ_DELAY_MS = 1200;

export function ManagerMessageBand({ locale }: { locale: Locale }) {
  const { user } = useAuth();
  const m = useMessageStrings(locale);

  const [queue, setQueue] = useState<ActiveNote[]>([]);
  const [total, setTotal] = useState(0);
  const [acking, setAcking] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [readyAt, setReadyAt] = useState<number>(() => Date.now() + READ_DELAY_MS);
  const [now, setNow] = useState(() => Date.now());
  const [overrideLocale, setOverrideLocale] = useState<Locale | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await notesApi.active();
      setQueue(list);
      setTotal((prev) => (list.length > prev ? list.length : prev || list.length));
      if (list.length === 0) setTotal(0);
    } catch {
      // Offline or a dead token — keep whatever is on screen, try again later.
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useSocket({ 'note:changed': () => load() });
  useRefreshOnReconnect(load);

  const note = queue[0];

  // Reset the "has had time to read it" gate whenever a new message surfaces.
  useEffect(() => {
    setExpanded(false);
    setOverrideLocale(null);
    setReadyAt(Date.now() + READ_DELAY_MS);
  }, [note?.id, note?.version]);

  useEffect(() => {
    if (!note) return;
    const timer = setInterval(() => setNow(Date.now()), 300);
    return () => clearInterval(timer);
  }, [note?.id]);

  const shownLocale = (overrideLocale ?? note?.localeShown ?? 'cs') as Locale;
  const body = useMemo(() => {
    if (!note) return '';
    return note.bodies[shownLocale] ?? note.body;
  }, [note, shownLocale]);

  const isLong = body.length > LONG_BODY;
  const hadTimeToRead = now >= readyAt;
  const canAck = hadTimeToRead && (!isLong || expanded);

  if (!note) return null;

  async function handleAck() {
    if (!note) return;
    setAcking(true);
    try {
      await notesApi.ack(note.id, shownLocale);
      setQueue((q) => q.slice(1));
    } catch {
      // Leave it on screen — an unconfirmed message must not disappear silently.
    } finally {
      setAcking(false);
    }
  }

  // Contact the author, not a hardcoded person. Their number lives on the user
  // record; without one we fall back to e-mail rather than a dead button.
  const phone = note.author.mobileNumber?.replace(/[^\d]/g, '');
  const prefill =
    `Airstay · ${user?.name ?? ''}\n` +
    `„${note.title}" (${new Date(note.createdAt).toLocaleDateString('cs-CZ', {
      day: 'numeric', month: 'numeric',
    })})\n`;
  const contactHref = phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(prefill)}`
    : `mailto:${note.author.email}?subject=${encodeURIComponent(note.title)}`;

  const otherLocales = note.availableLocales.filter((l) => l !== shownLocale);

  return (
    <div className="bg-gradient-to-b from-[#243b6b] to-[#1b2d54] text-white px-4 pt-4 pb-4">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.11em] text-white/60">
        <Mail size={12} strokeWidth={2.2} />
        {m.kicker}
        {total > 1 && (
          <span className="ml-auto bg-white/15 rounded-full px-2 py-0.5 tracking-normal">
            {m.counter(total - queue.length + 1, total)}
          </span>
        )}
      </div>

      <div className="flex gap-3 mt-3">
        <div className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center font-bold text-sm flex-shrink-0">
          {initials(note.author.name || note.author.email)}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold text-[15.5px] leading-snug">{note.title}</h2>
          <p className="text-[11px] text-white/55 mt-0.5 truncate">
            {note.author.email} · {formatSent(note.createdAt, locale)}
          </p>

          <p
            className={`text-[13.5px] leading-relaxed text-white/90 mt-2 whitespace-pre-line ${
              isLong && !expanded ? 'line-clamp-3' : ''
            }`}
          >
            {body}
          </p>

          {isLong && !expanded && (
            <button
              onClick={() => setExpanded(true)}
              className="text-[12px] font-semibold text-white/80 underline mt-1"
            >
              {m.showMore}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 mt-3.5">
        <button
          onClick={handleAck}
          disabled={acking || !canAck}
          title={!canAck ? m.readFirst : undefined}
          className="w-full py-2.5 bg-white text-[#1b2d54] rounded-xl text-[13.5px] font-bold transition disabled:opacity-45 active:scale-[0.99]"
        >
          {acking ? m.acking : m.ack}
        </button>

        <a
          href={contactHref}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center justify-center gap-2 py-2.5 border border-white/25 rounded-xl text-[12.5px] font-semibold text-white/95 hover:bg-white/10 transition overflow-hidden"
        >
          {phone ? (
            <img src="/whatsapp.png" alt="" className="w-[17px] h-[17px] flex-shrink-0" />
          ) : (
            <MessageSquareWarning size={15} className="flex-shrink-0" />
          )}
          <span className="truncate">{m.contact(note.author.email)}</span>
        </a>
      </div>

      {(shownLocale === 'cs' || otherLocales.length > 0) && (
        <p className="text-[10.5px] text-white/45 mt-2.5">
          {shownLocale === 'cs' && m.writtenInCzech}
          {otherLocales.map((l) => (
            <button
              key={l}
              onClick={() => setOverrideLocale(l as Locale)}
              className="text-white/80 underline ml-2"
            >
              {m.showIn[l as Locale]}
            </button>
          ))}
        </p>
      )}
    </div>
  );
}

function initials(value: string): string {
  const parts = value.split(/[\s@.]+/).filter(Boolean);
  return (parts[0]?.[0] ?? '?').toUpperCase() + (parts[1]?.[0] ?? '').toUpperCase();
}

function formatSent(iso: string, locale: Locale): string {
  const d = new Date(iso);
  const tag = locale === 'en' ? 'en-GB' : locale === 'cs' ? 'cs-CZ' : locale === 'ru' ? 'ru-RU' : 'uk-UA';
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString(tag, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(tag, { day: 'numeric', month: 'numeric' }) +
        ' ' + d.toLocaleTimeString(tag, { hour: '2-digit', minute: '2-digit' });
}
