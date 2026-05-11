'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Calendar,
  Home,
  User as UserIcon,
  Paperclip,
} from 'lucide-react';
import { incidents, users as usersApi, ApiError } from '@/lib/api';
import type {
  Incident,
  IncidentStatus,
  IncidentType,
  IncidentPriority,
  User,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useLocale, LocaleProvider } from '@/lib/locale-context';
import { translations } from '@/i18n/translations';
import {
  IncidentStatusBadge,
  IncidentPriorityBadge,
  IncidentTypeBadge,
} from '@/components/IncidentBadges';
import { SignedImage } from '@/components/SignedImage';

export default function IncidentDetailPage() {
  return (
    <LocaleProvider>
      <IncidentDetailShell />
    </LocaleProvider>
  );
}

function IncidentDetailShell() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, loading: authLoading, loadFromStorage } = useAuth();
  const { locale } = useLocale();
  const t = translations[locale];

  const [incident, setIncident] = useState<Incident | null>(null);
  const [managers, setManagers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');

  useEffect(() => {
    loadFromStorage();
  }, []);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/login');
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!user) return;
    load();
    if (user.role === 'MANAGER') {
      usersApi
        .list()
        .then((all) => setManagers(all.filter((u) => u.role === 'MANAGER')))
        .catch(() => {});
    }
  }, [user, id]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const inc = await incidents.byId(id);
      setIncident(inc);
      setResolutionNote(inc.resolutionNote || '');
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError(t.incidents.accessDenied);
      } else {
        setError(err instanceof ApiError ? err.message : 'Failed to load');
      }
    } finally {
      setLoading(false);
    }
  }

  async function update(payload: Parameters<typeof incidents.update>[1]) {
    if (!incident) return;
    setSaving(true);
    try {
      const updated = await incidents.update(incident.id, payload);
      setIncident(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="text-ink-muted text-sm">{t.general.loading}</div>
      </div>
    );
  }

  if (error && !incident) {
    return (
      <div className="min-h-screen bg-surface p-6">
        <div className="max-w-2xl mx-auto">
          <button
            onClick={() => router.back()}
            className="text-sm text-ink-muted hover:text-ink flex items-center gap-1 mb-4"
          >
            <ArrowLeft size={16} /> {t.general.back ?? 'Back'}
          </button>
          <div className="bg-red-50 text-red-700 rounded-xl p-4 text-sm">
            {error}
          </div>
        </div>
      </div>
    );
  }

  if (!incident || !user) return null;

  const isManager = user.role === 'MANAGER';
  const displayName = (u?: { name: string | null; email: string } | null) =>
    u ? u.name || u.email : '—';

  async function transition(status: IncidentStatus) {
    const payload: Parameters<typeof incidents.update>[1] = { status };
    if (status === 'RESOLVED' || status === 'CLOSED') {
      payload.resolutionNote = resolutionNote || undefined;
    }
    await update(payload);
  }

  return (
    <div className="min-h-screen bg-surface">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-white border-b border-surface-border">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => router.back()}
            className="text-sm text-ink-muted hover:text-ink flex items-center gap-1"
          >
            <ArrowLeft size={16} /> {t.general.back ?? 'Back'}
          </button>
          <span className="text-xs text-ink-faint">
            {isManager ? t.nav.incidents : t.incidents.myReport}
          </span>
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-4">
        {error && (
          <div className="bg-red-50 text-red-700 rounded-xl px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {/* Header card */}
        <div className="bg-white border border-surface-border rounded-2xl p-5">
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <IncidentStatusBadge status={incident.status} t={t} />
            <IncidentPriorityBadge priority={incident.priority} t={t} />
            <IncidentTypeBadge type={incident.type} t={t} />
          </div>
          <h1 className="text-lg md:text-xl font-bold text-ink mb-2">
            {incident.title}
          </h1>
          {incident.description && (
            <p className="text-sm text-ink-soft whitespace-pre-wrap">
              {incident.description}
            </p>
          )}
        </div>

        {/* Meta card */}
        <div className="bg-white border border-surface-border rounded-2xl p-5 space-y-3">
          <MetaRow
            icon={<Home size={14} />}
            label={t.incidents.detail.property}
            value={
              incident.isGeneral
                ? t.incidents.generalLabel
                : incident.property?.name ?? '—'
            }
          />
          <MetaRow
            icon={<UserIcon size={14} />}
            label={t.incidents.detail.reportedBy}
            value={displayName(incident.reportedBy)}
          />
          <MetaRow
            icon={<Calendar size={14} />}
            label={t.incidents.detail.createdAt}
            value={new Date(incident.createdAt).toLocaleString()}
          />
          {incident.cleaningEvent && (
            <MetaRow
              icon={<Calendar size={14} />}
              label={t.incidents.detail.cleaning}
              value={
                <span>
                  {incident.cleaningEvent.accommodationName} —{' '}
                  {new Date(incident.cleaningEvent.timeSlot).toLocaleString()}
                </span>
              }
            />
          )}
          {incident.resolvedAt && (
            <>
              <MetaRow
                icon={<Calendar size={14} />}
                label={t.incidents.detail.resolvedAt}
                value={new Date(incident.resolvedAt).toLocaleString()}
              />
              <MetaRow
                icon={<UserIcon size={14} />}
                label={t.incidents.detail.resolvedBy}
                value={displayName(incident.resolvedBy)}
              />
            </>
          )}
        </div>

        {/* Manager-only: assignment + classification */}
        {isManager && (
          <>
            <div className="bg-white border border-surface-border rounded-2xl p-5 grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-1">
                  {t.incidents.detail.assignedTo}
                </label>
                <select
                  value={incident.assignedTo?.id ?? ''}
                  onChange={(e) =>
                    update({ assignedToId: e.target.value || null })
                  }
                  disabled={saving}
                  className="w-full rounded-xl border border-surface-border bg-white px-3 py-2 text-sm"
                >
                  <option value="">{t.incidents.detail.unassigned}</option>
                  {managers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name || m.email}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-1">
                  {t.incidents.filters.priority}
                </label>
                <select
                  value={incident.priority}
                  onChange={(e) =>
                    update({ priority: e.target.value as IncidentPriority })
                  }
                  disabled={saving}
                  className="w-full rounded-xl border border-surface-border bg-white px-3 py-2 text-sm"
                >
                  {(['HIGH', 'MEDIUM', 'LOW'] as IncidentPriority[]).map((p) => (
                    <option key={p} value={p}>
                      {t.incidents.priority[p]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-1">
                  {t.incidents.filters.type}
                </label>
                <select
                  value={incident.type}
                  onChange={(e) =>
                    update({ type: e.target.value as IncidentType })
                  }
                  disabled={saving}
                  className="w-full rounded-xl border border-surface-border bg-white px-3 py-2 text-sm"
                >
                  {(
                    [
                      'CLEANING',
                      'BOILER_INSPECTION',
                      'ACCIDENT',
                      'PHOTO_SHOOT',
                      'REPAIR',
                      'GENERAL',
                    ] as IncidentType[]
                  ).map((ty) => (
                    <option key={ty} value={ty}>
                      {t.incidents.type[ty]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </>
        )}

        {/* Attachments */}
        {incident.attachments.length > 0 && (
          <div className="bg-white border border-surface-border rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-1.5">
              <Paperclip size={14} />
              {t.incidents.detail.attachments} ({incident.attachments.length})
            </h3>
            <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
              {incident.attachments.map((att) => (
                <a
                  key={att.id}
                  href={att.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block aspect-square bg-surface-sunken rounded-xl overflow-hidden hover:ring-2 hover:ring-accent"
                  onClick={async (e) => {
                    // For private GCS URLs, open the signed URL instead so the
                    // new tab actually loads. Falls back to default href if the
                    // link doesn't look like a GCS URL.
                    if (att.url.includes('storage.googleapis.com')) {
                      e.preventDefault();
                      try {
                        const { uploads } = await import('@/lib/api');
                        const key = att.url.match(
                          /storage\.googleapis\.com\/[^/]+\/(.+)$/,
                        )?.[1];
                        if (key) {
                          const { url } = await uploads.getReadUrl(
                            decodeURIComponent(key),
                            60,
                          );
                          window.open(url, '_blank', 'noopener,noreferrer');
                        }
                      } catch {
                        /* swallow — link click already prevented */
                      }
                    }
                  }}
                >
                  {!att.mimeType || att.mimeType.startsWith('image/') ? (
                    <SignedImage
                      src={att.url}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-ink-muted text-xs">
                      📎
                    </div>
                  )}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Manager-only: resolution + actions */}
        {isManager &&
          (incident.status === 'OPEN' ||
            incident.status === 'SCHEDULED' ||
            incident.status === 'RESOLVED') && (
            <div className="bg-white border border-surface-border rounded-2xl p-5">
              <label className="block text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-1">
                {t.incidents.detail.resolutionNote}
              </label>
              <textarea
                value={resolutionNote}
                onChange={(e) => setResolutionNote(e.target.value)}
                rows={3}
                placeholder={t.incidents.detail.resolutionNotePlaceholder}
                className="w-full rounded-xl border border-surface-border bg-white px-3 py-2 text-sm resize-none"
              />
            </div>
          )}

        {isManager && (
          <div className="bg-white border border-surface-border rounded-2xl p-5 flex items-center gap-2 flex-wrap">
            {incident.status === 'OPEN' && (
              <>
                <button
                  onClick={() => transition('SCHEDULED')}
                  disabled={saving}
                  className="px-4 py-2.5 text-sm font-semibold rounded-xl bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {t.incidents.actions.markScheduled}
                </button>
                <button
                  onClick={() => transition('RESOLVED')}
                  disabled={saving}
                  className="px-4 py-2.5 text-sm font-semibold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {t.incidents.actions.markResolved}
                </button>
              </>
            )}
            {incident.status === 'SCHEDULED' && (
              <>
                <button
                  onClick={() => transition('OPEN')}
                  disabled={saving}
                  className="px-4 py-2.5 text-sm font-semibold rounded-xl bg-white border border-surface-border text-ink hover:bg-surface-sunken"
                >
                  {t.incidents.actions.reopen}
                </button>
                <button
                  onClick={() => transition('RESOLVED')}
                  disabled={saving}
                  className="px-4 py-2.5 text-sm font-semibold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {t.incidents.actions.markResolved}
                </button>
              </>
            )}
            {incident.status === 'RESOLVED' && (
              <>
                <button
                  onClick={() => transition('OPEN')}
                  disabled={saving}
                  className="px-4 py-2.5 text-sm font-semibold rounded-xl bg-white border border-surface-border text-ink hover:bg-surface-sunken"
                >
                  {t.incidents.actions.reopen}
                </button>
                <button
                  onClick={() => transition('CLOSED')}
                  disabled={saving}
                  className="px-4 py-2.5 text-sm font-semibold rounded-xl bg-ink text-white hover:bg-ink-soft disabled:opacity-50"
                >
                  {t.incidents.actions.markClosed}
                </button>
              </>
            )}
            {incident.status === 'CLOSED' && (
              <button
                onClick={() => transition('OPEN')}
                disabled={saving}
                className="px-4 py-2.5 text-sm font-semibold rounded-xl bg-white border border-surface-border text-ink hover:bg-surface-sunken"
              >
                {t.incidents.actions.reopen}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MetaRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <div className="flex items-center gap-1.5 text-ink-muted text-xs font-semibold uppercase tracking-wider w-36 flex-shrink-0 mt-0.5">
        {icon}
        {label}
      </div>
      <div className="text-ink flex-1">{value}</div>
    </div>
  );
}