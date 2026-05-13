'use client';
import { useState, useEffect, useCallback } from 'react';
import { Plus, RefreshCw, Filter, Activity } from 'lucide-react';
import { streams, ApiError } from '@/lib/api';
import type { StreamItem, StreamItemType } from '@/lib/api';
import { StreamItemCard } from '@/components/StreamItemCard';
import { ManualEventComposer } from '@/components/ManualEventComposer';
import { useSocket } from '@/lib/socket';

const ALL_TYPES: StreamItemType[] = [
  'RESERVATION',
  'CLEANING',
  'INCIDENT',
  'REPAIR',
  'INSPECTION',
  'MANUAL',
];

export default function StreamsPage() {
  const [items, setItems] = useState<StreamItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<StreamItemType[]>([]);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const load = useCallback(
    async (reset = true, cursorOverride?: string | null) => {
      if (reset) setLoading(true);
      else setLoadingMore(true);
      setError('');
      try {
        const cursor = reset ? undefined : (cursorOverride ?? undefined);
        const res = await streams.feed({
          cursor,
          limit: 30,
          types: selectedTypes.length > 0 ? selectedTypes : undefined,
        });
        setItems((prev) => (reset ? res.items : [...prev, ...res.items]));
        setNextCursor(res.nextCursor);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [selectedTypes],
  );

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTypes]);

  useSocket({
    'stream:created': () => load(true),
    'stream:updated': () => load(true),
    'stream:deleted': () => load(true),
  });

  function toggleType(t: StreamItemType) {
    setSelectedTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  }

  function onEditManual(item: StreamItem) {
    // We have only the StreamItem (lossy) — enough to repopulate the form.
    setEditing({
      id: item.source.id,
      title: item.title,
      description: item.subtitle ?? '',
      propertyId: item.propertyId,
      photoUrls: item.photoUrls ?? [],
      occurredAt: item.occurredAt,
      category:
        item.type === 'REPAIR'
          ? 'REPAIR'
          : item.type === 'INSPECTION'
          ? 'INSPECTION'
          : 'MANUAL',
    });
    setComposerOpen(true);
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
            <Activity size={22} className="text-ink-muted" />
            Streams
          </h1>
          <p className="text-sm text-ink-muted mt-0.5">
            All activity across properties
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load(true)}
            className="p-2 text-ink-muted hover:text-ink rounded-xl hover:bg-surface-sunken transition"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => {
              setEditing(null);
              setComposerOpen(true);
            }}
            className="px-3 py-2 bg-ink text-white rounded-xl text-sm font-semibold hover:bg-ink-soft transition flex items-center gap-1.5"
          >
            <Plus size={16} />
            Add event
          </button>
        </div>
      </div>

      {/* Type filters */}
      <div className="bg-white border border-surface-border rounded-2xl p-3 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <Filter size={14} className="text-ink-muted" />
          <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
            Filter
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ALL_TYPES.map((t) => {
            const active = selectedTypes.includes(t);
            return (
              <button
                key={t}
                onClick={() => toggleType(t)}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold transition border ${
                  active
                    ? 'bg-ink text-white border-ink'
                    : 'bg-white text-ink-muted border-surface-border hover:border-ink-faint'
                }`}
              >
                {t}
              </button>
            );
          })}
          {selectedTypes.length > 0 && (
            <button
              onClick={() => setSelectedTypes([])}
              className="px-2.5 py-1 text-xs text-ink-faint hover:text-ink transition"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-700 rounded-2xl text-sm mb-4">
          {error}
        </div>
      )}

      {/* Feed */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-24 bg-white rounded-2xl border border-surface-border animate-pulse"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-surface-border">
          <Activity size={32} className="mx-auto text-ink-faint mb-2" />
          <p className="font-semibold text-ink">No activity yet</p>
          <p className="text-sm text-ink-muted mt-1">
            As bookings come in, this feed will populate.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <StreamItemCard
              key={item.id}
              item={item}
              onEditManual={onEditManual}
            />
          ))}
          {nextCursor && (
            <button
              onClick={() => load(false, nextCursor)}
              disabled={loadingMore}
              className="w-full py-3 bg-white border border-surface-border rounded-2xl text-sm font-semibold text-ink-muted hover:text-ink hover:border-ink-faint transition disabled:opacity-50"
            >
              {loadingMore ? 'Loading...' : 'Load more'}
            </button>
          )}
        </div>
      )}

      {composerOpen && (
        <ManualEventComposer
          initial={editing}
          onClose={() => setComposerOpen(false)}
          onSaved={() => load(true)}
        />
      )}
    </div>
  );
}
