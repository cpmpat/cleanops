'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Wrench, Plus, Filter, AlertCircle, Calendar } from 'lucide-react';
import { repairs as repairsApi, ApiError } from '@/lib/api';
import type { Repair, RepairStatus } from '@/lib/api';
import { RepairStatusBadge } from '@/components/RepairStatusBadge';

type DueFilter = 'all' | 'overdue' | 'today' | 'week';

const STATUS_FILTERS: { value: RepairStatus | 'ACTIVE' | 'ALL'; label: string }[] = [
  { value: 'ACTIVE',        label: 'Active' },
  { value: 'ALL',           label: 'All' },
  { value: 'PLANNED',       label: 'Planned' },
  { value: 'ASSIGNED',      label: 'Assigned' },
  { value: 'IN_PROGRESS',   label: 'In progress' },
  { value: 'IN_REVIEW',     label: 'In review' },
  { value: 'REPORTED_BACK', label: 'Reported' },
  { value: 'DONE',          label: 'Done' },
];

export default function RepairsListPage() {
  const [items, setItems] = useState<Repair[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<RepairStatus | 'ACTIVE' | 'ALL'>('ACTIVE');
  const [dueFilter, setDueFilter] = useState<DueFilter>('all');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const params: any = {};
      if (statusFilter === 'ACTIVE') {
        params.status = ['PLANNED', 'ASSIGNED', 'IN_PROGRESS', 'IN_REVIEW', 'REPORTED_BACK'];
      } else if (statusFilter !== 'ALL') {
        params.status = statusFilter;
      }
      if (dueFilter !== 'all') params.due = dueFilter;

      const res = await repairsApi.list(params);
      setItems(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load repairs');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, dueFilter]);

  const now = new Date();

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
            <Wrench size={22} className="text-ink-muted" />
            Repairs
          </h1>
          <p className="text-sm text-ink-muted mt-0.5">Property repair workflow</p>
        </div>
        <Link
          href="/repairs/new"
          className="px-3 py-2 bg-ink text-white rounded-xl text-sm font-semibold hover:bg-ink-soft transition flex items-center gap-1.5"
        >
          <Plus size={16} />
          New repair
        </Link>
      </div>

      {/* Filters */}
      <div className="bg-white border border-surface-border rounded-2xl p-3 mb-4 space-y-3">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <Filter size={12} className="text-ink-muted" />
            <span className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider">Status</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setStatusFilter(f.value)}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition ${
                  statusFilter === f.value
                    ? 'bg-ink text-white border-ink'
                    : 'bg-white text-ink-muted border-surface-border hover:border-ink-faint'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <Calendar size={12} className="text-ink-muted" />
            <span className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider">Due</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {(['all', 'overdue', 'today', 'week'] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDueFilter(d)}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition ${
                  dueFilter === d
                    ? 'bg-ink text-white border-ink'
                    : 'bg-white text-ink-muted border-surface-border hover:border-ink-faint'
                }`}
              >
                {d === 'all' ? 'All' : d === 'overdue' ? 'Overdue' : d === 'today' ? 'Today' : 'This week'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-700 rounded-2xl text-sm mb-4 flex items-center gap-2">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-white rounded-2xl border border-surface-border animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-surface-border">
          <Wrench size={32} className="mx-auto text-ink-faint mb-2" />
          <p className="font-semibold text-ink">No repairs match your filters</p>
          <p className="text-sm text-ink-muted mt-1">Try adjusting the filters or create one.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((r) => {
            const due = new Date(r.dueDate);
            const isOverdue = due < now && !['DONE', 'CANCELLED'].includes(r.status);
            const assignees = r.assignments.filter((a) => a.status === 'ASSIGNED' || a.status === 'STARTED');
            const primary = assignees.find((a) => a.isPrimary);

            return (
              <Link
                key={r.id}
                href={`/repairs/${r.id}`}
                className="block bg-white border border-surface-border rounded-2xl p-4 hover:border-ink-faint transition"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <RepairStatusBadge status={r.status} size="sm" />
                      {r.incidentId && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                          From incident
                        </span>
                      )}
                    </div>
                    <p className="font-semibold text-sm text-ink truncate">{r.title}</p>
                    <p className="text-xs text-ink-muted mt-0.5 truncate">{r.property.name}</p>
                    {assignees.length > 0 ? (
                      <p className="text-[11px] text-ink-faint mt-1">
                        {primary && <span className="font-semibold">{primary.user.name}</span>}
                        {assignees.length > 1 && primary && <> + {assignees.length - 1} more</>}
                        {!primary && assignees.map((a) => a.user.name).join(', ')}
                      </p>
                    ) : (
                      <p className="text-[11px] text-amber-700 mt-1">Unassigned</p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`text-xs font-semibold ${isOverdue ? 'text-red-600' : 'text-ink-muted'}`}>
                      {due.toLocaleDateString()}
                    </p>
                    <p className="text-[11px] text-ink-faint">
                      {isOverdue ? 'overdue' : `due ${due.toLocaleDateString(undefined, { weekday: 'short' })}`}
                    </p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
