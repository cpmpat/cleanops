'use client';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Bell, KanbanSquare, MessageSquare, Plus, Search, PauseCircle, Hourglass, CalendarClock } from 'lucide-react';
import { tasks as tasksApi, announceTasks, type TaskCard, type TaskPerson, type TaskStatus, type TaskNotificationItem } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useLocale } from '@/lib/locale-context';
import { useSocket } from '@/lib/socket';
import { taskStrings, type TaskStrings } from '@/i18n/tasks';
import { cn } from '@/lib/utils';
import { isTyping } from '@/components/office/CommandSearch';
import { AvatarStack, PriorityFlag, STAGE_DOT, ago } from '@/components/office/TaskBits';
import { LinkChip } from '@/components/office/RecordLinker';
import { TaskDrawer } from './TaskDrawer';
import { NewTaskDialog } from './NewTaskDialog';

/**
 * Tasks — the office's Kanban (16 Oct 2026). Six stages; a card shows on whom
 * it is hanging. Drag a card to move it: assignees and managers between the
 * open stages, managers only into or out of Done. `?task=<id>` opens a task.
 */

const STAGES: TaskStatus[] = ['NEW', 'TODO', 'IN_PROGRESS', 'ON_HOLD', 'REVIEW', 'DONE'];

export default function TasksPage() {
  return (
    <Suspense fallback={null}>
      <TasksBoard />
    </Suspense>
  );
}

type Filter = 'all' | 'onMe' | 'watching';

function TasksBoard() {
  const { user } = useAuth();
  const { locale } = useLocale();
  const s = taskStrings[locale] ?? taskStrings.en;
  const router = useRouter();
  const params = useSearchParams();
  const openId = params?.get('task') ?? '';

  const [cards, setCards] = useState<TaskCard[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [doneDays, setDoneDays] = useState(14);
  const [allDone, setAllDone] = useState(false);
  const [people, setPeople] = useState<TaskPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [who, setWho] = useState('');
  const [q, setQ] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs, setNotifs] = useState<TaskNotificationItem[]>([]);
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    try {
      const b = await tasksApi.board(allDone);
      setCards(b.tasks); setCanCreate(b.canCreate); setDoneDays(b.doneDays); setError('');
    } catch (e: any) {
      setError(e?.message ?? 'Could not load tasks');
    } finally {
      setLoading(false);
    }
  }, [allDone]);
  const loadNotifs = useCallback(() => { tasksApi.notifications().then(setNotifs).catch(() => {}); }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { tasksApi.people().then(setPeople).catch(() => {}); loadNotifs(); }, [loadNotifs]);

  // Colleagues' changes arrive over the socket; a burst of them reloads once.
  const timer = useRef<number | undefined>();
  const soon = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void load(); loadNotifs(); announceTasks(); }, 400);
  }, [load, loadNotifs]);
  useSocket({ 'tasks:changed': soon, 'tasks:notification': soon });

  // N opens a new task for those who may create one.
  useEffect(() => {
    if (!canCreate) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'n' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || isTyping(e.target)) return;
      if (openId || showNew) return;
      e.preventDefault(); setShowNew(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canCreate, openId, showNew]);

  const me = user?.id ?? '';
  const visible = useMemo(() => cards.filter((c) => {
    if (filter === 'onMe' && !c.onMe) return false;
    if (filter === 'watching' && !c.watching) return false;
    if (who && !c.assignees.some((a) => a.id === who) && !c.onWhom.includes(who)) return false;
    if (q) {
      const t = q.toLowerCase();
      if (!c.title.toLowerCase().includes(t) && !c.key.toLowerCase().includes(t)) return false;
    }
    return true;
  }), [cards, filter, who, q]);
  const onMeCount = cards.filter((c) => c.onMe).length;
  const unread = notifs.filter((n) => !n.readAt).length;

  function open(id: string) { router.replace(`/tasks?task=${encodeURIComponent(id)}`); }
  function close() { router.replace('/tasks'); }
  function flash(msg: string) { setToast(msg); window.setTimeout(() => setToast(''), 3500); }

  // ── drag and drop ────────────────────────────────────────────────────────
  const [dragId, setDragId] = useState('');
  const [over, setOver] = useState<{ stage: TaskStatus; beforeId: string | null } | null>(null);

  // The server says per card what this viewer may do: close/reopen (the
  // creator) and move between open stages (assignees, task managers).
  function mayMove(c: TaskCard, to: TaskStatus) {
    if (to === 'DONE' || c.status === 'DONE') return c.canClose;
    return c.canMove;
  }

  async function drop(stage: TaskStatus, beforeId: string | null) {
    const card = cards.find((c) => c.id === dragId);
    setDragId(''); setOver(null);
    if (!card) return;
    if (!mayMove(card, stage)) {
      flash(stage === 'DONE' || card.status === 'DONE' ? s.onlyManagersClose : s.dragNotAllowed);
      return;
    }
    // Into an active stage only with someone responsible.
    if (stage !== card.status && ['TODO', 'IN_PROGRESS', 'ON_HOLD', 'REVIEW'].includes(stage) && card.assignees.length === 0) {
      flash(s.needsAssignee);
      return;
    }
    const col = cards.filter((c) => c.status === stage && c.id !== card.id).sort((a, b) => a.rank - b.rank);
    let rank: number;
    if (beforeId) {
      const i = col.findIndex((c) => c.id === beforeId);
      const next = col[i];
      const prev = col[i - 1];
      rank = prev ? (prev.rank + next.rank) / 2 : next.rank - 1;
    } else {
      rank = col.length ? col[col.length - 1].rank + 1 : 0;
    }
    if (card.status === stage && Math.abs(card.rank - rank) < 1e-9) return;
    const before = cards;
    setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, status: stage, rank } : c)));
    try {
      await tasksApi.move(card.id, { status: stage, rank });
      void load(); announceTasks();
    } catch (e: any) {
      setCards(before);
      flash(e?.message ?? 'Could not move');
    }
  }

  return (
    <div className="p-6 pt-4 flex flex-col min-w-0">
      <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
            <KanbanSquare size={22} className="text-ink-muted" /> {s.title}
          </h1>
          <p className="text-sm text-ink-muted mt-0.5">{s.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => { setNotifOpen((o) => !o); }}
              className="relative h-9 w-9 flex items-center justify-center rounded-xl ring-1 ring-black/[0.08] bg-white text-[#3D433E] hover:text-[#1B2420]"
              title={s.notifications}
            >
              <Bell size={16} />
              {unread > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[16px] px-1 rounded-[5px] bg-[#EF4444] text-white text-[10px] font-semibold leading-[16px] text-center">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </button>
            {notifOpen && (
              <NotificationsPanel
                items={notifs}
                locale={locale}
                onClose={() => setNotifOpen(false)}
                onOpen={async (n) => {
                  setNotifOpen(false);
                  open(n.task.id);
                  await tasksApi.markRead({ taskId: n.task.id }).catch(() => {});
                  loadNotifs(); announceTasks();
                }}
                onAllRead={async () => {
                  await tasksApi.markRead({ all: true }).catch(() => {});
                  loadNotifs(); announceTasks();
                }}
              />
            )}
          </div>
          {canCreate && (
            <button
              onClick={() => setShowNew(true)}
              title={s.shortcutHint}
              className="h-9 flex items-center gap-1.5 px-3.5 rounded-xl bg-[#1B2420] text-white text-sm font-semibold hover:bg-black"
            >
              <Plus size={15} /> {s.newTask}
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex items-center gap-2 flex-wrap">
        <div className="flex p-0.5 rounded-xl bg-black/[0.05]">
          {([['all', s.filterAll], ['onMe', `${s.filterOnMe}${onMeCount ? ` · ${onMeCount}` : ''}`], ['watching', s.filterWatching]] as [Filter, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setFilter(k)}
              className={cn('h-8 px-3 rounded-[10px] text-[12.5px] font-semibold transition',
                filter === k ? 'bg-white text-[#1B2420] shadow-[0_1px_2px_rgba(16,24,40,0.08)]' : 'text-[#6A6F69] hover:text-[#1B2420]')}>
              {label}
            </button>
          ))}
        </div>
        <select value={who} onChange={(e) => setWho(e.target.value)}
          className="h-9 px-2.5 rounded-xl ring-1 ring-black/[0.08] bg-white text-[13px] text-[#3D433E] outline-none">
          <option value="">{s.everyone}</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div className="h-9 flex items-center gap-2 px-3 rounded-xl ring-1 ring-black/[0.08] bg-white">
          <Search size={14} className="text-[#6A6F69]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={s.search}
            className="w-44 outline-none text-[13px] placeholder:text-[#6A6F69]" />
        </div>
      </div>

      {error && <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {/* Board */}
      <div className="overflow-x-auto pb-4 -mx-1 px-1">
      <div className="grid grid-cols-6 gap-3 min-w-[1180px] items-start">
        {STAGES.map((stage) => {
          const col = visible.filter((c) => c.status === stage).sort((a, b) => a.rank - b.rank);
          const isOver = over?.stage === stage;
          return (
            <div
              key={stage}
              className={cn('min-w-0 rounded-2xl bg-[#F6F4EF] p-2 transition-colors', isOver && 'bg-[#E9E9EC]')}
              onDragOver={(e) => { if (dragId) { e.preventDefault(); if (!isOver || over?.beforeId !== null) setOver({ stage, beforeId: null }); } }}
              onDrop={(e) => { e.preventDefault(); void drop(stage, over?.stage === stage ? over.beforeId : null); }}
            >
              <div className="px-2 pt-1 pb-2">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: STAGE_DOT[stage] }} />
                  <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[#3D433E]">{s.stage[stage]}</span>
                  <span className="text-[12px] text-[#6A6F69] tabular-nums">{col.length}</span>
                </div>
                <p className="mt-0.5 text-[11px] text-[#6A6F69]">{s.stageHint[stage]}</p>
              </div>
              <div className="space-y-2 min-h-[48px]">
                {col.map((c) => (
                  <div
                    key={c.id}
                    onDragOver={(e) => { if (dragId && dragId !== c.id) { e.preventDefault(); e.stopPropagation(); setOver({ stage, beforeId: c.id }); } }}
                  >
                    {isOver && over?.beforeId === c.id && <div className="h-1 rounded-full bg-[#3B82F6] mb-2" />}
                    <Card
                      card={c}
                      s={s}
                      locale={locale}
                      dragging={dragId === c.id}
                      onDragStart={() => setDragId(c.id)}
                      onDragEnd={() => { setDragId(''); setOver(null); }}
                      onOpen={() => open(c.id)}
                    />
                  </div>
                ))}
                {isOver && over?.beforeId === null && dragId && <div className="h-1 rounded-full bg-[#3B82F6]" />}
                {!loading && col.length === 0 && !isOver && (
                  <p className="py-6 text-center text-[12px] text-[#CFC9BD]">{s.noTasks}</p>
                )}
              </div>
              {stage === 'DONE' && !allDone && (
                <button onClick={() => setAllDone(true)} className="mt-2 w-full text-center text-[11.5px] text-[#6A6F69] hover:text-[#1B2420]">
                  {s.showOlderDone(doneDays)}
                </button>
              )}
            </div>
          );
        })}
      </div>
      </div>

      {showNew && (
        <NewTaskDialog
          people={people}
          s={s}
          onClose={() => setShowNew(false)}
          onCreated={(t) => { setShowNew(false); void load(); announceTasks(); open(t.id); }}
        />
      )}
      {openId && (
        <TaskDrawer
          id={openId}
          people={people}
          me={me}
          s={s}
          locale={locale}
          onClose={close}
          onChanged={() => { void load(); loadNotifs(); announceTasks(); }}
        />
      )}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[90] px-4 py-2.5 rounded-xl bg-[#1B2420] text-white text-sm shadow-lg">{toast}</div>
      )}
    </div>
  );
}

function Card({ card: c, s, locale, dragging, onDragStart, onDragEnd, onOpen }: {
  card: TaskCard; s: TaskStrings; locale: string; dragging: boolean;
  onDragStart: () => void; onDragEnd: () => void; onOpen: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const overdue = !!c.dueDate && c.dueDate < today && c.status !== 'DONE';
  const waiting = c.waitingOn.map((w) => w.user.name.split(' ')[0]);
  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.id); onDragStart(); }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className={cn(
        'group cursor-pointer rounded-xl bg-white p-3 ring-1 ring-black/[0.06] shadow-[0_1px_2px_rgba(16,24,40,0.05)] hover:ring-black/[0.14] transition',
        dragging && 'opacity-40',
        c.onMe && c.status !== 'DONE' && 'ring-2 ring-[#EF4444]/60',
      )}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[11px] font-semibold text-[#6A6F69] tabular-nums">{c.key}</span>
        <PriorityFlag p={c.priority} />
        {c.onMe && c.status !== 'DONE' && (
          <span className="ml-auto px-1.5 h-[18px] leading-[18px] rounded-[5px] bg-[#FEE2E2] text-[#B91C1C] text-[10.5px] font-semibold">{s.onYou}</span>
        )}
      </div>
      <p className={cn('text-[13.5px] leading-snug text-[#1B2420] line-clamp-3', c.status === 'DONE' && 'text-[#6A6F69]', c.resolution === 'WONT_DO' && 'line-through')}>
        {c.title}
      </p>
      {c.status === 'ON_HOLD' && c.holdReason && (
        <p className="mt-1.5 flex items-center gap-1 text-[11.5px] text-[#B45309]"><PauseCircle size={12} /> <span className="truncate">{c.holdReason}</span></p>
      )}
      {c.links.length > 0 && (
        <div className="mt-1.5 flex items-center gap-1 min-w-0">
          <LinkChip link={c.links[0]} s={s} compact />
          {c.links.length > 1 && <span className="text-[11px] text-[#6A6F69] flex-shrink-0">+{c.links.length - 1}</span>}
        </div>
      )}
      {waiting.length > 0 && (
        <p className="mt-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[5px] bg-[#FEF3C7] text-[#92400E] text-[11px] font-medium">
          <Hourglass size={11} /> {s.waitingOn} {waiting.join(', ')}
        </p>
      )}
      <div className="mt-2.5 flex items-center gap-2.5 text-[11.5px] text-[#6A6F69]">
        {c.dueDate && (
          <span className={cn('inline-flex items-center gap-1', overdue && 'text-[#DC2626] font-semibold')} title={overdue ? s.overdue : s.fieldDue}>
            <CalendarClock size={12} /> {new Date(`${c.dueDate}T00:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}
          </span>
        )}
        {c.commentCount > 0 && <span className="inline-flex items-center gap-1"><MessageSquare size={12} /> {c.commentCount}</span>}
        <span className="ml-auto">{c.assignees.length > 0 && <AvatarStack people={c.assignees} />}</span>
      </div>
    </div>
  );
}

function NotificationsPanel({ items, locale, onClose, onOpen, onAllRead }: {
  items: TaskNotificationItem[]; locale: string; onClose: () => void;
  onOpen: (n: TaskNotificationItem) => void; onAllRead: () => void;
}) {
  const s = taskStrings[locale as keyof typeof taskStrings] ?? taskStrings.en;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const t = window.setTimeout(() => document.addEventListener('mousedown', h), 0);
    return () => { window.clearTimeout(t); document.removeEventListener('mousedown', h); };
  }, [onClose]);
  return (
    <div ref={ref} className="absolute right-0 mt-2 z-50 w-[380px] bg-white rounded-2xl shadow-[0_16px_40px_-12px_rgba(16,24,40,0.28)] ring-1 ring-black/[0.08] overflow-hidden">
      <div className="flex items-center justify-between px-4 h-11 border-b border-black/[0.06]">
        <span className="text-[13px] font-semibold text-[#1B2420]">{s.notifications}</span>
        <button onClick={onAllRead} className="text-[12px] text-[#6A6F69] hover:text-[#1B2420]">{s.markAllRead}</button>
      </div>
      <div className="max-h-[60vh] overflow-y-auto">
        {items.length === 0 && <p className="px-4 py-8 text-center text-[13px] text-[#6A6F69]">{s.noNotifications}</p>}
        {items.map((n) => {
          const fmt = s.notif[n.kind] ?? s.notif.comment;
          const text = n.kind === 'status' ? (s.stage[n.text as TaskStatus] ?? n.text ?? '') : (n.text ?? '');
          return (
            <button key={n.id} onClick={() => onOpen(n)}
              className={cn('w-full text-left px-4 py-2.5 border-b border-black/[0.04] hover:bg-[#FBFAF6] flex gap-2.5', !n.readAt && 'bg-[#F8FAFF]')}>
              <span className={cn('mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0', n.readAt ? 'bg-transparent' : 'bg-[#3B82F6]')} />
              <span className="min-w-0">
                <span className="block text-[11.5px] text-[#6A6F69]">{n.task.key} · <span className="text-[#3D433E]">{n.task.title}</span></span>
                <span className="block text-[13px] text-[#1B2420] leading-snug line-clamp-2">{fmt(n.actor?.name ?? '—', text)}</span>
                <span className="block text-[11px] text-[#6A6F69] mt-0.5">{ago(n.createdAt, locale)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
