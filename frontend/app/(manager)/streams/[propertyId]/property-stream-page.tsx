'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, Activity, RefreshCw, Plus } from 'lucide-react';
import { streams, properties as propertiesApi, ApiError } from '@/lib/api';
import type { StreamItem, Property } from '@/lib/api';
import { StreamItemCard } from '@/components/StreamItemCard';
import { ManualEventComposer } from '@/components/ManualEventComposer';
import { useSocket } from '@/lib/socket';

export default function PropertyStreamPage() {
  const params = useParams<{ propertyId: string }>();
  const propertyId = params.propertyId;

  const [property, setProperty] = useState<Property | null>(null);
  const [items, setItems] = useState<StreamItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [error, setError] = useState('');

  const load = useCallback(
    async (reset = true, cursorOverride?: string | null) => {
      if (reset) setLoading(true);
      else setLoadingMore(true);
      setError('');
      try {
        const cursor = reset ? undefined : (cursorOverride ?? undefined);
        const res = await streams.feed({ propertyId, cursor, limit: 30 });
        setItems((prev) => (reset ? res.items : [...prev, ...res.items]));
        setNextCursor(res.nextCursor);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [propertyId],
  );

  useEffect(() => {
    propertiesApi
      .list()
      .then((list) => setProperty(list.find((p) => p.id === propertyId) ?? null))
      .catch(() => {});
    load(true);
  }, [propertyId, load]);

  useSocket({
    'stream:created': () => load(true),
    'stream:updated': () => load(true),
    'stream:deleted': () => load(true),
  });

  function onEditManual(item: StreamItem) {
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
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-2 text-xs text-ink-faint">
        <Link href="/streams" className="flex items-center hover:text-ink transition">
          <ChevronLeft size={14} />
          All streams
        </Link>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2 truncate">
            <Activity size={22} className="text-ink-muted flex-shrink-0" />
            <span className="truncate">{property?.name ?? 'Property stream'}</span>
          </h1>
          {property?.address && (
            <p className="text-sm text-ink-muted mt-0.5 truncate">{property.address}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
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
          <p className="font-semibold text-ink">No activity for this property</p>
          <p className="text-sm text-ink-muted mt-1">
            Add a manual event with the button above to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <StreamItemCard
              key={item.id}
              item={item}
              hidePropertyName
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
          defaultPropertyId={propertyId}
          onClose={() => setComposerOpen(false)}
          onSaved={() => load(true)}
        />
      )}
    </div>
  );
}
