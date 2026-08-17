'use client';
import { useEffect, useState } from 'react';
import { Mail, Check, Building2, MessageSquareWarning } from 'lucide-react';
import { notes as notesApi, type MyNote } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useMessageStrings } from '@/i18n/messages';
import type { Locale } from '@/i18n/translations';

/**
 * One manager message, in the Notifikace section.
 *
 * Unconfirmed is a solid blue card carrying everything — text and both
 * actions, nothing hidden behind a tap. Confirmed drops to a quiet white row:
 * still readable, because "what was that new safe code?" is the most common
 * reason someone opens this screen a second time.
 */

const LONG_BODY = 240;
const READ_DELAY_MS = 1000;

export function MessageCard({
  note,
  locale,
  onAcknowledged,
}: {
  note: MyNote;
  locale: Locale;
  onAcknowledged: (id: string) => void;
}) {
  const { user } = useAuth();
  const m = useMessageStrings(locale);

  const [acking, setAcking] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [overrideLocale, setOverrideLocale] = useState<Locale | null>(null);
  const [ready, setReady] = useState(false);

  // A beat before the button arms, so it cannot be swatted away on reflex.
  useEffect(() => {
    setReady(false);
    const timer = setTimeout(() => setReady(true), READ_DELAY_MS);
    return () => clearTimeout(timer);
  }, [note.id, note.version]);

  const shownLocale = (overrideLocale ?? note.localeShown) as Locale;
  const body = note.bodies[shownLocale] ?? note.body;
  const isLong = body.length > LONG_BODY;
  const otherLocales = note.availableLocales.filter((l) => l !== shownLocale);

  // ─── Confirmed: quiet, still readable ───
  if (note.acknowledged) {
    return (
      <div className="bg-white border border-surface-border border-l-[3px] border-l-[#c8d4ea] rounded-2xl p-3.5 mb-2.5">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-[13.5px] text-ink-soft min-w-0 truncate">
            {note.title}
          </h3>
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold text-[#243b6b] bg-[#eef2fa] rounded-full px-2 py-0.5 flex-shrink-0">
            <Check size={10} strokeWidth={3} />
            {m.section.confirmedChip}
          </span>
        </div>
        <p className="text-xs text-ink-muted mt-1.5 line-clamp-2 whitespace-pre-line">{body}</p>
        <p className="text-[10.5px] text-ink-faint mt-1.5">
          {new Date(note.createdAt).toLocaleDateString()}
          {note.ackedAt && ` · ${m.section.confirmedAt(formatStamp(note.ackedAt, locale))}`}
        </p>
      </div>
    );
  }

  async function handleAck() {
    setAcking(true);
    try {
      await notesApi.ack(note.id, shownLocale);
      onAcknowledged(note.id);
    } catch {
      setAcking(false); // stays on screen — an unconfirmed message must not vanish
    }
  }

  const phone = note.author.mobileNumber?.replace(/[^\d]/g, '');
  const prefill =
    `Airstay · ${user?.name ?? ''}\n` +
    `„${note.title}" (${new Date(note.createdAt).toLocaleDateString('cs-CZ', {
      day: 'numeric', month: 'numeric',
    })})\n`;
  const contactHref = phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(prefill)}`
    : `mailto:${note.author.email}?subject=${encodeURIComponent(note.title)}`;

  const canAck = ready && (!isLong || expanded);

  return (
    <div className="bg-gradient-to-b from-[#243b6b] to-[#1b2d54] text-white rounded-[18px] p-4 mb-3 shadow-[0_4px_16px_rgba(27,45,84,0.18)]">
      <div className="flex items-center gap-2 text-[9.5px] font-bold uppercase tracking-[0.11em] text-white/60">
        <Mail size={11} strokeWidth={2.2} />
        {m.kicker}
        <span className="ml-auto tracking-normal normal-case text-[10.5px] font-semibold">
          {formatStamp(note.createdAt, locale)}
        </span>
      </div>

      <div className="flex gap-3 mt-3">
        <div className="w-[34px] h-[34px] rounded-full bg-white/15 flex items-center justify-center font-bold text-[13px] flex-shrink-0">
          {initials(note.author.name || note.author.email)}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-[15px] leading-snug">{note.title}</h3>
          <p className="text-[10.5px] text-white/55 mt-0.5 truncate">{note.author.email}</p>

          <p
            className={`text-[13px] leading-relaxed text-white/90 mt-2 whitespace-pre-line ${
              isLong && !expanded ? 'line-clamp-4' : ''
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

          {/* Only for property messages — naming the unit answers "why me?".
              For a message sent to people by name, the answer is obvious. */}
          {note.targetType === 'PROPERTY' && note.properties.length > 0 && (
            <span className="mt-2.5 inline-flex items-center gap-1.5 text-[10px] text-white/70 bg-white/10 rounded-full px-2.5 py-1">
              <Building2 size={10} />
              {m.section.forProperty(note.properties.map((p) => p.name).join(', '))}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 mt-3">
        <button
          onClick={handleAck}
          disabled={acking || !canAck}
          title={!canAck ? m.readFirst : undefined}
          className="w-full py-2.5 bg-white text-[#1b2d54] rounded-xl text-[13px] font-bold transition disabled:opacity-45 active:scale-[0.99]"
        >
          {acking ? m.acking : m.ack}
        </button>

        <a
          href={contactHref}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center justify-center gap-2 py-2.5 border border-white/25 rounded-xl text-[12px] font-semibold text-white/95 hover:bg-white/10 transition overflow-hidden"
        >
          {phone ? (
            <img src="/whatsapp.png" alt="" className="w-4 h-4 flex-shrink-0" />
          ) : (
            <MessageSquareWarning size={14} className="flex-shrink-0" />
          )}
          <span className="truncate">{m.contact(note.author.email)}</span>
        </a>
      </div>

      {(shownLocale === 'cs' || otherLocales.length > 0) && (
        <p className="text-[10px] text-white/45 mt-2">
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

function formatStamp(iso: string, locale: Locale): string {
  const d = new Date(iso);
  const tag = locale === 'en' ? 'en-GB' : locale === 'cs' ? 'cs-CZ' : locale === 'ru' ? 'ru-RU' : 'uk-UA';
  const time = d.toLocaleTimeString(tag, { hour: '2-digit', minute: '2-digit' });
  return new Date().toDateString() === d.toDateString()
    ? time
    : `${d.toLocaleDateString(tag, { day: 'numeric', month: 'numeric' })} ${time}`;
}
