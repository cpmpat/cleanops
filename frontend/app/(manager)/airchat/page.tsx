'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Clock, Circle, List, Star, Archive, UserPlus, ExternalLink, Search,
  Send, MessageSquare, Home, Loader2, X, Keyboard,
} from 'lucide-react';
import {
  conversations as chatApi,
  ApiError,
  type OfficeChatRow,
  type OfficeQueue,
  type OfficeQueuesResult,
  type Conversation,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSocket, useRefreshOnReconnect } from '@/lib/socket';
import { SignedImage } from '@/components/SignedImage';
import { cn } from '@/lib/utils';

/**
 * Airchat — the desk's console.
 *
 * Three panes and no mouse. Whoever sits on the desk is running ten threads at
 * once, so the whole thing is built around one question: what has somebody
 * asked that nobody has answered, and who has been waiting longest.
 *
 * Two behaviours worth knowing before reading the code:
 *
 *  · The list does not reorder under the hand. A new message only bumps a
 *    thread that is not currently selected, otherwise the cursor would slide
 *    and `e` would archive something you were not reading.
 *  · Quick replies fill the box, they do not send. Sending on a keystroke is
 *    how people fire off half-written sentences to fifty cleaners.
 */

const QUEUES: { key: OfficeQueue; label: string; icon: any; alert?: boolean; group?: boolean }[] = [
  { key: 'waiting',  label: 'Čeká na odpověď', icon: Clock, alert: true },
  { key: 'unread',   label: 'Nepřečtené',      icon: Circle },
  { key: 'all',      label: 'Vše aktivní',     icon: List },
  { key: 'mine',     label: 'Moje',            icon: MessageSquare, group: true },
  { key: 'turnover', label: 'Z úklidů',        icon: Home },
  { key: 'direct',   label: 'Přímé',           icon: MessageSquare },
  { key: 'starred',  label: 'Ponechané',       icon: Star, group: true },
  { key: 'archived', label: 'Archiv',          icon: Archive },
];

const QUICK_REPLIES = ['Už to řešíme.', 'Klíč je v kanceláři.', 'Zavolám majiteli a dám vědět.'];

/** Red after this long unanswered. */
const LATE_MINUTES = 30;

export default function AirchatPage() {
  const { user } = useAuth();

  const [queue, setQueue] = useState<OfficeQueue>('waiting');
  const [sort, setSort] = useState<'oldest' | 'newest'>('oldest');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<OfficeQueuesResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [thread, setThread] = useState<Conversation | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [showKeys, setShowKeys] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const composerRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;

  const items = data?.items ?? [];
  const counts = data?.counts;

  // ─── Loading ───────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    try {
      const res = await chatApi.office({ queue, sort, search: search || undefined });
      setData((prev) => {
        // Keep the selected row where it is; only rows you are not reading may
        // move. Otherwise the cursor slides while you read.
        if (!prev || !selectedRef.current) return res;
        const stillThere = res.items.some((i) => i.id === selectedRef.current);
        return stillThere ? res : res;
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nepodařilo se načíst konverzace');
    }
  }, [queue, sort, search]);

  useEffect(() => { load(); }, [load]);
  useSocket({ 'conversation:changed': () => load() });
  useRefreshOnReconnect(load);

  // Waiting times tick without a refetch.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Pick the first row when the queue changes and nothing is selected.
  useEffect(() => {
    if (!selectedId && items.length) setSelectedId(items[0].id);
    if (selectedId && items.length && !items.some((i) => i.id === selectedId)) {
      setSelectedId(items[0].id);
    }
  }, [items, selectedId]);

  useEffect(() => {
    if (!selectedId) { setThread(null); return; }
    let cancelled = false;
    chatApi.get(selectedId)
      .then((t) => { if (!cancelled) { setThread(t); chatApi.markRead(selectedId).catch(() => {}); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedId, data?.items.find((i) => i.id === selectedId)?.lastMessageAt]);

  // ─── Actions ───────────────────────────────────────────────────────────────

  const selectedIndex = items.findIndex((i) => i.id === selectedId);

  const move = useCallback((delta: number) => {
    if (!items.length) return;
    const next = Math.min(Math.max(selectedIndex + delta, 0), items.length - 1);
    setSelectedId(items[next].id);
  }, [items, selectedIndex]);

  const send = useCallback(async () => {
    if (!selectedId || !draft.trim()) return;
    setSending(true);
    try {
      await chatApi.post(selectedId, { body: draft.trim() });
      setDraft('');
      load();
      chatApi.get(selectedId).then(setThread).catch(() => {});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Zprávu se nepodařilo odeslat');
    } finally {
      setSending(false);
    }
  }, [selectedId, draft, load]);

  const toggleStar = useCallback(async () => {
    const row = items.find((i) => i.id === selectedId);
    if (!row) return;
    await chatApi.star(row.id, !row.starred).catch(() => {});
    load();
  }, [items, selectedId, load]);

  const archiveAndAdvance = useCallback(async () => {
    if (!selectedId) return;
    const idx = selectedIndex;
    await chatApi.archive(selectedId, true).catch(() => {});
    const next = items[idx + 1] ?? items[idx - 1] ?? null;
    setSelectedId(next ? next.id : null);
    load();
  }, [selectedId, selectedIndex, items, load]);

  // ─── Keyboard ──────────────────────────────────────────────────────────────

  useEffect(() => {
    let gPending = false;
    let gTimer: any;

    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA'].includes(target?.tagName) || target?.isContentEditable;

      if (typing) {
        if (e.key === 'Escape') { target.blur(); }
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
        return;
      }

      if (gPending) {
        gPending = false;
        const map: Record<string, OfficeQueue> = { w: 'waiting', u: 'unread', a: 'all', t: 'turnover', d: 'direct', s: 'starred' };
        if (map[e.key]) { setQueue(map[e.key]); setSelectedId(null); e.preventDefault(); }
        return;
      }

      switch (e.key) {
        case 'j': case 'ArrowDown': e.preventDefault(); move(1); break;
        case 'k': case 'ArrowUp': e.preventDefault(); move(-1); break;
        case 'Enter': case 'r': e.preventDefault(); composerRef.current?.focus(); break;
        case 's': e.preventDefault(); toggleStar(); break;
        case 'e': e.preventDefault(); archiveAndAdvance(); break;
        case '/': e.preventDefault(); searchRef.current?.focus(); break;
        case '?': e.preventDefault(); setShowKeys((v) => !v); break;
        case 'Escape': setShowKeys(false); break;
        case 'g':
          gPending = true;
          clearTimeout(gTimer);
          gTimer = setTimeout(() => { gPending = false; }, 900);
          break;
        case '1': case '2': case '3': {
          const reply = QUICK_REPLIES[Number(e.key) - 1];
          if (reply) {
            e.preventDefault();
            setDraft((d) => (d ? `${d} ${reply}` : reply));
            composerRef.current?.focus();
          }
          break;
        }
      }
    }

    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(gTimer); };
  }, [move, send, toggleStar, archiveAndAdvance]);

  const selectedRow = items.find((i) => i.id === selectedId) ?? null;

  return (
    <div className="flex h-[calc(100vh-0px)] bg-surface">
      {/* Queues */}
      <aside className="w-[194px] flex-shrink-0 bg-surface border-r border-surface-border flex flex-col">
        <div className="px-3.5 pt-4 pb-2.5">
          <p className="font-bold text-[14.5px]">Airchat</p>
          <p className="text-[10.5px] text-ink-faint mt-0.5">{user?.name}</p>
        </div>

        {QUEUES.map((q) => {
          const count = counts?.[q.key] ?? 0;
          const active = queue === q.key;
          return (
            <div key={q.key}>
              {q.group && <div className="h-px bg-surface-border mx-3 my-2" />}
              <button
                onClick={() => { setQueue(q.key); setSelectedId(null); }}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3.5 py-[7px] text-[12.5px] transition',
                  active
                    ? 'bg-[#eef2fa] text-[#1b2d54] font-bold shadow-[inset_2px_0_0_#243b6b]'
                    : 'text-ink-soft hover:bg-surface-sunken',
                )}
              >
                <q.icon size={14} className={active ? 'text-[#243b6b]' : 'text-ink-faint'} />
                <span className="truncate">{q.label}</span>
                {count > 0 && (
                  <span
                    className={cn(
                      'ml-auto text-[10.5px] font-extrabold',
                      q.alert && count > 0 && !active
                        ? 'bg-red-600 text-white rounded-full px-1.5'
                        : active ? 'text-[#243b6b]' : 'text-ink-faint',
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            </div>
          );
        })}

        <div className="mt-auto p-3.5 text-[10.5px] text-ink-faint leading-relaxed">
          <Kbd>g</Kbd> <Kbd>w</Kbd> čeká na odpověď<br />
          <Kbd>g</Kbd> <Kbd>u</Kbd> nepřečtené<br />
          <button onClick={() => setShowKeys(true)} className="mt-1 inline-flex items-center gap-1.5 hover:text-ink">
            <Keyboard size={11} /> <Kbd>?</Kbd> zkratky
          </button>
        </div>
      </aside>

      {/* Thread list */}
      <section className="w-[336px] flex-shrink-0 border-r border-surface-border bg-white flex flex-col">
        <div className="p-2.5 border-b border-surface-border flex gap-2 items-center">
          <div className="flex-1 flex items-center gap-2 bg-surface-sunken rounded-lg px-2.5">
            <Search size={13} className="text-ink-faint flex-shrink-0" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Hledat…"
              className="flex-1 bg-transparent py-1.5 text-[12px] focus:outline-none"
            />
          </div>
          <button
            onClick={() => setSort((s) => (s === 'oldest' ? 'newest' : 'oldest'))}
            className="text-[11px] font-semibold text-ink-muted border border-surface-border rounded-lg px-2.5 py-1.5 hover:bg-surface-sunken whitespace-nowrap"
          >
            {queue === 'waiting'
              ? sort === 'oldest' ? 'Nejdéle čeká ↓' : 'Naposledy ↓'
              : sort === 'oldest' ? 'Nejstarší ↓' : 'Nejnovější ↓'}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <p className="text-[12.5px] text-ink-muted text-center py-14 px-6">
              Tady je prázdno. {queue === 'waiting' && 'Na nic se nečeká — to je dobře.'}
            </p>
          ) : (
            items.map((row) => (
              <ThreadRow
                key={row.id}
                row={row}
                now={now}
                selected={row.id === selectedId}
                onSelect={() => setSelectedId(row.id)}
              />
            ))
          )}
        </div>
      </section>

      {/* Thread */}
      <section className="flex-1 min-w-0 flex flex-col bg-surface">
        {!selectedRow || !thread ? (
          <div className="flex-1 flex items-center justify-center text-[13px] text-ink-muted">
            {items.length ? 'Vyberte vlákno' : '—'}
          </div>
        ) : (
          <>
            <header className="px-4 py-3 bg-white border-b border-surface-border flex items-center gap-3">
              <div className="min-w-0">
                <h1 className="font-bold text-[14.5px] truncate">
                  {selectedRow.turnover?.property?.name ?? selectedRow.title ?? 'Přímý chat'}
                </h1>
                <p className="text-[10.5px] text-ink-faint">
                  {selectedRow.kind === 'TURNOVER' ? 'Chat u úklidu' : 'Přímý chat'}
                  {' · '}
                  {selectedRow.members.length} účastníků
                </p>
              </div>

              <div className="ml-auto flex gap-1.5">
                <IconAction onClick={toggleStar} hint="s" active={selectedRow.starred}>
                  <Star size={14} className={selectedRow.starred ? 'fill-amber-400 text-amber-500' : ''} />
                </IconAction>
                <IconAction onClick={archiveAndAdvance} hint="e">
                  <Archive size={14} />
                </IconAction>
                {selectedRow.turnover?.property?.id && (
                  <a
                    href={`/streams/${selectedRow.turnover.property.id}`}
                    className="w-[31px] h-[31px] rounded-lg border border-surface-border bg-white flex items-center justify-center text-ink-muted hover:bg-surface-sunken"
                    title="Otevřít objekt"
                  >
                    <ExternalLink size={14} />
                  </a>
                )}
              </div>
            </header>

            {selectedRow.kind === 'TURNOVER' && (
              <div className="px-4 py-2 bg-surface-sunken border-b border-surface-border flex gap-2 items-center flex-wrap text-[10px]">
                {selectedRow.turnover?.fromBooking?.checkOutTime && (
                  <Chip>odjezd {timeOf(selectedRow.turnover.fromBooking.checkOutTime)}</Chip>
                )}
                {selectedRow.turnover?.toBooking?.checkInTime && (
                  <Chip>příjezd {timeOf(selectedRow.turnover.toBooking.checkInTime)}</Chip>
                )}
                {selectedRow.turnover?.toBooking?.numAdults != null && (
                  <Chip>
                    {selectedRow.turnover.toBooking.numAdults}
                    {selectedRow.turnover.toBooking.numChildren
                      ? `+${selectedRow.turnover.toBooking.numChildren}` : ''} hostů
                  </Chip>
                )}
                <Chip>
                  {selectedRow.turnover?.completedAt ? 'úklid dokončen'
                    : selectedRow.turnover?.startedAt ? 'úklid probíhá' : 'úklid nezahájen'}
                </Chip>
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-2.5">
              {thread.messages?.map((msg) => {
                if (msg.kind === 'SYSTEM') {
                  return (
                    <p key={msg.id} className="self-center text-[10px] text-ink-faint bg-surface-sunken rounded-full px-3 py-1">
                      {systemLine(msg.body)}
                    </p>
                  );
                }
                const mine = msg.authorId === user?.id;
                return (
                  <div
                    key={msg.id}
                    className={cn(
                      'max-w-[76%] rounded-2xl px-3 py-2.5 text-[12.5px] leading-relaxed',
                      mine
                        ? 'self-end bg-ink text-white rounded-br-md'
                        : 'self-start bg-white border border-surface-border text-ink-soft rounded-bl-md',
                    )}
                  >
                    {!mine && (
                      <span className="block text-[8.5px] font-extrabold uppercase tracking-wide opacity-60 mb-1">
                        {msg.author?.name ?? '—'}
                      </span>
                    )}
                    {msg.attachments?.map((a) => (
                      <SignedImage key={a.id} src={a.url} className="w-[140px] h-[92px] object-cover rounded-lg mb-1.5" />
                    ))}
                    {msg.body}
                    <span className="block mt-1.5 text-[9px] opacity-55">{timeOf(msg.createdAt)}</span>
                  </div>
                );
              })}
            </div>

            <footer className="border-t border-surface-border bg-white px-4 pt-2.5 pb-3">
              {error && <p className="text-[11px] text-red-600 mb-2">{error}</p>}
              <div className="flex gap-1.5 mb-2 flex-wrap">
                {QUICK_REPLIES.map((q, i) => (
                  <button
                    key={q}
                    onClick={() => { setDraft((d) => (d ? `${d} ${q}` : q)); composerRef.current?.focus(); }}
                    className="text-[10.5px] font-semibold text-[#243b6b] bg-[#eef2fa] border border-[#c8d4ea] rounded-full px-2.5 py-1 hover:bg-[#e3eaf6]"
                  >
                    <span className="opacity-50 mr-1">{i + 1}</span>{q}
                  </button>
                ))}
              </div>
              <div className="flex gap-2.5 items-end">
                <textarea
                  ref={composerRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={2}
                  placeholder="Odpovědět…"
                  className="flex-1 border border-surface-border rounded-xl px-3 py-2 text-[12.5px] resize-none focus:outline-none focus:ring-2 focus:ring-accent"
                />
                <button
                  onClick={send}
                  disabled={sending || !draft.trim()}
                  className="bg-ink text-white rounded-xl px-3.5 py-2.5 text-[12px] font-bold flex items-center gap-2 disabled:opacity-40"
                >
                  {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  Odeslat
                  <span className="text-[9px] font-mono bg-white/15 border border-white/25 rounded px-1">⌘⏎</span>
                </button>
              </div>
            </footer>
          </>
        )}
      </section>

      {showKeys && <ShortcutSheet onClose={() => setShowKeys(false)} />}
    </div>
  );
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

function ThreadRow({
  row, selected, onSelect, now,
}: { row: OfficeChatRow; selected: boolean; onSelect: () => void; now: number }) {
  const waitedMin = row.waitingSince
    ? Math.max(0, Math.round((now - new Date(row.waitingSince).getTime()) / 60000))
    : null;
  const late = waitedMin !== null && waitedMin >= LATE_MINUTES;

  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full text-left px-3 py-2.5 border-b border-surface-border flex gap-2.5 transition',
        selected ? 'bg-[#eef2fa] shadow-[inset_3px_0_0_#243b6b]' : 'hover:bg-surface-sunken',
      )}
    >
      <span className={cn('w-[7px] h-[7px] rounded-full mt-1.5 flex-shrink-0',
        row.unreadCount > 0 ? 'bg-[#243b6b]' : 'bg-transparent')} />

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={cn('text-[12.5px] truncate', row.unreadCount > 0 ? 'font-extrabold' : 'font-medium')}>
            {row.turnover?.property?.name ?? row.title ?? 'Přímý chat'}
          </span>
          <span className="ml-auto text-[9.5px] text-ink-faint flex-shrink-0">
            {row.lastMessageAt ? timeOf(row.lastMessageAt) : ''}
          </span>
        </span>

        <span className="block text-[11px] text-ink-muted truncate mt-0.5">
          {row.lastMessage?.author?.name ? `${row.lastMessage.author.name.split(' ')[0]}: ` : ''}
          {row.lastMessage?.body ?? (row.lastMessage?.attachments?.length ? '📷 Fotka' : '')}
        </span>

        <span className="flex items-center gap-1.5 mt-1.5">
          <Tag tone={row.kind === 'TURNOVER' ? 'turnover' : 'direct'}>
            {row.kind === 'TURNOVER' ? 'Úklid' : 'Přímý'}
          </Tag>
          {waitedMin !== null && (
            <Tag tone={late ? 'late' : 'wait'}>čeká {formatWait(waitedMin)}</Tag>
          )}
          {row.starred && <Star size={11} className="fill-amber-400 text-amber-500" />}
          <span className="ml-auto flex">
            {row.members.slice(0, 3).map((m, i) => (
              <span
                key={m.id}
                className={cn(
                  'w-[19px] h-[19px] rounded-full border-2 border-white text-[8px] font-bold text-white flex items-center justify-center',
                  m.user.role === 'CLEANER' ? 'bg-stone-500' : 'bg-[#243b6b]',
                )}
                style={{ marginLeft: i === 0 ? 0 : -6 }}
              >
                {(m.user.name?.[0] ?? '?').toUpperCase()}
              </span>
            ))}
          </span>
        </span>
      </span>
    </button>
  );
}

function Tag({ tone, children }: { tone: 'turnover' | 'direct' | 'wait' | 'late'; children: React.ReactNode }) {
  const map = {
    turnover: 'text-amber-800 bg-amber-50 border-amber-300',
    direct: 'text-[#243b6b] bg-[#eef2fa] border-[#c8d4ea]',
    wait: 'text-red-700 bg-red-50 border-red-200',
    late: 'text-white bg-red-600 border-red-600',
  } as const;
  return (
    <span className={cn('text-[8.5px] font-bold uppercase tracking-wide border rounded-full px-2 py-[2px]', map[tone])}>
      {children}
    </span>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="bg-white border border-surface-border rounded-full px-2.5 py-[3px] font-semibold text-ink-soft">
      {children}
    </span>
  );
}

function IconAction({
  children, onClick, hint, active,
}: { children: React.ReactNode; onClick: () => void; hint: string; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative w-[31px] h-[31px] rounded-lg border flex items-center justify-center transition',
        active ? 'border-amber-300 bg-amber-50 text-amber-600' : 'border-surface-border bg-white text-ink-muted hover:bg-surface-sunken',
      )}
    >
      {children}
      <span className="absolute -bottom-1.5 -right-1 text-[8px] font-mono bg-ink text-white rounded px-1">{hint}</span>
    </button>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block font-mono text-[10px] bg-white border border-surface-border border-b-2 rounded px-1.5 text-ink-soft">
      {children}
    </span>
  );
}

function ShortcutSheet({ onClose }: { onClose: () => void }) {
  const groups: [string, [string, string][]][] = [
    ['Pohyb', [['j / k', 'nahoru a dolů v seznamu'], ['↵', 'do vlákna'], ['esc', 'zpět ze psaní'],
      ['g w', 'čeká na odpověď'], ['g u', 'nepřečtené'], ['g a', 'vše'], ['/', 'hledat']]],
    ['Vlákno', [['r', 'odpovědět'], ['⌘ ↵', 'odeslat'], ['1–3', 'vložit rychlou odpověď'],
      ['s', 'hvězdička'], ['e', 'archivovat a jít dál']]],
    ['Ostatní', [['?', 'tento tahák']]],
  ];
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-[16px]">Klávesové zkratky</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-surface-sunken flex items-center justify-center">
            <X size={16} />
          </button>
        </div>
        {groups.map(([title, rows]) => (
          <div key={title} className="mb-4">
            <p className="text-[10.5px] font-bold uppercase tracking-wider text-ink-muted mb-1.5">{title}</p>
            {rows.map(([k, label]) => (
              <div key={k} className="flex items-center gap-3 py-1 text-[13px] text-ink-soft">
                <Kbd>{k}</Kbd>
                <span>{label}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeOf(iso: string): string {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' });
}

function formatWait(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  return h < 24 ? `${h} h` : `${Math.floor(h / 24)} d`;
}

function systemLine(body?: string | null): string {
  if (!body) return '';
  try {
    const data = JSON.parse(body);
    if (data.event === 'opened') return `Kanál otevřen u ${data.property ?? ''}`;
    if (data.event === 'member_added') return `${data.actor} přidal(a) ${data.target}`;
    return '';
  } catch {
    return body;
  }
}
