'use client';
import { useEffect, useMemo, useState } from 'react';
import { useLocale } from '@/lib/locale-context';
import { useAuth } from '@/lib/auth';
import {
  notes as notesApi,
  conversations as conversationsApi,
  users as usersApi,
  properties as propsApi,
  ApiError,
  type ManagerNote,
  type NoteTargetType,
  type User,
  type Property,
} from '@/lib/api';
import { translations } from '@/i18n/translations';
import { useMessageStrings } from '@/i18n/messages';
import { useSocket } from '@/lib/socket';
import { useRouter } from 'next/navigation';
import {
  Mail, Plus, X, Check, Search, AlertTriangle, Users, Building2, Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Manager messages. Publish a short broadcast the cleaning team has to confirm.
 *
 * Two rules the UI has to make obvious, because they are the ones people get
 * wrong: targeting is exclusive (people OR properties), and a property message
 * with nobody on those units yet is NOT delivered — it is waiting.
 */

const BODY_TABS = [
  { key: 'bodyCs', locale: 'cs' as const, label: 'Čeština', required: true },
  { key: 'bodyEn', locale: 'en' as const, label: 'English', required: false },
  { key: 'bodyRu', locale: 'ru' as const, label: 'Русский', required: false },
  { key: 'bodyUk', locale: 'uk' as const, label: 'Українська', required: false },
] as const;

export default function MessagesPage() {
  const { locale } = useLocale();
  const { user } = useAuth();
  const router = useRouter();
  const t = translations[locale];
  const m = useMessageStrings(locale).manager;

  const [list, setList] = useState<ManagerNote[]>([]);
  const [staff, setStaff] = useState<User[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [props, setProps] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [error, setError] = useState('');

  // composer state
  /** Announcement (one-way, confirmed) or a direct chat (two-way). */
  const [mode, setMode] = useState<'ANNOUNCEMENT' | 'DIRECT'>('ANNOUNCEMENT');
  const [targetType, setTargetType] = useState<NoteTargetType>('STAFF');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [title, setTitle] = useState('');
  const [bodies, setBodies] = useState<Record<string, string>>({
    bodyCs: '', bodyEn: '', bodyRu: '', bodyUk: '',
  });
  const [activeTab, setActiveTab] = useState<string>('bodyCs');
  const [validUntil, setValidUntil] = useState(defaultValidUntil());
  const [publishing, setPublishing] = useState(false);

  async function load() {
    try {
      const [notes, users, properties] = await Promise.all([
        notesApi.list(),
        usersApi.list(),
        propsApi.list(),
      ]);
      setList(notes);
      setAllUsers(users);
      setStaff(users.filter((u) => u.role === 'CLEANER'));
      setProps(properties);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.general.error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);
  useSocket({ 'note:changed': () => load() });

  // The warning below is about MY number, and managers are not in `staff`.
  const me = useMemo(
    () => allUsers.find((u) => u.id === user?.id) ?? user,
    [allUsers, user],
  );

  const pool = targetType === 'STAFF' ? staff : props;
  const filteredPool = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return pool as any[];
    return (pool as any[]).filter((item) =>
      [item.name, item.email, item.address]
        .filter(Boolean)
        .some((v: string) => v.toLowerCase().includes(q)),
    );
  }, [pool, search]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function switchTarget(next: NoteTargetType) {
    // Exclusive targeting: switching wipes the other side's selection so a
    // half-remembered pick can never ride along.
    setTargetType(next);
    setSelected(new Set());
    setSearch('');
  }

  function resetComposer() {
    setComposerOpen(false);
    setSelected(new Set());
    setSearch('');
    setTitle('');
    setBodies({ bodyCs: '', bodyEn: '', bodyRu: '', bodyUk: '' });
    setActiveTab('bodyCs');
    setValidUntil(defaultValidUntil());
  }

  async function publish() {
    setPublishing(true);
    setError('');
    try {
      // A direct chat is a different object with different rules, so it gets
      // its own call rather than a flag on the announcement.
      if (mode === 'DIRECT') {
        const chat = await conversationsApi.openDirect({
          userIds: Array.from(selected),
          title: title.trim() || undefined,
          body: bodies.bodyCs.trim() || undefined,
        });
        resetComposer();
        router.push(`/conversations/${chat.id}`);
        return;
      }

      await notesApi.create({
        targetType,
        title: title.trim(),
        bodyCs: bodies.bodyCs.trim(),
        bodyEn: bodies.bodyEn.trim() || undefined,
        bodyRu: bodies.bodyRu.trim() || undefined,
        bodyUk: bodies.bodyUk.trim() || undefined,
        validUntil: new Date(`${validUntil}T23:59:59`).toISOString(),
        ...(targetType === 'STAFF'
          ? { userIds: Array.from(selected) }
          : { propertyIds: Array.from(selected) }),
      });
      resetComposer();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.general.error);
    } finally {
      setPublishing(false);
    }
  }

  async function archive(id: string) {
    if (!confirm(m.archiveConfirm)) return;
    try {
      await notesApi.archive(id);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.general.error);
    }
  }

  const canPublish =
    mode === 'DIRECT'
      ? selected.size > 0 && (!!bodies.bodyCs.trim() || !!title.trim())
      : !!title.trim() && !!bodies.bodyCs.trim() && selected.size > 0 && !!validUntil;

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink">{m.title}</h1>
          <p className="text-sm text-ink-muted mt-0.5">{m.subtitle}</p>
        </div>
        {!composerOpen && (
          <button
            onClick={() => setComposerOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-ink text-white rounded-xl text-sm font-semibold hover:bg-ink-soft transition"
          >
            <Plus size={15} />
            {m.newMessage}
          </button>
        )}
      </div>

      {!me?.mobileNumber && (
        <div className="flex gap-2.5 items-start bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 mb-4 text-sm text-amber-900">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <p>{m.noPhoneWarning}</p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {/* ─── Composer ─────────────────────────────────────────────────────── */}
      {composerOpen && (
        <div className="bg-white border border-surface-border rounded-2xl p-5 mb-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-bold text-ink">{m.newMessage}</h2>
            <button
              onClick={resetComposer}
              className="w-8 h-8 rounded-full hover:bg-surface-sunken flex items-center justify-center"
            >
              <X size={16} />
            </button>
          </div>
          <p className="text-xs text-ink-muted mb-4">{m.targetHint}</p>

          {/* What kind of message this is. It decides whether people can reply
              and whether a confirmation is expected — not a detail, a different
              kind of thing. */}
          <div className="flex gap-2 mb-4">
            {([
              ['ANNOUNCEMENT', 'Oznámení', 'Jednosměrné, potvrzuje se'],
              ['DIRECT', 'Přímý chat', 'Obousměrný, bez potvrzení'],
            ] as const).map(([key, label, hint]) => (
              <button
                key={key}
                onClick={() => { setMode(key); if (key === 'DIRECT') switchTarget('STAFF'); }}
                className={cn(
                  'flex-1 text-left border rounded-xl p-3 transition',
                  mode === key
                    ? 'border-2 border-[#243b6b] bg-[#eef2fa]'
                    : 'border-surface-border hover:bg-surface-sunken',
                )}
              >
                <span className={cn('block text-sm font-bold', mode === key ? 'text-[#1b2d54]' : 'text-ink-muted')}>
                  {label}
                </span>
                <span className="block text-[11px] text-ink-muted mt-1">{hint}</span>
              </button>
            ))}
          </div>

          {/* exclusive target switch */}
          <div className={cn('flex bg-surface-sunken rounded-xl p-1 mb-4', mode === 'DIRECT' && 'hidden')}>
            {(['STAFF', 'PROPERTY'] as NoteTargetType[]).map((tt) => (
              <button
                key={tt}
                onClick={() => switchTarget(tt)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 text-sm font-semibold py-2 rounded-lg transition',
                  targetType === tt
                    ? 'bg-white text-ink shadow-sm'
                    : 'text-ink-muted hover:text-ink',
                )}
              >
                {tt === 'STAFF' ? <Users size={14} /> : <Building2 size={14} />}
                {tt === 'STAFF' ? m.targetStaff : m.targetProperty}
              </button>
            ))}
          </div>

          {/* recipients */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
                {targetType === 'STAFF' ? m.pickPeople : m.pickProperties}
              </label>
              <div className="flex items-center gap-3">
                {selected.size > 0 && (
                  <span className="text-xs text-ink-muted">
                    {m.selectedCount(selected.size)}
                  </span>
                )}
                {/* Whole team in one tap — the common case for a broadcast.
                    This is a snapshot: someone hired tomorrow is not on it. */}
                <button
                  onClick={() =>
                    setSelected(
                      selected.size === filteredPool.length
                        ? new Set()
                        : new Set(filteredPool.map((i: any) => i.id)),
                    )
                  }
                  className="text-xs font-semibold text-accent hover:underline"
                >
                  {selected.size === filteredPool.length && filteredPool.length > 0
                    ? m.clearAll
                    : m.selectAll}
                </button>
              </div>
            </div>
            <div className="relative mb-2">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={targetType === 'STAFF' ? m.searchPeople : m.searchProperties}
                className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-surface-border focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div className="max-h-52 overflow-y-auto border border-surface-border rounded-xl divide-y divide-surface-border">
              {filteredPool.map((item: any) => {
                const on = selected.has(item.id);
                return (
                  <button
                    key={item.id}
                    onClick={() => toggle(item.id)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 text-left transition',
                      on ? 'bg-accent-soft' : 'hover:bg-surface-sunken',
                    )}
                  >
                    <span
                      className={cn(
                        'w-[18px] h-[18px] rounded border-2 flex items-center justify-center flex-shrink-0',
                        on ? 'bg-ink border-ink text-white' : 'border-surface-border',
                      )}
                    >
                      {on && <Check size={11} strokeWidth={3} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm text-ink truncate">{item.name}</span>
                      <span className="block text-xs text-ink-muted truncate">
                        {item.email ?? item.address ?? ''}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* subject */}
          <div className="mb-4">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-ink-muted mb-1.5">
              {m.titleField}
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={m.titlePlaceholder}
              className="w-full px-3 py-2 text-sm rounded-xl border border-surface-border focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          {/* body, Czech mandatory */}
          <div className="mb-4">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-ink-muted mb-1.5">
              {m.bodyLabel}
            </label>
            <div className="flex gap-1.5 mb-2 flex-wrap">
              {BODY_TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    'text-xs px-3 py-1.5 rounded-full font-medium transition',
                    activeTab === tab.key
                      ? 'bg-ink text-white'
                      : 'bg-surface-sunken text-ink-muted hover:text-ink',
                  )}
                >
                  {tab.label}
                  {!tab.required && bodies[tab.key]?.trim() && ' ✓'}
                </button>
              ))}
            </div>
            <textarea
              value={bodies[activeTab] ?? ''}
              onChange={(e) => setBodies({ ...bodies, [activeTab]: e.target.value })}
              rows={4}
              className="w-full px-3 py-2 text-sm rounded-xl border border-surface-border focus:outline-none focus:ring-2 focus:ring-accent resize-y"
            />
            <p className="text-[11px] text-ink-muted mt-1">
              {activeTab === 'bodyCs' ? m.czechRequired : m.optional}
            </p>
          </div>

          {/* validity — announcements only; a chat does not expire */}
          <div className={cn('mb-5', mode === 'DIRECT' && 'hidden')}>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-ink-muted mb-1.5">
              {m.validUntilField}
            </label>
            <input
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              className="px-3 py-2 text-sm rounded-xl border border-surface-border focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <p className="text-[11px] text-ink-muted mt-1">{m.validUntilHint}</p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={publish}
              disabled={!canPublish || publishing}
              className="px-5 py-2.5 bg-ink text-white rounded-xl text-sm font-semibold hover:bg-ink-soft transition disabled:opacity-40"
            >
              {publishing ? m.publishing : mode === 'DIRECT' ? 'Otevřít chat' : m.publish}
            </button>
            <button
              onClick={resetComposer}
              className="px-5 py-2.5 bg-white border border-surface-border text-ink rounded-xl text-sm font-semibold hover:bg-surface-sunken transition"
            >
              {m.cancel}
            </button>
          </div>
        </div>
      )}

      {/* ─── Published messages ───────────────────────────────────────────── */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-28 bg-white rounded-2xl border border-surface-border animate-pulse" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="text-center py-14 bg-white rounded-2xl border border-surface-border">
          <Mail size={30} className="mx-auto text-ink-faint mb-3" />
          <p className="text-sm font-semibold text-ink">{m.empty}</p>
          <p className="text-xs text-ink-muted mt-1 max-w-sm mx-auto">{m.emptyHint}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((n) => (
            <div key={n.id} className="bg-white border border-surface-border rounded-2xl overflow-hidden">
              <div className="h-1 bg-[#243b6b]" />
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-ink">{n.title}</p>
                    <p className="text-xs text-ink-muted mt-0.5">
                      {n.author.email} ·{' '}
                      {new Date(n.createdAt).toLocaleDateString()} ·{' '}
                      <span className="inline-flex items-center gap-1">
                        <Clock size={10} />
                        {m.expiresOn(new Date(n.validUntil).toLocaleDateString())}
                      </span>
                      {n.version > 1 && ` · v${n.version}`}
                    </p>
                  </div>
                  <button
                    onClick={() => archive(n.id)}
                    className="text-xs text-ink-muted hover:text-red-600 underline flex-shrink-0"
                  >
                    {m.archive}
                  </button>
                </div>

                <p className="text-sm text-ink-soft mt-2 whitespace-pre-line">{n.bodyCs}</p>

                <div className="flex flex-wrap gap-1.5 mt-3">
                  {n.targets.map((tg) => (
                    <span
                      key={tg.id}
                      className="inline-flex items-center gap-1 text-[11px] bg-surface-sunken text-ink-soft rounded-full px-2.5 py-1"
                    >
                      {n.targetType === 'STAFF' ? <Users size={10} /> : <Building2 size={10} />}
                      {tg.user?.name ?? tg.property?.name ?? '—'}
                    </span>
                  ))}
                </div>

                {n.awaitingRecipients ? (
                  <div className="flex gap-2 items-start bg-amber-50 border border-amber-300 rounded-xl px-3 py-2 mt-3 text-[12.5px] text-amber-900">
                    <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                    <p>{m.awaitingRecipients}</p>
                  </div>
                ) : (
                  <RecipientList note={n} m={m} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Everyone the message reached, in one list.
 *
 * It used to be a count plus a comma-separated tail of names, which meant
 * cross-referencing two things by eye. One list, sorted so the people who
 * still owe you a confirmation are on top, and the state carried by the whole
 * row rather than an icon at the end — at fifty cleaners the row tint is the
 * only thing that survives a glance.
 */
function RecipientList({ note, m }: { note: ManagerNote; m: any }) {
  const ackedAt = new Map<string, string>();
  note.acks
    .filter((a) => a.version === note.version)
    .forEach((a) => ackedAt.set(a.userId, a.ackedAt));

  // Pending first: that is the part that still needs chasing.
  const rows = [...note.recipients].sort((a, b) => {
    const aAck = ackedAt.has(a.id) ? 1 : 0;
    const bAck = ackedAt.has(b.id) ? 1 : 0;
    if (aAck !== bAck) return aAck - bAck;
    return a.name.localeCompare(b.name);
  });

  const done = note.ackedCount;
  const total = note.recipientCount || 1;

  return (
    <div className="mt-3">
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 rounded-full bg-surface-sunken overflow-hidden">
          <div
            className="h-full bg-emerald-600 transition-all"
            style={{ width: `${Math.round((done / total) * 100)}%` }}
          />
        </div>
        <span className="text-[12.5px] font-bold whitespace-nowrap">
          {done === note.recipientCount ? m.allConfirmed : m.acked(done, note.recipientCount)}
        </span>
      </div>

      <div className="mt-2.5 border border-surface-border rounded-xl overflow-hidden divide-y divide-surface-border">
        {rows.map((r) => {
          const at = ackedAt.get(r.id);
          return (
            <div
              key={r.id}
              className={cn(
                'flex items-center gap-3 px-3 py-2',
                at ? 'bg-emerald-50/60' : 'bg-white',
              )}
            >
              <span className="w-6 h-6 rounded-full bg-ink text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                {(r.name?.[0] ?? '?').toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-semibold truncate">{r.name}</span>
                <span className="block text-[10.5px] text-ink-faint truncate">{r.email}</span>
              </span>
              {at ? (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-700 whitespace-nowrap">
                  <Check size={12} strokeWidth={3} />
                  {new Date(at).toLocaleString(undefined, {
                    day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </span>
              ) : (
                <span className="text-[11px] text-ink-faint whitespace-nowrap">
                  {m.pendingLabel.replace(':', '')}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Two weeks out — long enough to be useful, short enough to expire. */
function defaultValidUntil(): string {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
