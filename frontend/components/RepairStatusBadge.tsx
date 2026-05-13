'use client';
import type { RepairStatus } from '@/lib/api';

const STATUS_STYLES: Record<RepairStatus, { bg: string; text: string; label: string }> = {
  PLANNED:       { bg: 'bg-stone-100',   text: 'text-stone-700',   label: 'Planned' },
  ASSIGNED:      { bg: 'bg-blue-100',    text: 'text-blue-700',    label: 'Assigned' },
  IN_PROGRESS:   { bg: 'bg-amber-100',   text: 'text-amber-800',   label: 'In progress' },
  IN_REVIEW:     { bg: 'bg-violet-100',  text: 'text-violet-700',  label: 'In review' },
  DONE:          { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Done' },
  REPORTED_BACK: { bg: 'bg-red-100',     text: 'text-red-700',     label: 'Problem reported' },
  CANCELLED:     { bg: 'bg-gray-100',    text: 'text-gray-500',    label: 'Cancelled' },
};

export function RepairStatusBadge({ status, size = 'md' }: { status: RepairStatus; size?: 'sm' | 'md' }) {
  const s = STATUS_STYLES[status];
  const sizeClass = size === 'sm'
    ? 'text-[10px] px-1.5 py-0.5'
    : 'text-xs px-2 py-0.5';
  return (
    <span className={`inline-flex items-center font-semibold uppercase tracking-wide rounded-full ${s.bg} ${s.text} ${sizeClass}`}>
      {s.label}
    </span>
  );
}
