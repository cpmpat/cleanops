'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, X, Hourglass, CheckCircle2, Ban, RotateCcw, Send, Loader2, ArrowRightCircle, PauseCircle } from 'lucide-react';
import { tasks as tasksApi, type TaskDetail, type TaskPerson, type TaskPriority, type TaskStatus } from '@/lib/api';
import type { TaskStrings } from '@/i18n/tasks';
import { Avatar, PeoplePicker, PriorityFlag, STAGE_DOT, ago } from '@/components/office/TaskBits';
import { LinkChip, RecordPicker } from '@/components/office/RecordLinker';
import { cn } from '@/lib/utils';

const STAGES: TaskStatus[] = ['NEW', 'TODO', 'IN_PROGRESS', 'ON_HOLD', 'REVIEW', 'DONE'];
const PRIORITIES: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
/** Stages in which the task must keep at least one assignee. */
const ACTIVE: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'ON_HOLD', 'REVIEW'];

/** Accents ignored when matching a typed @name. */
const fold = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function TaskDrawer({ id, people, me, s, locale, onClose, onChanged }: {
  id: string; people: TaskPerson[]; me: string; s: TaskStrings; locale: string;
  onClose: () => void; onChanged: () => void;
}) {
  const [t, setT] = useState<TaskDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setT(await tasksApi.get(id)); setError(''); }
    catch (e: any) { setError(e?.message ?? 'Could not load'); }
  }, [id]);

  useEffect(() => {
    setT(null); void load();
    // Opening a task reads its notifications.
    tasksApi.markRead({ taskId: id }).then(() => onChanged()).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') && (el as HTMLInputElement).value) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function act(fn: () => Promise<TaskDetail | unknown>) {
    setBusy(true); setError('');
    try {
      const r = await fn();
      if (r && typeof r === 'object' && 'id' in (r as any) && 'can' in (r as any)) setT(r as TaskDetail);
      else await load();
      onChanged();
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const byId = useMemo(() => {
    const m = new Map<string, TaskPerson>();
    for (const p of people) m.set(p.id, p);
    if (t) {
      for (const p of [t.createdBy, ...t.assignees, ...t.watchers, ...t.comments.map((c) => c.author), ...t.waits.map((w) => w.user)]) m.set(p.id, p);
    }
    return m;
  }, [people, t]);
  const name = (uid: string) => byId.get(uid)?.name ?? '—';

  const thread = useMemo(() => {
    if (!t) return [];
    const items: ({ type: 'comment'; at: string; c: TaskDetail['comments'][number] } | { type: 'event'; at: string; e: TaskDetail['events'][number] })[] = [
      ...t.comments.map((c) => ({ type: 'comment' as const, at: c.createdAt, c })),
      ...t.events.map((e) => ({ type: 'event' as const, at: e.createdAt, e })),
    ];
    return items.sort((a, b) => a.at.localeCompare(b.at));
  }, [t]);

  function eventText(e: TaskDetail['events'][number]) {
    const d = e.data ?? {};
    const res = (r: string | null) => (r === 'WONT_DO' ? s.wontDo : s.stage.DONE.toLowerCase());
    switch (e.kind) {
      case 'created': return s.event.created;
      case 'moved': return s.event.moved(s.stage[d.from as TaskStatus] ?? d.from, s.stage[d.to as TaskStatus] ?? d.to);
      case 'assigned': return s.event.assigned((d.added ?? []).map(name).join(', '), (d.removed ?? []).map(name).join(', '));
      case 'closed': return s.event.closed(res(d.resolution));
      case 'reopened': return s.event.reopened;
      case 'edited': return s.event.edited((d.fields ?? []).map((f: string) => ({
        title: s.fieldTitle, description: s.fieldDescription, priority: s.fieldPriority, dueDate: s.fieldDue, holdReason: s.fieldHoldReason,
      } as Record<string, string>)[f] ?? f).join(', ').toLowerCase());
      case 'waiting': return s.event.waiting(name(d.userId));
      case 'wait_cleared': return s.event.wait_cleared(name(d.userId));
      case 'linked':
      case 'unlinked': {
        const l = t?.links.find((x) => x.dataset === d.dataset && x.rowId === d.rowId);
        const what = l?.visible ? [l.title, l.fieldLabel].filter(Boolean).join(' · ') : (l ? s.restricted : d.dataset);
        return e.kind === 'linked' ? s.event.linked(what) : s.event.unlinked(what);
      }
      default: return e.kind;
    }
  }

  const openWaits = t?.waits.filter((w) => !w.resolvedAt) ?? [];
  const label = 'text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6A6F69] mb-1.5';

  return (
    <div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true">
      <button aria-label="Close" className="absolute inset-0 bg-[#1B2420]/20" onClick={onClose} />
      <div className="relative h-full w-full max-w-[940px] bg-white shadow-[-24px_0_64px_-24px_rgba(16,24,40,0.3)] flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 h-14 border-b border-black/[0.06] flex-shrink-0">
          {t && <span className="text-[12px] font-semibold text-[#6A6F69] tabular-nums">{t.key}</span>}
          {t && (
            <span className="inline-flex items-center gap-1.5 px-2 h-6 rounded-[6px] bg-[#F6F4EF] text-[12px] font-medium text-[#3D433E]">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: STAGE_DOT[t.status] }} />{s.stage[t.status]}
            </span>
          )}
          {busy && <Loader2 size={14} className="animate-spin text-[#6A6F69]" />}
          <div className="ml-auto flex items-center gap-1.5">
            {t && (
              <button
                onClick={() => act(() => tasksApi.watch(t.id, !t.watching))}
                className={cn('h-8 flex items-center gap-1.5 px-2.5 rounded-lg text-[12.5px] font-medium ring-1 transition',
                  t.watching ? 'ring-[#1B2420] text-[#1B2420]' : 'ring-black/[0.08] text-[#3D433E] hover:text-[#1B2420]')}
              >
                {t.watching ? <Eye size={14} /> : <EyeOff size={14} />} {t.watching ? s.watching : s.watch}
                <span className="text-[#6A6F69]">· {t.watchers.length}</span>
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg text-[#6A6F69] hover:text-[#1B2420] hover:bg-black/[0.05]"><X size={18} /></button>
          </div>
        </div>

        {error && <p className="mx-6 mt-3 rounded-xl bg-coral-soft px-4 py-2.5 text-sm text-coral-deep">{error}</p>}
        {!t ? (
          <div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-[#6A6F69]" /></div>
        ) : (
          <div className="flex-1 min-h-0 flex">
            {/* Main column */}
            <div className="flex-1 min-w-0 flex flex-col">
              <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
                <EditableTitle value={t.title} editable={t.can.edit} onSave={(v) => act(() => tasksApi.update(t.id, { title: v }))} />
                <EditableDescription value={t.description} editable={t.can.edit} s={s}
                  onSave={(v) => act(() => tasksApi.update(t.id, { description: v }))} />

                <LinkedRecords t={t} me={me} s={s} label={label} act={act} />

                <p className={cn(label, 'mt-7')}>{s.thread}</p>
                <ol className="space-y-3">
                  {thread.map((it) => it.type === 'event' ? (
                    <li key={`e${it.e.id}`} className="flex items-center gap-2 text-[12px] text-[#6A6F69] pl-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#DCD6CB]" />
                      <span><span className="text-[#3D433E] font-medium">{it.e.actor.name}</span> {eventText(it.e)}</span>
                      <span>· {ago(it.e.createdAt, locale)}</span>
                    </li>
                  ) : (
                    <li key={`c${it.c.id}`} className="flex gap-3">
                      <Avatar person={it.c.author} size={28} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px]"><span className="font-semibold text-[#1B2420]">{it.c.author.name}</span>
                          <span className="text-[#6A6F69]"> · {ago(it.c.createdAt, locale)}</span></p>
                        <div className="mt-1 rounded-xl rounded-tl-sm bg-[#F6F4EF] px-3 py-2 text-[13.5px] text-[#1B2420] whitespace-pre-wrap break-words">
                          <Mentioned body={it.c.body} names={it.c.mentionIds.map(name)} me={byId.get(me)?.name} />
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
              <Composer people={people.filter((p) => p.id !== me)} s={s} disabled={busy}
                onSend={(body, ids, waitOn) => act(() => tasksApi.comment(t.id, body, ids, waitOn))} />
            </div>

            {/* Side column */}
            <aside className="w-[280px] flex-shrink-0 border-l border-black/[0.06] overflow-y-auto px-5 py-5 space-y-5 bg-[#FCFCFC]">
              {/* Now on */}
              {t.status !== 'DONE' && (
                <div className={cn('rounded-xl p-3 ring-1', t.onMe ? 'bg-[#FBE3DD] ring-[#FECACA]' : 'bg-white ring-black/[0.06]')}>
                  <p className={label}>{s.nowOn}</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    {t.onWhom.map((uid) => (
                      <span key={uid} className="inline-flex items-center gap-1.5 text-[13px] text-[#1B2420]">
                        <Avatar person={{ id: uid, name: name(uid) }} size={22} />{uid === me ? `${name(uid)} (${s.onYou.toLowerCase()})` : name(uid)}
                      </span>
                    ))}
                  </div>
                  <p className="mt-1 text-[11.5px] text-[#6A6F69]">{s.reason[t.onWhomReason]}</p>
                  {/* Whose turn it is can move; who answers for the task does not. */}
                  {t.onWhomReason === 'waiting' && t.assignees.length > 0 && (
                    <p className="mt-2 pt-2 border-t border-black/[0.06] text-[11.5px] text-[#3D433E]">
                      {s.responsible}: <span className="text-[#1B2420] font-medium">{t.assignees.map((a) => a.name).join(', ')}</span>
                    </p>
                  )}
                </div>
              )}

              {/* Stage + actions */}
              <div>
                <p className={label}>{s.fieldStage}</p>
                <select
                  value={t.status}
                  disabled={!t.can.move && !t.can.close}
                  onChange={(e) => {
                    const to = e.target.value as TaskStatus;
                    if (ACTIVE.includes(to) && t.assignees.length === 0) { setError(s.needsAssignee); return; }
                    void act(() => tasksApi.move(t.id, { status: to }));
                  }}
                  className="w-full h-9 px-2.5 rounded-lg ring-1 ring-black/[0.08] bg-white text-[13px] outline-none disabled:opacity-70"
                >
                  {STAGES.map((st) => (
                    <option key={st} value={st}
                      disabled={(st === 'DONE' || t.status === 'DONE') ? !t.can.close && st !== t.status : !t.can.move && st !== t.status}>
                      {s.stage[st]}
                    </option>
                  ))}
                </select>
                <div className="mt-2 flex flex-col gap-1.5">
                  {t.can.move && ['TODO', 'IN_PROGRESS', 'ON_HOLD'].includes(t.status) && (
                    <button onClick={() => act(() => tasksApi.move(t.id, { status: 'REVIEW' }))}
                      className="h-8 flex items-center justify-center gap-1.5 rounded-lg ring-1 ring-black/[0.1] bg-white text-[12.5px] font-semibold text-[#5B21B6] hover:bg-[#F5F3FF]">
                      <ArrowRightCircle size={14} /> {s.sendToReview}
                    </button>
                  )}
                  {t.can.close && t.status !== 'DONE' && (
                    <>
                      <button onClick={() => act(() => tasksApi.move(t.id, { status: 'DONE', resolution: 'DONE' }))}
                        className="h-8 flex items-center justify-center gap-1.5 rounded-lg bg-[#16A34A] text-white text-[12.5px] font-semibold hover:bg-[#15803D]">
                        <CheckCircle2 size={14} /> {s.closeDone}
                      </button>
                      <button onClick={() => act(() => tasksApi.move(t.id, { status: 'DONE', resolution: 'WONT_DO' }))}
                        className="h-8 flex items-center justify-center gap-1.5 rounded-lg ring-1 ring-black/[0.1] bg-white text-[12.5px] font-semibold text-[#3D433E] hover:text-[#1B2420]">
                        <Ban size={14} /> {s.closeWontDo}
                      </button>
                    </>
                  )}
                  {t.status === 'DONE' && (
                    <p className="text-[12px] text-[#6A6F69]">
                      {s.closedAs(t.resolution === 'WONT_DO' ? s.wontDo : s.stage.DONE.toLowerCase(), t.closedBy?.name ?? '—')}
                    </p>
                  )}
                  {t.status === 'DONE' && t.can.close && (
                    <button onClick={() => (t.assignees.length ? act(() => tasksApi.move(t.id, { status: 'TODO' })) : setError(s.needsAssignee))}
                      className="h-8 flex items-center justify-center gap-1.5 rounded-lg ring-1 ring-black/[0.1] bg-white text-[12.5px] font-semibold text-[#3D433E] hover:text-[#1B2420]">
                      <RotateCcw size={14} /> {s.reopen}
                    </button>
                  )}
                </div>
              </div>

              {t.status === 'ON_HOLD' && (
                <div>
                  <p className={label}>{s.fieldHoldReason}</p>
                  <InlineText value={t.holdReason ?? ''} editable={t.can.edit} placeholder={s.holdReasonPlaceholder}
                    icon={<PauseCircle size={13} className="text-[#8A5A12]" />}
                    onSave={(v) => act(() => tasksApi.update(t.id, { holdReason: v || null }))} />
                </div>
              )}

              {/* Waiting on */}
              <div>
                <p className={label}>{s.waitingOn}</p>
                <div className="space-y-1.5">
                  {openWaits.map((w) => (
                    <div key={w.id} className="flex items-center gap-2 rounded-lg bg-[#FFFBEB] ring-1 ring-[#FDE68A] px-2 py-1.5">
                      <Hourglass size={12} className="text-[#8A5A12] flex-shrink-0" />
                      <Avatar person={w.user} size={20} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12.5px] text-[#1B2420] truncate">{w.user.name}</span>
                        <span className="block text-[10.5px] text-[#8A5A12]">{w.requestedBy.name} · {ago(w.createdAt, locale)}</span>
                      </span>
                      {(w.requestedBy.id === me || t.can.edit) && (
                        <button onClick={() => act(() => tasksApi.clearWait(t.id, w.id))} className="text-[11px] text-[#8A5A12] hover:underline">{s.clear}</button>
                      )}
                    </div>
                  ))}
                  {t.status !== 'DONE' && (
                    <PeoplePicker compact multi={false} people={people.filter((p) => p.id !== me && !openWaits.some((w) => w.user.id === p.id))}
                      value={[]} placeholder={s.askSomeone}
                      onChange={(ids) => ids[0] && act(() => tasksApi.addWait(t.id, ids[0]))} />
                  )}
                </div>
              </div>

              <div>
                <p className={label}>{s.fieldAssignees}</p>
                <PeoplePicker people={people} value={t.assignees.map((a) => a.id)} disabled={!t.can.assign} placeholder={s.nobody}
                  onChange={(ids) => {
                    if (ACTIVE.includes(t.status) && ids.length === 0) { setError(s.lastAssignee); return; }
                    void act(() => tasksApi.setAssignees(t.id, ids));
                  }} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className={label}>{s.fieldPriority}</p>
                  {t.can.edit ? (
                    <select value={t.priority} onChange={(e) => act(() => tasksApi.update(t.id, { priority: e.target.value as TaskPriority }))}
                      className="w-full h-8 px-2 rounded-lg ring-1 ring-black/[0.08] bg-white text-[12.5px] outline-none">
                      {PRIORITIES.map((p) => <option key={p} value={p}>{s.priority[p]}</option>)}
                    </select>
                  ) : <PriorityFlag p={t.priority} label={s.priority[t.priority]} />}
                </div>
                <div>
                  <p className={label}>{s.fieldDue}</p>
                  {t.can.edit ? (
                    <input type="date" value={t.dueDate ?? ''} onChange={(e) => act(() => tasksApi.update(t.id, { dueDate: e.target.value || null }))}
                      className="w-full h-8 px-1.5 rounded-lg ring-1 ring-black/[0.08] bg-white text-[12.5px] outline-none" />
                  ) : <span className="text-[13px] text-[#1B2420]">{t.dueDate ?? '—'}</span>}
                </div>
              </div>

              <div>
                <p className={label}>{s.fieldCreatedBy}</p>
                <span className="inline-flex items-center gap-1.5 text-[13px] text-[#1B2420]">
                  <Avatar person={t.createdBy} size={20} />{t.createdBy.name}
                  <span className="text-[#6A6F69] text-[11.5px]">· {ago(t.createdAt, locale)}</span>
                </span>
              </div>

              <div>
                <p className={label}>{s.fieldWatchers}</p>
                <div className="flex flex-wrap gap-1.5">
                  {t.watchers.map((w) => (
                    <span key={w.id} className="inline-flex items-center gap-1 pl-0.5 pr-2 py-0.5 rounded-full bg-[#F6F4EF] text-[12px] text-[#3D433E]">
                      <Avatar person={w} size={18} />{w.name}
                    </span>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

/** The records the task is about: chips that open them on Data, and a picker to add more. */
function LinkedRecords({ t, me, s, label, act }: {
  t: TaskDetail; me: string; s: TaskStrings; label: string; act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  if (!t.links.length && !t.can.link) return null;
  return (
    <div className="mt-5">
      <div className="flex items-center justify-between">
        <p className={label}>{s.fieldRecords}</p>
        {t.can.link && !adding && (
          <button onClick={() => setAdding(true)} className="text-[12px] text-[#3D433E] hover:text-[#1B2420] mb-1.5">+ {s.linkRecord}</button>
        )}
      </div>
      {t.links.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {t.links.map((l) => (
            <LinkChip key={l.id} link={l} s={s}
              onRemove={t.linkAuthors[l.id] === me || t.can.edit ? () => void act(() => tasksApi.removeLink(t.id, l.id)) : undefined} />
          ))}
        </div>
      )}
      {adding && (
        <RecordPicker s={s} exclude={t.links}
          onAdd={async (l) => { await act(() => tasksApi.addLink(t.id, { dataset: l.dataset, rowId: l.rowId, field: l.field })); setAdding(false); }} />
      )}
    </div>
  );
}

/** A comment with its @names highlighted; my own name stands out. */
function Mentioned({ body, names, me }: { body: string; names: string[]; me?: string }) {
  const list = Array.from(new Set(names.filter((n) => n && n !== "—"))).sort((a, b) => b.length - a.length);
  if (!list.length) return <>{body}</>;
  const re = new RegExp(`(@(?:${list.map(esc).join('|')}))`, 'g');
  return (
    <>
      {body.split(re).map((part, i) => part.startsWith('@') && list.includes(part.slice(1)) ? (
        <span key={i} className={cn('font-semibold rounded px-0.5', part.slice(1) === me ? 'bg-[#F8EBD3] text-[#8A5A12]' : 'text-[#1F4D3A]')}>{part}</span>
      ) : <span key={i}>{part}</span>)}
    </>
  );
}

function EditableTitle({ value, editable, onSave }: { value: string; editable: boolean; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  if (!editable) return <h2 className="text-[22px] font-bold text-[#1B2420] leading-tight">{value}</h2>;
  return (
    <input value={v} onChange={(e) => setV(e.target.value)} maxLength={200}
      onBlur={() => { if (v.trim() && v.trim() !== value) onSave(v.trim()); else setV(value); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className="w-full text-[22px] font-bold text-[#1B2420] leading-tight outline-none rounded-lg -mx-1.5 px-1.5 py-0.5 hover:bg-[#F6F4EF] focus:bg-[#F6F4EF]" />
  );
}

function EditableDescription({ value, editable, onSave, s }: { value: string | null; editable: boolean; onSave: (v: string | null) => void; s: TaskStrings }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value ?? '');
  useEffect(() => setV(value ?? ''), [value]);
  if (editing) {
    return (
      <div className="mt-3">
        <textarea autoFocus value={v} onChange={(e) => setV(e.target.value)} rows={6}
          className="w-full px-3 py-2 rounded-lg ring-1 ring-black/[0.12] outline-none text-[13.5px] resize-y" />
        <div className="mt-1.5 flex gap-2">
          <button onClick={() => { onSave(v.trim() || null); setEditing(false); }} className="h-8 px-3 rounded-lg bg-accent hover:bg-accent-hover text-white text-[12.5px] font-semibold">{s.save}</button>
          <button onClick={() => { setV(value ?? ''); setEditing(false); }} className="h-8 px-3 rounded-lg text-[12.5px] text-[#3D433E] hover:bg-black/[0.05]">{s.cancel}</button>
        </div>
      </div>
    );
  }
  return (
    <div className={cn('mt-3 group rounded-lg -mx-1.5 px-1.5 py-1', editable && 'hover:bg-[#FBFAF6] cursor-text')} onClick={() => editable && setEditing(true)}>
      {value
        ? <p className="text-[13.5px] text-[#3D433E] whitespace-pre-wrap leading-relaxed">{value}</p>
        : <p className="text-[13px] text-[#6A6F69]">{editable ? `${s.fieldDescription}…` : '—'}</p>}
    </div>
  );
}

function InlineText({ value, editable, placeholder, onSave, icon }: { value: string; editable: boolean; placeholder: string; onSave: (v: string) => void; icon?: React.ReactNode }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <div className="flex items-center gap-1.5 rounded-lg ring-1 ring-black/[0.08] bg-white px-2 h-8">
      {icon}
      <input value={v} disabled={!editable} placeholder={placeholder} onChange={(e) => setV(e.target.value)}
        onBlur={() => { if (v !== value) onSave(v.trim()); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className="flex-1 min-w-0 outline-none text-[12.5px] bg-transparent placeholder:text-[#CFC9BD]" />
    </div>
  );
}

/**
 * The reply box. Typing @ opens a list of colleagues; picking one inserts
 * @Name and, on send, notifies them. A tag alone does not put the task on
 * anyone: under the box each tagged person has an unticked "put the task on
 * them" — the writer decides (16 Oct 2026). Ctrl/⌘+Enter sends.
 */
function Composer({ people, s, disabled, onSend }: {
  people: TaskPerson[]; s: TaskStrings; disabled: boolean;
  onSend: (body: string, mentionIds: string[], waitOnIds: string[]) => Promise<unknown> | void;
}) {
  const [waitOn, setWaitOn] = useState<string[]>([]);
  const [body, setBody] = useState('');
  const [query, setQuery] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const [tagged, setTagged] = useState<TaskPerson[]>([]);
  const ref = useRef<HTMLTextAreaElement>(null);

  const matches = useMemo(() => {
    if (query === null) return [];
    const q = fold(query);
    return people.filter((p) => fold(p.name).includes(q) || fold(p.name.split(' ').join('')).startsWith(q)).slice(0, 6);
  }, [people, query]);

  function track(text: string, caret: number) {
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(text.slice(0, caret));
    setQuery(m ? m[2] : null);
    setSel(0);
  }

  function pick(p: TaskPerson) {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart ?? body.length;
    const before = body.slice(0, caret).replace(/@([^\s@]{0,30})$/, `@${p.name} `);
    const next = before + body.slice(caret);
    setBody(next);
    setTagged((tg) => (tg.some((x) => x.id === p.id) ? tg : [...tg, p]));
    setQuery(null);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(before.length, before.length); });
  }

  async function send() {
    const text = body.trim();
    if (!text || disabled) return;
    const ids = tagged.filter((p) => text.includes(`@${p.name}`)).map((p) => p.id);
    await onSend(text, ids, waitOn.filter((u) => ids.includes(u)));
    setBody(''); setTagged([]); setWaitOn([]); setQuery(null);
  }

  return (
    <div className="relative border-t border-black/[0.06] px-6 py-3 flex-shrink-0 bg-white">
      {query !== null && matches.length > 0 && (
        <div className="absolute bottom-full left-6 mb-1 w-72 bg-white rounded-xl shadow-[0_12px_32px_-8px_rgba(16,24,40,0.25)] ring-1 ring-black/[0.08] py-1 z-10">
          {matches.map((p, i) => (
            <button key={p.id} onMouseDown={(e) => { e.preventDefault(); pick(p); }} onMouseEnter={() => setSel(i)}
              className={cn('w-full flex items-center gap-2 px-3 py-1.5 text-left', sel === i ? 'bg-[#F6F4EF]' : '')}>
              <Avatar person={p} size={22} />
              <span className="text-[13px] text-[#1B2420]">{p.name}</span>
              <span className="ml-auto text-[11px] text-[#6A6F69]">{p.role.replace(/_/g, ' ').toLowerCase()}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={ref}
          value={body}
          rows={2}
          placeholder={s.replyPlaceholder}
          onChange={(e) => { setBody(e.target.value); track(e.target.value, e.target.selectionStart ?? e.target.value.length); }}
          onKeyDown={(e) => {
            if (query !== null && matches.length) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => (i + 1) % matches.length); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => (i - 1 + matches.length) % matches.length); return; }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(matches[sel]); return; }
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setQuery(null); return; }
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); }
          }}
          className="flex-1 px-3 py-2 rounded-xl ring-1 ring-black/[0.1] outline-none focus:ring-black/[0.25] text-[13.5px] resize-none max-h-40"
        />
        <button onClick={() => void send()} disabled={disabled || !body.trim()}
          className="h-10 flex items-center gap-1.5 px-3.5 rounded-xl bg-accent hover:bg-accent-hover text-white text-[13px] font-semibold disabled:opacity-40">
          <Send size={14} /> {s.send}
        </button>
      </div>
      {tagged.some((p) => body.includes(`@${p.name}`)) && (
        <div className="mt-2 flex items-center gap-x-4 gap-y-1 flex-wrap">
          {tagged.filter((p) => body.includes(`@${p.name}`)).map((p) => (
            <label key={p.id} className="inline-flex items-center gap-1.5 text-[12px] text-[#3D433E] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={waitOn.includes(p.id)}
                onChange={(e) => setWaitOn((w) => (e.target.checked ? [...w, p.id] : w.filter((x) => x !== p.id)))}
                className="accent-[#8A5A12]"
              />
              <Hourglass size={11} className="text-[#8A5A12]" /> {s.putOn(p.name)}
            </label>
          ))}
          <span className="text-[11px] text-[#6A6F69]">{s.putOnHint}</span>
        </div>
      )}
    </div>
  );
}
