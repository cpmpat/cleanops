'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft, UserPlus, Send, ImagePlus, X, Check, Lock, LogIn, LogOut, Star,
} from 'lucide-react';
import {
  conversations as conversationsApi,
  uploads,
  ApiError,
  type Conversation,
  type ConversationCandidate,
  type ConversationMessage,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSocket, useRefreshOnReconnect } from '@/lib/socket';
import { SignedImage } from '@/components/SignedImage';
import { useMessageStrings } from '@/i18n/messages';
import { translations, type Locale } from '@/i18n/translations';
import { formatTime } from '@/lib/utils';

/**
 * One conversation, tied to one turnover.
 *
 * Colours carry who is speaking, the same way they do everywhere else in the
 * app: blue is the office, dark is you, white is another cleaner. System lines
 * are grey pills in the middle — they are the record of what happened, not
 * something anybody said.
 */
export default function ConversationPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id as string;

  const { user } = useAuth();
  const locale = (user?.language as Locale) ?? 'cs';
  const m = useMessageStrings(locale);
  const t = translations[locale];

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [pendingImages, setPendingImages] = useState<{ file: File; preview: string }[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [starred, setStarred] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await conversationsApi.get(id);
      setConversation(data);
      setStarred(!!data.members.find((mem) => mem.userId === user?.id)?.starred);
      conversationsApi.markRead(id).catch(() => {});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.general.error);
    } finally {
      setLoading(false);
    }
  }, [id, t.general.error, user?.id]);

  useEffect(() => { if (id) load(); }, [id, load]);
  useSocket({ 'conversation:changed': () => load() });
  useRefreshOnReconnect(load);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [conversation?.messages?.length]);

  async function handleSend() {
    if (!conversation || (!draft.trim() && !pendingImages.length)) return;
    setSending(true);
    setError('');
    try {
      // Photos go straight to storage; only the reference travels through the
      // API, same as incident photos.
      const attachments = [];
      for (const { file } of pendingImages) {
        const { publicUrl } = await uploads.uploadToGcs({
          file,
          eventType: 'cleaning',
          propertyId: conversation.turnover?.property?.id,
        });
        attachments.push({ url: publicUrl, mimeType: file.type, bytes: file.size });
      }
      await conversationsApi.post(id, { body: draft.trim() || undefined, attachments });
      setDraft('');
      pendingImages.forEach((p) => URL.revokeObjectURL(p.preview));
      setPendingImages([]);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.general.error);
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="w-8 h-8 rounded-xl bg-ink animate-pulse" />
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="min-h-screen bg-surface flex flex-col items-center justify-center gap-3 px-8 text-center">
        <p className="text-sm text-ink-muted">{error || t.general.error}</p>
        <Link href="/notifications" className="text-sm font-semibold text-accent underline">
          {t.general.back}
        </Link>
      </div>
    );
  }

  const turnover = conversation.turnover;
  const isClosed = conversation.status === 'CLOSED';

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      {/* Header */}
      <div className="bg-ink text-white px-4 pt-12 pb-3 flex items-center gap-3">
        <Link
          href="/notifications"
          className="w-9 h-9 -ml-1 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/70"
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="min-w-0">
          <h1 className="text-[14.5px] font-bold truncate">
            {turnover?.property?.name ?? '—'}
          </h1>
          <p className="text-[10px] text-white/50">
            {m.thread.participants(conversation.members.length)}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setSheetOpen(true)}
            className="flex items-center gap-1.5 bg-white/12 hover:bg-white/20 rounded-full px-3 py-1.5 text-[10.5px] font-bold transition"
          >
            <UserPlus size={12} />
            {m.thread.add}
          </button>

          {/* Keep. Finished cleanings take their chat with them after 30 days;
              a star holds this one back. Optimistic, because a star that waits
              for the network feels broken. */}
          <button
            onClick={async () => {
              const next = !starred;
              setStarred(next);
              try {
                await conversationsApi.star(id, next);
              } catch {
                setStarred(!next);
              }
            }}
            title={starred ? m.thread.kept : m.thread.keep}
            aria-pressed={starred}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition ${
              starred ? 'text-amber-300 bg-white/12' : 'text-white/55 hover:text-white hover:bg-white/10'
            }`}
          >
            <Star size={17} fill={starred ? 'currentColor' : 'none'} />
          </button>
        </div>
      </div>

      {/* Context — what this conversation is about */}
      <div className="bg-surface-sunken border-b border-surface-border px-3.5 py-2 flex items-center gap-2 flex-wrap">
        {turnover?.fromBooking?.checkOutTime && (
          <span className="inline-flex items-center gap-1.5 bg-white border border-surface-border rounded-full px-2.5 py-1 text-[10px] font-semibold text-ink-soft">
            <LogOut size={10} />
            {formatTime(turnover.fromBooking.checkOutTime)}
          </span>
        )}
        {turnover?.toBooking?.checkInTime && (
          <span className="inline-flex items-center gap-1.5 bg-white border border-surface-border rounded-full px-2.5 py-1 text-[10px] font-semibold text-ink-soft">
            <LogIn size={10} />
            {formatTime(turnover.toBooking.checkInTime)}
          </span>
        )}
        <span className="ml-auto flex">
          {conversation.members.slice(0, 4).map((mem, i) => (
            <span
              key={mem.id}
              className={`w-[22px] h-[22px] rounded-full border-2 border-white flex items-center justify-center text-[9px] font-bold text-white ${
                mem.user.role === 'CLEANER' ? 'bg-stone-500' : 'bg-[#243b6b]'
              }`}
              style={{ marginLeft: i === 0 ? 0 : -7 }}
              title={mem.user.name}
            >
              {(mem.user.name?.[0] ?? '?').toUpperCase()}
            </span>
          ))}
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 px-3.5 py-3.5 flex flex-col gap-2.5">
        {conversation.messages?.map((msg) => (
          <Bubble key={msg.id} msg={msg} meId={user?.id} locale={locale} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="sticky bottom-20 bg-white border-t border-surface-border px-3 pt-2.5 pb-3">
        {error && <p className="text-[11px] text-red-600 mb-2">{error}</p>}

        {pendingImages.length > 0 && (
          <div className="flex gap-2 mb-2 overflow-x-auto">
            {pendingImages.map((p, i) => (
              <div key={i} className="relative flex-shrink-0">
                <img src={p.preview} alt="" className="w-16 h-16 rounded-lg object-cover" />
                <button
                  onClick={() => {
                    URL.revokeObjectURL(p.preview);
                    setPendingImages((prev) => prev.filter((_, idx) => idx !== i));
                  }}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-ink text-white flex items-center justify-center"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        {isClosed ? (
          <p className="text-[12px] text-ink-muted text-center py-2">{m.thread.closed}</p>
        ) : (
          <div className="flex items-center gap-2">
            <label className="w-9 h-9 rounded-full bg-surface-sunken text-ink-muted flex items-center justify-center flex-shrink-0 cursor-pointer">
              <ImagePlus size={17} />
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  setPendingImages((prev) => [
                    ...prev,
                    ...files.map((file) => ({ file, preview: URL.createObjectURL(file) })),
                  ]);
                  e.target.value = '';
                }}
              />
            </label>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder={m.thread.placeholder}
              className="flex-1 bg-surface-sunken rounded-full px-4 py-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <button
              onClick={handleSend}
              disabled={sending || (!draft.trim() && !pendingImages.length)}
              className="w-9 h-9 rounded-full bg-ink text-white flex items-center justify-center flex-shrink-0 disabled:opacity-40"
            >
              <Send size={15} />
            </button>
          </div>
        )}
      </div>

      {sheetOpen && (
        <AddPeopleSheet
          conversationId={id}
          locale={locale}
          onClose={() => setSheetOpen(false)}
          onAdded={() => { setSheetOpen(false); load(); }}
        />
      )}
    </div>
  );
}

// ─── Bubble ───────────────────────────────────────────────────────────────────

function Bubble({
  msg, meId, locale,
}: { msg: ConversationMessage; meId?: string; locale: Locale }) {
  const m = useMessageStrings(locale);

  if (msg.kind === 'SYSTEM') {
    return (
      <div className="self-center text-[10px] text-ink-faint bg-surface-sunken rounded-full px-3 py-1 text-center">
        {systemLine(msg.body, m)}
      </div>
    );
  }

  const mine = msg.authorId === meId;
  const office = msg.author?.role === 'MANAGER' || msg.author?.role === 'ADMIN';

  return (
    <div
      className={`max-w-[82%] rounded-2xl px-3 py-2.5 text-[12.5px] leading-relaxed ${
        mine
          ? 'self-end bg-ink text-white rounded-br-md'
          : office
          ? 'self-start bg-[#243b6b] text-white rounded-bl-md'
          : 'self-start bg-white border border-surface-border text-ink-soft rounded-bl-md'
      }`}
    >
      {!mine && (
        <span className="block text-[9.5px] font-extrabold uppercase tracking-wide opacity-60 mb-1">
          {msg.author?.name ?? '—'}
        </span>
      )}

      {msg.attachments?.map((a) => (
        <SignedImage
          key={a.id}
          src={a.url}
          className="w-[150px] h-[100px] object-cover rounded-lg mb-1.5"
        />
      ))}

      {msg.body}

      <span className="block mt-1.5 text-[9.5px] opacity-55">
        {new Date(msg.createdAt).toLocaleTimeString(
          locale === 'en' ? 'en-GB' : locale === 'cs' ? 'cs-CZ' : locale === 'ru' ? 'ru-RU' : 'uk-UA',
          { hour: '2-digit', minute: '2-digit' },
        )}
      </span>
    </div>
  );
}

function systemLine(body: string | null | undefined, m: any): string {
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

// ─── Add people ───────────────────────────────────────────────────────────────

function AddPeopleSheet({
  conversationId, locale, onClose, onAdded,
}: {
  conversationId: string;
  locale: Locale;
  onClose: () => void;
  onAdded: () => void;
}) {
  const m = useMessageStrings(locale);
  const t = translations[locale];

  const [people, setPeople] = useState<ConversationCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    conversationsApi.candidates(conversationId).then(setPeople).catch(() => {});
  }, [conversationId]);

  const blocked = people.some((p) => !p.canInvite);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white rounded-t-3xl p-4 pb-8 max-h-[80vh] flex flex-col"
      >
        <div className="w-11 h-1 rounded-full bg-surface-border mx-auto mb-3.5" />
        <h2 className="font-bold text-[15px]">{m.thread.addTitle}</h2>
        <p className="text-[11.5px] text-ink-muted mt-0.5 mb-3">{m.thread.addHint}</p>

        <div className="flex-1 overflow-y-auto -mx-1 px-1">
          {people.map((p) => (
            <button
              key={p.id}
              disabled={!p.canInvite}
              onClick={() =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (next.has(p.id)) next.delete(p.id);
                  else next.add(p.id);
                  return next;
                })
              }
              className={`w-full flex items-center gap-3 py-2.5 px-1 border-b border-surface-border text-left ${
                p.canInvite ? '' : 'opacity-40'
              }`}
            >
              <span
                className={`w-[26px] h-[26px] rounded-full flex items-center justify-center text-[10.5px] font-bold text-white flex-shrink-0 ${
                  p.role === 'CLEANER' ? 'bg-stone-500' : 'bg-[#243b6b]'
                }`}
              >
                {(p.name?.[0] ?? '?').toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold truncate">{p.name}</span>
                <span className="block text-[10.5px] text-ink-faint">{roleLabel(p.role)}</span>
              </span>
              <span
                className={`w-[19px] h-[19px] rounded-md border-2 flex items-center justify-center flex-shrink-0 ${
                  selected.has(p.id)
                    ? 'bg-ink border-ink text-white'
                    : p.canInvite
                    ? 'border-surface-border'
                    : 'border-dashed border-surface-border'
                }`}
              >
                {selected.has(p.id) && <Check size={11} strokeWidth={3} />}
              </span>
            </button>
          ))}
        </div>

        {blocked && (
          <div className="flex gap-2 items-start bg-surface-sunken rounded-xl px-3 py-2.5 mt-3 text-[11px] text-ink-muted leading-relaxed">
            <Lock size={13} className="mt-0.5 flex-shrink-0" />
            <span>{m.thread.cannotInvite}</span>
          </div>
        )}

        <div className="flex gap-2 pt-3">
          <button
            onClick={onClose}
            className="px-4 py-2.5 bg-white border border-surface-border rounded-xl text-sm font-semibold"
          >
            {t.general.cancel}
          </button>
          <button
            disabled={selected.size === 0 || saving}
            onClick={async () => {
              setSaving(true);
              try {
                await conversationsApi.addMembers(conversationId, Array.from(selected));
                onAdded();
              } catch {
                setSaving(false);
              }
            }}
            className="flex-1 px-4 py-2.5 bg-ink text-white rounded-xl text-sm font-semibold disabled:opacity-40"
          >
            {m.thread.add}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Until roles get proper labels, show something readable rather than the enum. */
function roleLabel(role: string): string {
  return role
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
