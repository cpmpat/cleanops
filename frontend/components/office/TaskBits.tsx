'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X, Flag } from 'lucide-react';
import type { TaskPerson, TaskPriority, TaskStatus } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Small shared pieces of the Tasks module: avatars, priority flag, people picker, time ago. */

// Earthy tones that sit with the Oct 2026 palette (green / coral / sand).
const AVATAR_COLORS = ['#1F4D3A', '#2F5DA8', '#7A5BA6', '#B23A26', '#8A5A12', '#3D6B57', '#5B5446', '#2E6E73'];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

export function Avatar({ person, size = 24, ring = false }: { person: Pick<TaskPerson, 'id' | 'name'>; size?: number; ring?: boolean }) {
  return (
    <span
      title={person.name}
      className={cn('inline-flex items-center justify-center rounded-full text-white font-semibold flex-shrink-0', ring && 'ring-2 ring-white')}
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.4), background: AVATAR_COLORS[hash(person.id) % AVATAR_COLORS.length] }}
    >
      {initials(person.name)}
    </span>
  );
}

export function AvatarStack({ people, size = 22, max = 3 }: { people: TaskPerson[]; size?: number; max?: number }) {
  const shown = people.slice(0, max);
  const more = people.length - shown.length;
  return (
    <span className="flex items-center -space-x-1.5">
      {shown.map((p) => <Avatar key={p.id} person={p} size={size} ring />)}
      {more > 0 && (
        <span className="inline-flex items-center justify-center rounded-full bg-[#F6F4EF] text-[#3D433E] text-[10px] font-semibold ring-2 ring-white" style={{ width: size, height: size }}>
          +{more}
        </span>
      )}
    </span>
  );
}

export const STAGE_DOT: Record<TaskStatus, string> = {
  NEW: '#8A8E88', TODO: '#2F5DA8', IN_PROGRESS: '#1F4D3A', ON_HOLD: '#D69A2D', REVIEW: '#7A5BA6', DONE: '#A9AEA8',
};

export const PRIORITY_COLOR: Record<TaskPriority, string> = {
  LOW: '#A9AEA8',
  MEDIUM: '#6A6F69',
  HIGH: '#D69A2D',
  URGENT: '#E2553F',
};

/** Priority as a small chip (board cards): Urgent solid coral, High sand, the rest neutral. */
export function PriorityChip({ p, label }: { p: TaskPriority; label: string }) {
  const cls = p === 'URGENT' ? 'bg-coral text-white'
    : p === 'HIGH' ? 'bg-sand-soft text-sand-deep'
    : 'bg-[#EFEAE0] text-[#5B5446]';
  return <span className={cn('rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold leading-none', cls)}>{label}</span>;
}

export function PriorityFlag({ p, label }: { p: TaskPriority; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1" title={label}>
      <Flag size={13} strokeWidth={2} style={{ color: PRIORITY_COLOR[p] }} fill={p === 'URGENT' || p === 'HIGH' ? PRIORITY_COLOR[p] : 'none'} />
      {label && <span className="text-[12px] text-[#3D433E]">{label}</span>}
    </span>
  );
}

export function ago(iso: string, locale: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale === 'uk' ? 'uk' : locale, { numeric: 'auto', style: 'short' });
  if (s < 60) return rtf.format(0, 'second');
  if (s < 3600) return rtf.format(-Math.floor(s / 60), 'minute');
  if (s < 86400) return rtf.format(-Math.floor(s / 3600), 'hour');
  if (s < 86400 * 30) return rtf.format(-Math.floor(s / 86400), 'day');
  return new Date(iso).toLocaleDateString(locale);
}

/**
 * Pick people from a list. multi: checkboxes and chips; single: pick one and close.
 */
export function PeoplePicker({
  people, value, onChange, multi = true, placeholder, disabled, compact,
}: {
  people: TaskPerson[];
  value: string[];
  onChange: (ids: string[]) => void;
  multi?: boolean;
  placeholder: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const chosen = people.filter((p) => value.includes(p.id));
  const list = useMemo(
    () => people.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()) || p.email.toLowerCase().includes(q.toLowerCase())),
    [people, q],
  );
  function toggle(id: string) {
    if (!multi) { onChange([id]); setOpen(false); setQ(''); return; }
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'w-full flex items-center gap-1.5 flex-wrap text-left rounded-lg ring-1 ring-black/[0.08] bg-white transition',
          compact ? 'min-h-[32px] px-2 py-1' : 'min-h-[38px] px-2.5 py-1.5',
          disabled ? 'opacity-70 cursor-default' : 'hover:ring-black/[0.16]',
        )}
      >
        {multi && chosen.length > 0 ? chosen.map((p) => (
          <span key={p.id} className="inline-flex items-center gap-1 pl-0.5 pr-1.5 py-0.5 rounded-full bg-[#F6F4EF] text-[12px] text-[#1B2420]">
            <Avatar person={p} size={18} />{p.name}
            {!disabled && (
              <X size={11} className="text-[#6A6F69] hover:text-[#1B2420]" onClick={(e) => { e.stopPropagation(); toggle(p.id); }} />
            )}
          </span>
        )) : <span className="text-[13px] text-[#6A6F69]">{placeholder}</span>}
        {!disabled && <ChevronDown size={14} className="ml-auto text-[#6A6F69]" />}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[240px] bg-white rounded-xl shadow-[0_12px_32px_-8px_rgba(16,24,40,0.25)] ring-1 ring-black/[0.08] overflow-hidden">
          <div className="flex items-center gap-2 px-3 h-9 border-b border-black/[0.06]">
            <Search size={13} className="text-[#6A6F69]" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} className="flex-1 outline-none text-[13px]" />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {list.map((p) => (
              <button key={p.id} type="button" onClick={() => toggle(p.id)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[#F6F4EF]">
                <Avatar person={p} size={22} />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] text-[#1B2420] truncate">{p.name}</span>
                  <span className="block text-[11px] text-[#6A6F69] truncate">{p.role.replace(/_/g, ' ').toLowerCase()}</span>
                </span>
                {value.includes(p.id) && <Check size={14} className="text-[#1B2420]" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
