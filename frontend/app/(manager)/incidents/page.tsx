'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, Paperclip } from 'lucide-react';
import { incidents, properties, ApiError } from '@/lib/api';
import type {
  IncidentListItem,
  IncidentStatus,
  IncidentType,
  IncidentPriority,
  Property,
} from '@/lib/api';
import { useLocale } from '@/lib/locale-context';
import { translations } from '@/i18n/translations';
import {
  IncidentStatusBadge,
  IncidentPriorityBadge,
  IncidentTypeBadge,
} from '@/components/IncidentBadges';

type StatusFilter = 'ALL' | IncidentStatus;
type TypeFilter = 'ALL' | IncidentType;
type PriorityFilter = 'ALL' | IncidentPriority;

export default function ManagerIncidentsPage() {
  const { locale } = useLocale();
  const t = translations[locale];
  const searchParams = useSearchParams();

  const initialCleaningEventId = searchParams.get('cleaningEventId') ?? '';

  const [rows, setRows] = useState<IncidentListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [status, setStatus] = useState<StatusFilter>('OPEN');
  const [type, setType] = useState<TypeFilter>('ALL');
  const [priority, setPriority] = useState<PriorityFilter>('ALL');
  const [propertyId, setPropertyId] = useState<string>('ALL');

  const [propsList, setPropsList] = useState<Property[]>([]);

  useEffect(() => {
    properties
      .list()
      .then(setPropsList)
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    incidents
      .list({
        status: status === 'ALL' ? undefined : status,
        type: type === 'ALL' ? undefined : type,
        priority: priority === 'ALL' ? undefined : priority,
        propertyId: propertyId === 'ALL' ? undefined : propertyId,
        limit: 100,
      })
      .then((res) => {
        if (cancelled) return;
        // If the URL has a cleaningEventId filter (from a CleaningCard badge click),
        // filter client-side here to keep things simple.
        const filtered = initialCleaningEventId
          ? res.rows.filter((r) => r.cleaningEventId === initialCleaningEventId)
          : res.rows;
        setRows(filtered);
        setTotal(initialCleaningEventId ? filtered.length : res.total);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [status, type, priority, propertyId, initialCleaningEventId]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
            <AlertTriangle size={22} className="text-red-500" />
            {t.incidents.title}
          </h1>
          <p className="text-sm text-ink-muted mt-0.5">{t.incidents.subtitle}</p>
        </div>
        <div className="text-sm text-ink-muted">
          {total} {t.incidents.totalLabel}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-surface-border rounded-2xl p-4 mb-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        <FilterSelect
          label={t.incidents.filters.status}
          value={status}
          onChange={(v) => setStatus(v as StatusFilter)}
          options={[
            { value: 'ALL', label: t.incidents.filters.all },
            { value: 'OPEN', label: t.incidents.status.OPEN },
            { value: 'SCHEDULED', label: t.incidents.status.SCHEDULED },
            { value: 'RESOLVED', label: t.incidents.status.RESOLVED },
            { value: 'CLOSED', label: t.incidents.status.CLOSED },
          ]}
        />
        <FilterSelect
          label={t.incidents.filters.type}
          value={type}
          onChange={(v) => setType(v as TypeFilter)}
          options={[
            { value: 'ALL', label: t.incidents.filters.all },
            { value: 'CLEANING', label: t.incidents.type.CLEANING },
            { value: 'BOILER_INSPECTION', label: t.incidents.type.BOILER_INSPECTION },
            { value: 'ACCIDENT', label: t.incidents.type.ACCIDENT },
            { value: 'PHOTO_SHOOT', label: t.incidents.type.PHOTO_SHOOT },
            { value: 'REPAIR', label: t.incidents.type.REPAIR },
            { value: 'GENERAL', label: t.incidents.type.GENERAL },
          ]}
        />
        <FilterSelect
          label={t.incidents.filters.priority}
          value={priority}
          onChange={(v) => setPriority(v as PriorityFilter)}
          options={[
            { value: 'ALL', label: t.incidents.filters.all },
            { value: 'HIGH', label: t.incidents.priority.HIGH },
            { value: 'MEDIUM', label: t.incidents.priority.MEDIUM },
            { value: 'LOW', label: t.incidents.priority.LOW },
          ]}
        />
        <FilterSelect
          label={t.incidents.filters.property}
          value={propertyId}
          onChange={setPropertyId}
          options={[
            { value: 'ALL', label: t.incidents.filters.all },
            ...propsList.map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
      </div>

      {/* List */}
      <div className="bg-white border border-surface-border rounded-2xl overflow-hidden">
        {loading && (
          <div className="p-8 text-center text-ink-muted text-sm">
            {t.general.loading}
          </div>
        )}
        {error && (
          <div className="p-4 text-sm text-red-600 bg-red-50">{error}</div>
        )}
        {!loading && !error && rows.length === 0 && (
          <div className="p-10 text-center">
            <AlertTriangle size={32} className="mx-auto text-ink-faint mb-2" />
            <p className="text-sm text-ink-muted">{t.incidents.empty}</p>
          </div>
        )}
        {!loading &&
          !error &&
          rows.map((inc) => (
            <Link
              key={inc.id}
              href={`/incidents/${inc.id}`}
              className="block border-b border-surface-border last:border-b-0 hover:bg-surface transition-colors"
            >
              <div className="px-4 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap mb-1">
                    <IncidentStatusBadge status={inc.status} t={t} size="sm" />
                    <IncidentPriorityBadge priority={inc.priority} t={t} />
                    <IncidentTypeBadge type={inc.type} t={t} />
                    {inc._count && inc._count.attachments > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-[11px] text-ink-faint">
                        <Paperclip size={10} /> {inc._count.attachments}
                      </span>
                    )}
                  </div>
                  <div className="text-sm font-semibold text-ink truncate">
                    {inc.title}
                  </div>
                  <div className="text-xs text-ink-muted mt-0.5 flex items-center gap-2 flex-wrap">
                    <span>
                      {inc.isGeneral
                        ? t.incidents.generalLabel
                        : inc.property?.name ?? '—'}
                    </span>
                    <span className="text-ink-faint">•</span>
                    <span>
                      {t.incidents.reportedBy}:{' '}
                      {inc.reportedBy?.name || inc.reportedBy?.email || '—'}
                    </span>
                    {inc.assignedTo && (
                      <>
                        <span className="text-ink-faint">•</span>
                        <span>
                          {t.incidents.assignedTo}:{' '}
                          {inc.assignedTo.name || inc.assignedTo.email}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="text-xs text-ink-faint whitespace-nowrap">
                  {new Date(inc.createdAt).toLocaleDateString()}
                </div>
              </div>
            </Link>
          ))}
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-1">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-surface-border bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}