'use client';
import { useState, useEffect, useRef } from 'react';
import { X, Loader2, Image as ImageIcon } from 'lucide-react';
import { streams, properties, uploads, ApiError } from '@/lib/api';
import type { StreamEventCategory, Property, ManualStreamEvent } from '@/lib/api';

interface Props {
  /** When set, edit mode. When null/undefined, create mode. */
  initial?: Partial<ManualStreamEvent> | null;
  /** Pre-select a property (used on per-property page) */
  defaultPropertyId?: string;
  onClose: () => void;
  onSaved: () => void;
}

const CATEGORIES: { value: StreamEventCategory; label: string }[] = [
  { value: 'MANUAL', label: 'General' },
  { value: 'NOTE', label: 'Note' },
  { value: 'REPAIR', label: 'Repair' },
  { value: 'INSPECTION', label: 'Inspection' },
];

export function ManualEventComposer({ initial, defaultPropertyId, onClose, onSaved }: Props) {
  const [category, setCategory] = useState<StreamEventCategory>(initial?.category ?? 'MANUAL');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [propertyId, setPropertyId] = useState<string>(
    initial?.propertyId ?? defaultPropertyId ?? '',
  );
  const [propertyList, setPropertyList] = useState<Property[]>([]);
  const [occurredAt, setOccurredAt] = useState<string>(
    initial?.occurredAt
      ? new Date(initial.occurredAt).toISOString().slice(0, 16)
      : new Date().toISOString().slice(0, 16),
  );
  const [photos, setPhotos] = useState<{ previewUrl: string; publicUrl: string }[]>(
    (initial?.photoUrls ?? []).map((url) => ({ previewUrl: url, publicUrl: url })),
  );
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    properties.list().then(setPropertyList).catch(() => {});
  }, []);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      photos.forEach((p) => {
        if (p.previewUrl.startsWith('blob:')) URL.revokeObjectURL(p.previewUrl);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handlePhotoPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!propertyId) {
      setError('Select a property first to upload photos');
      return;
    }
    setUploading(true);
    setError('');
    const previewUrl = URL.createObjectURL(file);
    try {
      const { publicUrl } = await uploads.uploadToGcs({
        file,
        eventType: 'manual',
        propertyId,
      });
      setPhotos((p) => [...p, { previewUrl, publicUrl }]);
    } catch {
      URL.revokeObjectURL(previewUrl);
      setError('Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function removePhoto(index: number) {
    setPhotos((p) => {
      const removed = p[index];
      if (removed && removed.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return p.filter((_, i) => i !== index);
    });
  }

  async function handleSubmit() {
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const payload = {
        category,
        title: title.trim(),
        description: description.trim() || undefined,
        propertyId: propertyId || null,
        photoUrls: photos.map((p) => p.publicUrl),
        occurredAt: new Date(occurredAt).toISOString(),
      };
      if (initial?.id) {
        await streams.updateManual(initial.id, payload);
      } else {
        await streams.createManual(payload);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!initial?.id) return;
    if (!confirm('Delete this event? This cannot be undone.')) return;
    setSubmitting(true);
    try {
      await streams.deleteManual(initial.id);
      onSaved();
      onClose();
    } catch {
      setError('Delete failed');
    } finally {
      setSubmitting(false);
    }
  }

  const isEdit = !!initial?.id;

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 p-0 md:p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-white rounded-t-3xl md:rounded-2xl shadow-xl p-6 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-lg text-ink">
            {isEdit ? 'Edit event' : 'Add event'}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-surface-sunken flex items-center justify-center"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Category */}
          <div>
            <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
              Category
            </label>
            <div className="grid grid-cols-2 gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCategory(c.value)}
                  className={`py-2 rounded-xl border-2 font-semibold text-sm transition ${
                    category === c.value
                      ? 'bg-ink text-white border-ink'
                      : 'bg-white text-ink border-surface-border hover:border-ink-faint'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Property */}
          <div>
            <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
              Property
            </label>
            <select
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              className="w-full rounded-xl border border-surface-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="">— Tenant-wide —</option>
              {propertyList.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Title */}
          <div>
            <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
              Title *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What happened?"
              className="w-full rounded-xl border border-surface-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              maxLength={200}
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
              Description
            </label>
            <textarea
              value={description ?? ''}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="Optional details..."
              className="w-full rounded-xl border border-surface-border bg-white px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          {/* When */}
          <div>
            <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
              When
            </label>
            <input
              type="datetime-local"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
              className="w-full rounded-xl border border-surface-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          {/* Photos */}
          <div>
            <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
              Photos
            </label>
            <div className="flex flex-wrap gap-2">
              {photos.map((p, idx) => (
                <div
                  key={idx}
                  className="relative w-20 h-20 rounded-lg bg-surface-sunken overflow-hidden group"
                >
                  <img src={p.previewUrl} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removePhoto(idx)}
                    className="absolute top-1 right-1 w-5 h-5 bg-black/60 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading || !propertyId}
                title={!propertyId ? 'Select a property first to upload photos' : ''}
                className="w-20 h-20 rounded-lg border-2 border-dashed border-surface-border hover:border-ink-faint flex items-center justify-center text-ink-muted transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {uploading ? <Loader2 size={18} className="animate-spin" /> : <ImageIcon size={18} />}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoPick}
              />
            </div>
            {!propertyId && (
              <p className="text-[11px] text-ink-faint mt-1">
                Select a property to enable photo uploads.
              </p>
            )}
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            {isEdit && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={submitting}
                className="px-4 py-2.5 text-red-600 hover:bg-red-50 rounded-xl text-sm font-semibold transition"
              >
                Delete
              </button>
            )}
            <div className="flex-1" />
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2.5 bg-white border border-surface-border text-ink rounded-xl text-sm font-semibold hover:bg-surface-sunken transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !title.trim()}
              className="px-4 py-2.5 bg-ink text-white rounded-xl text-sm font-semibold hover:bg-ink-soft transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {isEdit ? 'Save' : 'Add'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
