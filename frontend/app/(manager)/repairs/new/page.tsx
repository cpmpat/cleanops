'use client';
import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, Loader2, Plus, X } from 'lucide-react';
import { properties as propertiesApi, users as usersApi, repairs as repairsApi, ApiError } from '@/lib/api';
import type { Property } from '@/lib/api';

export default function NewRepairPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromIncidentId = searchParams.get('fromIncident');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [dueDate, setDueDate] = useState(() => {
    // Default to one week from now
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toLocaleDateString('sv-SE');
  });
  const [assignedUserIds, setAssignedUserIds] = useState<string[]>([]);
  const [primaryUserId, setPrimaryUserId] = useState<string>('');

  const [propertyList, setPropertyList] = useState<Property[]>([]);
  const [repairmen, setRepairmen] = useState<Array<{ id: string; name: string; email: string }>>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    propertiesApi.list().then(setPropertyList).catch(() => {});
    usersApi
      .list()
      .then((list: any[]) =>
        setRepairmen(
          list
            .filter((u) => u.role === 'REPAIRMAN' && u.isActive !== false)
            .map((u) => ({ id: u.id, name: u.name, email: u.email })),
        ),
      )
      .catch(() => {});
  }, []);

  function toggleAssignee(userId: string) {
    setAssignedUserIds((prev) => {
      const next = prev.includes(userId) ? prev.filter((x) => x !== userId) : [...prev, userId];
      // Auto-set primary to first assignee if not set or removed
      if (next.length > 0 && (!primaryUserId || !next.includes(primaryUserId))) {
        setPrimaryUserId(next[0]);
      } else if (next.length === 0) {
        setPrimaryUserId('');
      }
      return next;
    });
  }

  async function handleSubmit() {
    if (!title.trim() || !propertyId || !dueDate) {
      setError('Title, property, and due date are required');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const dueIso = new Date(dueDate + 'T23:59:59').toISOString();
      const payload = {
        title: title.trim(),
        description: description.trim() || undefined,
        dueDate: dueIso,
        assignTo: assignedUserIds.length > 0 ? assignedUserIds : undefined,
        primaryUserId: primaryUserId || undefined,
      };
      const repair = fromIncidentId
        ? await repairsApi.createFromIncident(fromIncidentId, payload)
        : await repairsApi.create({ ...payload, propertyId });
      router.push(`/repairs/${repair.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to create repair');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-2 text-xs text-ink-faint">
        <Link href="/repairs" className="flex items-center hover:text-ink transition">
          <ChevronLeft size={14} />
          Back to repairs
        </Link>
      </div>

      <h1 className="text-2xl font-bold text-ink mb-6">
        {fromIncidentId ? 'Create repair from incident' : 'New repair'}
      </h1>

      <div className="bg-white border border-surface-border rounded-2xl p-6 space-y-5">
        {/* Title */}
        <div>
          <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
            Title *
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Replace bathroom faucet"
            maxLength={200}
            className="w-full rounded-xl border border-surface-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="Optional details, location, parts needed, etc."
            maxLength={1000}
            className="w-full rounded-xl border border-surface-border bg-white px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        {/* Property (hidden when from incident — property is inherited) */}
        {!fromIncidentId && (
          <div>
            <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
              Property *
            </label>
            <select
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              className="w-full rounded-xl border border-surface-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="">— Select property —</option>
              {propertyList.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Due date */}
        <div>
          <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
            Due date *
          </label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full rounded-xl border border-surface-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        {/* Assign repairmen */}
        <div>
          <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
            Assign repairmen (optional)
          </label>
          {repairmen.length === 0 ? (
            <p className="text-xs text-ink-faint italic">No active repairmen in your team yet.</p>
          ) : (
            <div className="space-y-1.5">
              {repairmen.map((r) => {
                const isAssigned = assignedUserIds.includes(r.id);
                const isPrimary = primaryUserId === r.id;
                return (
                  <label
                    key={r.id}
                    className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition ${
                      isAssigned
                        ? 'bg-ink/5 border-ink'
                        : 'bg-white border-surface-border hover:border-ink-faint'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isAssigned}
                      onChange={() => toggleAssignee(r.id)}
                      className="w-4 h-4 rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-ink truncate">{r.name}</p>
                      <p className="text-xs text-ink-muted truncate">{r.email}</p>
                    </div>
                    {isAssigned && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          setPrimaryUserId(r.id);
                        }}
                        className={`px-2 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-wide transition ${
                          isPrimary
                            ? 'bg-ink text-white'
                            : 'bg-white border border-surface-border text-ink-muted hover:border-ink-faint'
                        }`}
                      >
                        {isPrimary ? '★ Primary' : 'Make primary'}
                      </button>
                    )}
                  </label>
                );
              })}
            </div>
          )}
          {assignedUserIds.length === 0 && (
            <p className="text-[11px] text-ink-faint mt-2">
              You can leave this empty and assign later. Repair status will start as Planned.
            </p>
          )}
        </div>

        {error && (
          <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Link
            href="/repairs"
            className="px-4 py-2.5 bg-white border border-surface-border text-ink rounded-xl text-sm font-semibold hover:bg-surface-sunken transition"
          >
            Cancel
          </Link>
          <div className="flex-1" />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !title.trim() || !dueDate || (!fromIncidentId && !propertyId)}
            className="px-4 py-2.5 bg-ink text-white rounded-xl text-sm font-semibold hover:bg-ink-soft transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            Create repair
          </button>
        </div>
      </div>
    </div>
  );
}
