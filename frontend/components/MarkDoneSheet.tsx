'use client';
import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { X, Check, AlertTriangle, Image, Loader2 } from 'lucide-react';
import { events as eventsApi, uploads, ApiError } from '@/lib/api';
import type { CleaningEvent, IncidentPriority } from '@/lib/api';
import type { Translations } from '@/i18n/translations';

interface MarkDoneSheetProps {
  event: CleaningEvent;
  t: Translations;
  onClose: () => void;
  onSuccess: (event: CleaningEvent) => void;
}

type Stage = 'choose' | 'issue-form' | 'submitting';

const PRIORITIES: IncidentPriority[] = ['LOW', 'MEDIUM', 'HIGH'];

export function MarkDoneSheet({ event, t, onClose, onSuccess }: MarkDoneSheetProps) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('choose');
  const [note, setNote] = useState('');
  const [priority, setPriority] = useState<IncidentPriority | null>(null);
  const [uploadedPhotos, setUploadedPhotos] = useState<{ id: string; url: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleAllGood() {
    setStage('submitting');
    setError('');
    try {
      const res = await eventsApi.markDone(event.id, { allGood: true });
      onSuccess(res.cleaning);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.doneFlow.error);
      setStage('choose');
    }
  }

  async function handlePhotoPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const res = await uploads.photo(event.id, file);
      setUploadedPhotos((p) => [...p, res]);
    } catch {
      setError(t.doneFlow.error);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleSubmitIssue() {
    if (!priority) {
      setError(t.doneFlow.priorityRequired);
      return;
    }
    setStage('submitting');
    setError('');
    try {
      const res = await eventsApi.markDone(event.id, {
        allGood: false,
        priority,
        note: note.trim() || undefined,
        photoUrls: uploadedPhotos.map((p) => p.url),
      });
      onSuccess(res.cleaning);
      // Auto-navigate cleaner to the newly created incident
      if (res.incidentId) {
        router.push(`/incidents/${res.incidentId}`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.doneFlow.error);
      setStage('issue-form');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white rounded-t-3xl shadow-xl p-5 pb-safe max-h-[90vh] overflow-y-auto animate-[slideUp_.2s_ease-out]"
      >
        {/* Handle */}
        <div className="w-12 h-1 rounded-full bg-surface-border mx-auto mb-4" />

        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="font-bold text-lg text-ink">{t.doneFlow.title}</h2>
            <p className="text-sm text-ink-muted mt-0.5">{t.doneFlow.subtitle}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-surface-sunken flex items-center justify-center"
          >
            <X size={18} />
          </button>
        </div>

        {/* Event reference */}
        <div className="mb-4 bg-surface rounded-xl p-3">
          <p className="text-sm font-semibold text-ink truncate">{event.accommodationName}</p>
          <p className="text-xs text-ink-muted mt-0.5 truncate">{event.bookingRef}</p>
        </div>

        {/* Stage: choose */}
        {stage === 'choose' && (
          <div className="space-y-3">
            <button
              onClick={handleAllGood}
              className="w-full flex items-center gap-3 p-4 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-2xl text-left transition active:scale-[0.99]"
            >
              <div className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center flex-shrink-0">
                <Check size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-emerald-900">{t.doneFlow.allGood}</p>
                <p className="text-xs text-emerald-700 mt-0.5">{t.doneFlow.allGoodSub}</p>
              </div>
            </button>

            <button
              onClick={() => { setStage('issue-form'); setError(''); }}
              className="w-full flex items-center gap-3 p-4 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-2xl text-left transition active:scale-[0.99]"
            >
              <div className="w-10 h-10 rounded-full bg-amber-600 text-white flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-amber-900">{t.doneFlow.hasIssue}</p>
                <p className="text-xs text-amber-700 mt-0.5">{t.doneFlow.hasIssueSub}</p>
              </div>
            </button>

            {error && (
              <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
            )}
          </div>
        )}

        {/* Stage: issue form */}
        {stage === 'issue-form' && (
          <div className="space-y-4">
            {/* Priority (required) */}
            <div>
              <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
                {t.doneFlow.priority} *
              </label>
              <div className="grid grid-cols-3 gap-2">
                {PRIORITIES.map((p) => {
                  const selected = priority === p;
                  const tone =
                    p === 'HIGH'
                      ? selected
                        ? 'bg-red-600 text-white border-red-600'
                        : 'bg-white text-red-700 border-red-200 hover:border-red-400'
                      : p === 'MEDIUM'
                      ? selected
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-blue-700 border-blue-200 hover:border-blue-400'
                      : selected
                      ? 'bg-stone-700 text-white border-stone-700'
                      : 'bg-white text-stone-700 border-stone-300 hover:border-stone-500';
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPriority(p)}
                      className={`py-2.5 rounded-xl border-2 font-semibold text-sm transition ${tone}`}
                    >
                      {t.incidents.priority[p]}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-ink-faint mt-1.5">
                {t.doneFlow.priorityHelp}
              </p>
            </div>

            {/* Note */}
            <div>
              <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
                {t.doneFlow.note}
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={4}
                placeholder={t.doneFlow.notePlaceholder}
                className="w-full px-4 py-3 rounded-xl border border-surface-border bg-surface text-ink text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition resize-none"
              />
            </div>

            {/* Photos */}
            <div>
              <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
                {t.doneFlow.photos}
              </label>
              <div className="flex flex-wrap gap-2">
                {uploadedPhotos.map((p) => (
                  <div key={p.id} className="w-16 h-16 rounded-lg bg-surface-sunken overflow-hidden">
                    <img src={p.url} alt="" className="w-full h-full object-cover" />
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="w-16 h-16 rounded-lg border-2 border-dashed border-surface-border hover:border-ink-faint flex items-center justify-center text-ink-muted transition disabled:opacity-50"
                >
                  {uploading ? <Loader2 size={18} className="animate-spin" /> : <Image size={18} />}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handlePhotoPick}
                />
              </div>
            </div>

            {error && (
              <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
            )}

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setStage('choose')}
                className="flex-1 px-4 py-3 bg-white border border-surface-border text-ink rounded-xl text-sm font-semibold hover:bg-surface-sunken transition"
              >
                {t.doneFlow.cancel}
              </button>
              <button
                onClick={handleSubmitIssue}
                disabled={!priority}
                className="flex-1 px-4 py-3 bg-ink text-white rounded-xl text-sm font-semibold hover:bg-ink-soft transition active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t.doneFlow.submit}
              </button>
            </div>
          </div>
        )}

        {/* Stage: submitting */}
        {stage === 'submitting' && (
          <div className="flex flex-col items-center py-8 gap-3">
            <Loader2 size={28} className="animate-spin text-ink-muted" />
            <p className="text-sm text-ink-muted">{t.doneFlow.submitting}</p>
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}