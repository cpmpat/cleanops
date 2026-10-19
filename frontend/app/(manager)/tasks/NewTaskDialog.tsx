'use client';
import { useState } from 'react';
import { X } from 'lucide-react';
import { tasks as tasksApi, type TaskDetail, type TaskPerson, type TaskPriority, type TaskStatus } from '@/lib/api';
import type { TaskStrings } from '@/i18n/tasks';
import { PeoplePicker, PriorityFlag } from '@/components/office/TaskBits';
import { LinkChip, RecordPicker, type PendingLink } from '@/components/office/RecordLinker';
import { cn } from '@/lib/utils';

const PRIORITIES: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

export function NewTaskDialog({ people, s, onClose, onCreated }: {
  people: TaskPerson[]; s: TaskStrings; onClose: () => void; onCreated: (t: TaskDetail) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [priority, setPriority] = useState<TaskPriority>('MEDIUM');
  const [dueDate, setDueDate] = useState('');
  const [status, setStatus] = useState<TaskStatus | ''>('');
  const [links, setLinks] = useState<PendingLink[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true); setError('');
    try {
      const t = await tasksApi.create({
        title: title.trim(), description: description.trim() || undefined, assigneeIds, priority,
        dueDate: dueDate || null, ...(status ? { status } : {}),
        links: links.map((l) => ({ dataset: l.dataset, rowId: l.rowId, field: l.field })),
      });
      onCreated(t);
    } catch (err: any) {
      setError(err?.message ?? 'Could not create');
    } finally {
      setBusy(false);
    }
  }

  const label = 'block text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[#6A6F69] mb-1.5';
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[8vh] px-4" role="dialog" aria-modal="true"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <button aria-label={s.cancel} className="absolute inset-0 bg-[#1B2420]/25 backdrop-blur-[2px]" onClick={onClose} />
      <form onSubmit={submit} className="relative w-full max-w-xl max-h-[88vh] overflow-y-auto bg-white rounded-2xl shadow-[0_24px_64px_-12px_rgba(16,24,40,0.28)] ring-1 ring-black/[0.06]">
        <div className="flex items-center justify-between px-5 h-14 border-b border-black/[0.06]">
          <h2 className="text-[15px] font-semibold text-[#1B2420]">{s.newTask}</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-[#6A6F69] hover:text-[#1B2420] hover:bg-black/[0.05]"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className={label}>{s.fieldTitle}</label>
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200}
              className="w-full h-10 px-3 rounded-lg ring-1 ring-black/[0.08] outline-none focus:ring-black/[0.25] text-[14px]" />
          </div>
          <div>
            <label className={label}>{s.fieldDescription}</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4}
              className="w-full px-3 py-2 rounded-lg ring-1 ring-black/[0.08] outline-none focus:ring-black/[0.25] text-[13.5px] resize-y" />
          </div>
          <div>
            <label className={label}>{s.fieldRecords}</label>
            {links.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {links.map((l, i) => (
                  <LinkChip key={`${l.dataset}:${l.rowId}:${l.field}`} link={l} s={s} onRemove={() => setLinks((ls) => ls.filter((_, j) => j !== i))} />
                ))}
              </div>
            )}
            <RecordPicker s={s} exclude={links} onAdd={(l) => setLinks((ls) => [...ls, l])} />
          </div>
          <div>
            <label className={label}>{s.fieldAssignees}</label>
            <PeoplePicker people={people} value={assigneeIds} onChange={setAssigneeIds} placeholder={s.nobody} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={label}>{s.fieldPriority}</label>
              <div className="flex gap-1 flex-wrap">
                {PRIORITIES.map((p) => (
                  <button key={p} type="button" onClick={() => setPriority(p)} title={s.priority[p]}
                    className={cn('h-8 w-8 flex items-center justify-center rounded-lg ring-1 transition',
                      priority === p ? 'ring-[#1B2420] bg-[#F6F4EF]' : 'ring-black/[0.08] hover:ring-black/[0.2]')}>
                    <PriorityFlag p={p} />
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11.5px] text-[#6A6F69]">{s.priority[priority]}</p>
            </div>
            <div>
              <label className={label}>{s.fieldDue}</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
                className="w-full h-8 px-2 rounded-lg ring-1 ring-black/[0.08] outline-none text-[13px]" />
            </div>
            <div>
              <label className={label}>{s.startAs}</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus | '')}
                className="w-full h-8 px-2 rounded-lg ring-1 ring-black/[0.08] outline-none text-[13px] bg-white">
                <option value="">{assigneeIds.length ? s.stage.TODO : s.stage.NEW}</option>
                <option value="NEW">{s.stage.NEW}</option>
                <option value="TODO">{s.stage.TODO}</option>
              </select>
            </div>
          </div>
          {status === 'TODO' && assigneeIds.length === 0 && <p className="text-[12px] text-[#8A5A12]">{s.needsAssignee}</p>}
          {error && <p className="text-sm text-coral-deep">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-black/[0.06]">
          <button type="button" onClick={onClose} className="h-9 px-3.5 rounded-xl text-sm font-semibold text-[#3D433E] hover:bg-black/[0.05]">{s.cancel}</button>
          <button type="submit" disabled={busy || !title.trim() || (status === 'TODO' && assigneeIds.length === 0)}
            className="h-9 px-4 rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-semibold disabled:opacity-40">{s.create}</button>
        </div>
      </form>
    </div>
  );
}
