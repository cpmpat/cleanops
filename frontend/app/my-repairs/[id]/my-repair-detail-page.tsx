'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ChevronLeft, Wrench, Calendar, MapPin, MessageSquare, Send,
  Play, CheckCircle2, AlertOctagon, Loader2, X as XIcon, Image as ImageIcon,
  Package, FileWarning, RefreshCw,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import {
  repairs as repairsApi, repairMaterials as materialsApi,
  uploads, ApiError,
} from '@/lib/api';
import type {
  Repair, RepairComment, RepairMaterial, RepairReportUrgency,
} from '@/lib/api';
import { RepairStatusBadge } from '@/components/RepairStatusBadge';
import { SignedImage } from '@/components/SignedImage';

export default function MyRepairDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user, loading: authLoading, loadFromStorage } = useAuth();
  const repairId = params.id;

  const [repair, setRepair] = useState<Repair | null>(null);
  const [comments, setComments] = useState<RepairComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const [showDone, setShowDone] = useState(false);
  const [showReport, setShowReport] = useState(false);

  useEffect(() => { loadFromStorage(); }, []);

  useEffect(() => {
    if (!authLoading) {
      if (!user) router.replace('/login');
      else if (user.role === 'MANAGER') router.replace(`/repairs/${repairId}`);
      else if (user.role === 'CLEANER') router.replace('/cleanings');
    }
  }, [user, authLoading, router, repairId]);

  const load = useCallback(async () => {
    try {
      const r = await repairsApi.getById(repairId);
      setRepair(r);
      setComments(r.comments ?? []);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [repairId]);

  useEffect(() => {
    if (user?.role === 'REPAIRMAN') load();
  }, [user, load]);

  async function handleStart() {
    setActionLoading(true);
    setActionError('');
    try {
      await repairsApi.start(repairId);
      await load();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Failed to start');
    } finally {
      setActionLoading(false);
    }
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="w-10 h-10 rounded-2xl bg-ink animate-pulse" />
      </div>
    );
  }

  if (!user || user.role !== 'REPAIRMAN') return null;

  if (error || !repair) {
    return (
      <div className="min-h-screen bg-surface p-4">
        <Link href="/my-repairs" className="flex items-center gap-1 text-xs text-ink-faint hover:text-ink mb-4">
          <ChevronLeft size={14} /> Back
        </Link>
        <div className="p-4 bg-red-50 text-red-700 rounded-2xl text-sm">
          {error || 'Repair not found'}
        </div>
      </div>
    );
  }

  const due = new Date(repair.dueDate);
  const isOverdue = due < new Date() && !['DONE', 'CANCELLED'].includes(repair.status);
  const canStart   = repair.status === 'ASSIGNED' || repair.status === 'REPORTED_BACK';
  const canSubmit  = repair.status === 'IN_PROGRESS';
  const showWorkSection = ['IN_REVIEW', 'DONE', 'REPORTED_BACK'].includes(repair.status);

  return (
    <div className="min-h-screen bg-surface pb-32">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-white border-b border-surface-border">
        <div className="px-4 py-3 flex items-center gap-2 max-w-2xl mx-auto">
          <Link
            href="/my-repairs"
            className="p-2 -ml-2 text-ink-muted hover:text-ink rounded-xl hover:bg-surface-sunken transition"
          >
            <ChevronLeft size={20} />
          </Link>
          <p className="flex-1 font-bold text-sm text-ink truncate">Repair details</p>
          <button
            onClick={load}
            className="p-2 text-ink-muted hover:text-ink rounded-xl hover:bg-surface-sunken transition"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </header>

      <main className="px-4 py-4 max-w-2xl mx-auto space-y-3">
        {/* Status badge + title */}
        <div className="bg-white border border-surface-border rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <RepairStatusBadge status={repair.status} />
            {isOverdue && (
              <span className="text-[10px] font-bold uppercase tracking-wide text-red-600">OVERDUE</span>
            )}
          </div>
          <h1 className="text-xl font-bold text-ink flex items-start gap-2">
            <Wrench size={20} className="text-ink-muted flex-shrink-0 mt-0.5" />
            <span className="break-words">{repair.title}</span>
          </h1>
        </div>

        {/* Meta */}
        <div className="bg-white border border-surface-border rounded-2xl p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <MapPin size={14} className="text-ink-muted flex-shrink-0" />
            <span className="font-semibold text-ink truncate">{repair.property.name}</span>
          </div>
          {repair.property.address && (
            <p className="text-xs text-ink-muted ml-6">{repair.property.address}</p>
          )}
          <div className="flex items-center gap-2 text-sm">
            <Calendar size={14} className={isOverdue ? 'text-red-600' : 'text-ink-muted'} />
            <span className={isOverdue ? 'font-semibold text-red-600' : 'text-ink'}>
              Due {due.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
            </span>
          </div>
          {repair.description && (
            <p className="text-sm text-ink-muted whitespace-pre-wrap pt-2 border-t border-surface-border">
              {repair.description}
            </p>
          )}
        </div>

        {/* Action buttons (status-driven) */}
        {(canStart || canSubmit) && (
          <div className="bg-white border border-surface-border rounded-2xl p-3 space-y-2">
            {actionError && (
              <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{actionError}</p>
            )}
            {canStart && (
              <button
                onClick={handleStart}
                disabled={actionLoading}
                className="w-full py-3 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 transition disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {actionLoading ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} />}
                Start work
              </button>
            )}
            {canSubmit && (
              <>
                <button
                  onClick={() => setShowDone(true)}
                  className="w-full py-3 bg-ink text-white rounded-xl text-sm font-bold hover:bg-ink-soft transition flex items-center justify-center gap-2"
                >
                  <CheckCircle2 size={18} />
                  Submit as done
                </button>
                <button
                  onClick={() => setShowReport(true)}
                  className="w-full py-3 bg-white border-2 border-amber-300 text-amber-800 rounded-xl text-sm font-bold hover:bg-amber-50 transition flex items-center justify-center gap-2"
                >
                  <AlertOctagon size={18} />
                  Report a problem
                </button>
              </>
            )}
          </div>
        )}

        {/* Status-specific info banners */}
        {repair.status === 'IN_REVIEW' && (
          <div className="bg-violet-50 border border-violet-200 rounded-2xl p-4 text-sm text-violet-800">
            ⏳ Waiting for the manager to review your work.
          </div>
        )}
        {repair.status === 'DONE' && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-sm text-emerald-800">
            ✓ Repair completed and approved by the manager.
          </div>
        )}
        {repair.status === 'REPORTED_BACK' && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
            Manager has been notified about the problem you reported. Awaiting response.
          </div>
        )}
        {repair.status === 'CANCELLED' && (
          <div className="bg-gray-100 border border-gray-200 rounded-2xl p-4 text-sm text-gray-700">
            This repair has been cancelled by the manager.
          </div>
        )}

        {/* Materials used (visible to repairman after submit) */}
        {showWorkSection && repair.materials.length > 0 && (
          <div className="bg-white border border-surface-border rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Package size={14} className="text-ink-muted" />
              <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider">Materials</span>
            </div>
            <div className="space-y-1">
              {repair.materials.map((m) => (
                <div key={m.id} className="flex items-center gap-3 text-sm">
                  <span className="font-semibold text-ink flex-1">{m.material.name}</span>
                  <span className="text-ink-muted">
                    {m.amount} {m.material.unit ?? ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Photos */}
        {showWorkSection && repair.photos.length > 0 && (
          <div className="bg-white border border-surface-border rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <ImageIcon size={14} className="text-ink-muted" />
              <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
                Photos ({repair.photos.length})
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {repair.photos.map((p) => (
                <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer"
                  className="aspect-square rounded-lg bg-surface-sunken overflow-hidden hover:opacity-90 transition">
                  <SignedImage src={p.url} className="w-full h-full object-cover" />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Reports the repairman submitted */}
        {repair.reports.length > 0 && (
          <div className="bg-white border border-surface-border rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <FileWarning size={14} className="text-amber-700" />
              <span className="text-xs font-semibold text-amber-700 uppercase tracking-wider">Your reports</span>
            </div>
            <div className="space-y-2">
              {repair.reports.map((r) => (
                <div key={r.id} className="border border-surface-border rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <UrgencyBadge urgency={r.urgency} />
                    <span className="text-[11px] text-ink-faint">
                      {new Date(r.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm text-ink whitespace-pre-wrap">{r.description}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Comments */}
        <CommentsSection
          repairId={repairId}
          comments={comments}
          onPosted={(c) => setComments((prev) => [...prev, c])}
        />
      </main>

      {/* Action sheets */}
      {showDone && (
        <DoneSheet
          repair={repair}
          onClose={() => setShowDone(false)}
          onSubmitted={async () => { setShowDone(false); await load(); }}
        />
      )}
      {showReport && (
        <ReportSheet
          repair={repair}
          onClose={() => setShowReport(false)}
          onSubmitted={async () => { setShowReport(false); await load(); }}
        />
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────

function UrgencyBadge({ urgency }: { urgency: RepairReportUrgency }) {
  const styles: Record<RepairReportUrgency, string> = {
    LOW:     'bg-stone-100 text-stone-700',
    AVERAGE: 'bg-amber-100 text-amber-800',
    HIGH:    'bg-red-600 text-white',
  };
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${styles[urgency]}`}>
      {urgency}
    </span>
  );
}

function CommentsSection({
  repairId,
  comments,
  onPosted,
}: {
  repairId: string;
  comments: RepairComment[];
  onPosted: (c: RepairComment) => void;
}) {
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [comments.length]);

  async function handleSend() {
    if (!body.trim()) return;
    setSubmitting(true);
    try {
      const c = await repairsApi.addComment(repairId, body.trim());
      onPosted(c);
      setBody('');
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Failed to send');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-white border border-surface-border rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-surface-border flex items-center gap-2">
        <MessageSquare size={14} className="text-ink-muted" />
        <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
          Comments ({comments.length})
        </span>
      </div>
      <div className="max-h-[300px] overflow-y-auto p-3 space-y-3">
        {comments.length === 0 ? (
          <p className="text-sm text-ink-faint italic text-center py-4">
            No comments yet.
          </p>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="flex items-start gap-2">
              <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center ${
                c.authorRole === 'MANAGER' ? 'bg-ink text-white' : 'bg-amber-100 text-amber-800'
              }`}>
                <span className="text-xs font-bold">{c.author.name[0]}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-semibold text-ink">{c.author.name}</span>
                  <span className="text-[10px] text-ink-faint">{new Date(c.createdAt).toLocaleString()}</span>
                </div>
                <p className="text-sm text-ink whitespace-pre-wrap break-words">{c.body}</p>
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
      <div className="border-t border-surface-border p-2 flex gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={1}
          placeholder="Write a comment..."
          className="flex-1 rounded-xl border border-surface-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent resize-none"
          maxLength={2000}
        />
        <button
          onClick={handleSend}
          disabled={submitting || !body.trim()}
          className="px-3 py-2 bg-ink text-white rounded-xl text-sm font-semibold hover:bg-ink-soft transition disabled:opacity-40 flex items-center"
        >
          {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </div>
    </div>
  );
}

function DoneSheet({
  repair,
  onClose,
  onSubmitted,
}: {
  repair: Repair;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [materials, setMaterials] = useState<RepairMaterial[]>([]);
  const [usage, setUsage] = useState<Record<string, { amount: string; note: string }>>({});
  const [comment, setComment] = useState('');
  const [photos, setPhotos] = useState<{ previewUrl: string; publicUrl: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    materialsApi.list(false).then(setMaterials).catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      photos.forEach((p) => p.previewUrl.startsWith('blob:') && URL.revokeObjectURL(p.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleMaterial(mat: RepairMaterial) {
    setUsage((prev) => {
      const next = { ...prev };
      if (next[mat.id]) delete next[mat.id];
      else next[mat.id] = { amount: '', note: '' };
      return next;
    });
  }

  function updateUsage(id: string, field: 'amount' | 'note', value: string) {
    setUsage((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  }

  async function handlePhotoPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (photos.length >= 20) {
      setError('Max 20 photos');
      return;
    }
    setUploading(true);
    setError('');
    const previewUrl = URL.createObjectURL(file);
    try {
      const { publicUrl } = await uploads.uploadToGcs({
        file,
        eventType: 'repair',
        propertyId: repair.propertyId,
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

  function removePhoto(idx: number) {
    setPhotos((p) => {
      const removed = p[idx];
      if (removed?.previewUrl.startsWith('blob:')) URL.revokeObjectURL(removed.previewUrl);
      return p.filter((_, i) => i !== idx);
    });
  }

  async function handleSubmit() {
    setError('');
    // Validate amounts
    const materialsPayload: Array<{ materialId: string; amount: number; note?: string }> = [];
    for (const [matId, u] of Object.entries(usage)) {
      const n = parseFloat(u.amount);
      if (!Number.isFinite(n) || n <= 0) {
        const mat = materials.find((m) => m.id === matId);
        setError(`Enter a valid amount for ${mat?.name ?? 'material'}`);
        return;
      }
      materialsPayload.push({
        materialId: matId,
        amount: n,
        note: u.note.trim() || undefined,
      });
    }

    setSubmitting(true);
    try {
      await repairsApi.submitDone(repair.id, {
        comment: comment.trim() || undefined,
        materials: materialsPayload.length > 0 ? materialsPayload : undefined,
        photoUrls: photos.map((p) => p.publicUrl),
      });
      onSubmitted();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SheetShell title="Submit repair" onClose={onClose}>
      <div className="space-y-4">
        {/* Materials */}
        <div>
          <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
            Materials used (tap to add)
          </label>
          {materials.length === 0 ? (
            <p className="text-xs text-ink-faint italic">
              No materials in the catalog yet. Ask your manager to add some.
            </p>
          ) : (
            <div className="space-y-1.5">
              {materials.map((m) => {
                const used = !!usage[m.id];
                return (
                  <div
                    key={m.id}
                    className={`rounded-xl border-2 transition ${
                      used ? 'bg-ink/5 border-ink' : 'bg-white border-surface-border'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleMaterial(m)}
                      className="w-full text-left px-3 py-2 flex items-center justify-between"
                    >
                      <span className={`text-sm ${used ? 'font-semibold text-ink' : 'text-ink-muted'}`}>
                        {m.name} {m.unit && <span className="text-xs">({m.unit})</span>}
                      </span>
                      <span className={`text-[10px] font-semibold uppercase tracking-wide ${
                        used ? 'text-ink' : 'text-ink-faint'
                      }`}>
                        {used ? '✓ Added' : '+ Add'}
                      </span>
                    </button>
                    {used && (
                      <div className="px-3 pb-3 space-y-2 border-t border-ink/10 pt-2">
                        <input
                          type="number"
                          inputMode="decimal"
                          value={usage[m.id].amount}
                          onChange={(e) => updateUsage(m.id, 'amount', e.target.value)}
                          placeholder={`Amount${m.unit ? ' in ' + m.unit : ''}`}
                          className="w-full rounded-lg border border-surface-border bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                        />
                        <input
                          type="text"
                          value={usage[m.id].note}
                          onChange={(e) => updateUsage(m.id, 'note', e.target.value)}
                          placeholder="Note (optional)"
                          maxLength={200}
                          className="w-full rounded-lg border border-surface-border bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Photos */}
        <div>
          <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
            Photos ({photos.length}/20)
          </label>
          <div className="flex flex-wrap gap-2">
            {photos.map((p, idx) => (
              <div key={idx} className="relative w-20 h-20 rounded-lg bg-surface-sunken overflow-hidden group">
                <img src={p.previewUrl} alt="" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => removePhoto(idx)}
                  className="absolute top-1 right-1 w-5 h-5 bg-black/60 text-white rounded-full flex items-center justify-center"
                >
                  <XIcon size={10} />
                </button>
              </div>
            ))}
            {photos.length < 20 && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="w-20 h-20 rounded-lg border-2 border-dashed border-surface-border hover:border-ink-faint flex items-center justify-center text-ink-muted disabled:opacity-40"
              >
                {uploading ? <Loader2 size={18} className="animate-spin" /> : <ImageIcon size={18} />}
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoPick} />
          </div>
        </div>

        {/* Comment */}
        <div>
          <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
            Note for manager (optional)
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Anything to flag?"
            className="w-full rounded-xl border border-surface-border bg-white px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex gap-2 pt-2 sticky bottom-0 bg-white">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-3 bg-white border border-surface-border text-ink rounded-xl text-sm font-semibold hover:bg-surface-sunken"
          >
            Cancel
          </button>
          <div className="flex-1" />
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-3 bg-ink text-white rounded-xl text-sm font-bold hover:bg-ink-soft transition disabled:opacity-40 flex items-center gap-1.5"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            Submit done
          </button>
        </div>
      </div>
    </SheetShell>
  );
}

function ReportSheet({
  repair,
  onClose,
  onSubmitted,
}: {
  repair: Repair;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [urgency, setUrgency] = useState<RepairReportUrgency>('AVERAGE');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<{ previewUrl: string; publicUrl: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      photos.forEach((p) => p.previewUrl.startsWith('blob:') && URL.revokeObjectURL(p.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handlePhotoPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (photos.length >= 20) {
      setError('Max 20 photos');
      return;
    }
    setUploading(true);
    setError('');
    const previewUrl = URL.createObjectURL(file);
    try {
      const { publicUrl } = await uploads.uploadToGcs({
        file,
        eventType: 'repair',
        propertyId: repair.propertyId,
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

  function removePhoto(idx: number) {
    setPhotos((p) => {
      const removed = p[idx];
      if (removed?.previewUrl.startsWith('blob:')) URL.revokeObjectURL(removed.previewUrl);
      return p.filter((_, i) => i !== idx);
    });
  }

  async function handleSubmit() {
    setError('');
    if (description.trim().length < 3) {
      setError('Please describe the problem');
      return;
    }
    setSubmitting(true);
    try {
      await repairsApi.reportProblem(repair.id, {
        urgency,
        description: description.trim(),
        photoUrls: photos.map((p) => p.publicUrl),
      });
      onSubmitted();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to report');
    } finally {
      setSubmitting(false);
    }
  }

  const urgencyOptions: { value: RepairReportUrgency; label: string; bg: string }[] = [
    { value: 'LOW',     label: 'Low',     bg: 'bg-stone-100 text-stone-700 border-stone-300' },
    { value: 'AVERAGE', label: 'Average', bg: 'bg-amber-100 text-amber-800 border-amber-300' },
    { value: 'HIGH',    label: 'High',    bg: 'bg-red-100 text-red-700 border-red-300' },
  ];

  return (
    <SheetShell title="Report a problem" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
            Urgency
          </label>
          <div className="grid grid-cols-3 gap-2">
            {urgencyOptions.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setUrgency(o.value)}
                className={`py-2.5 rounded-xl border-2 font-bold text-sm transition uppercase ${
                  urgency === o.value ? o.bg + ' ring-2 ring-ink' : 'bg-white border-surface-border text-ink-muted'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
            What&apos;s the problem? *
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            maxLength={1000}
            placeholder="Describe what's wrong, what you've tried, what's needed..."
            className="w-full rounded-xl border border-surface-border bg-white px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
            Photos ({photos.length}/20)
          </label>
          <div className="flex flex-wrap gap-2">
            {photos.map((p, idx) => (
              <div key={idx} className="relative w-20 h-20 rounded-lg bg-surface-sunken overflow-hidden group">
                <img src={p.previewUrl} alt="" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => removePhoto(idx)}
                  className="absolute top-1 right-1 w-5 h-5 bg-black/60 text-white rounded-full flex items-center justify-center"
                >
                  <XIcon size={10} />
                </button>
              </div>
            ))}
            {photos.length < 20 && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="w-20 h-20 rounded-lg border-2 border-dashed border-surface-border hover:border-ink-faint flex items-center justify-center text-ink-muted disabled:opacity-40"
              >
                {uploading ? <Loader2 size={18} className="animate-spin" /> : <ImageIcon size={18} />}
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoPick} />
          </div>
        </div>

        {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex gap-2 pt-2 sticky bottom-0 bg-white">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-3 bg-white border border-surface-border text-ink rounded-xl text-sm font-semibold hover:bg-surface-sunken"
          >
            Cancel
          </button>
          <div className="flex-1" />
          <button
            onClick={handleSubmit}
            disabled={submitting || description.trim().length < 3}
            className="px-4 py-3 bg-amber-600 text-white rounded-xl text-sm font-bold hover:bg-amber-700 transition disabled:opacity-40 flex items-center gap-1.5"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            Report
          </button>
        </div>
      </div>
    </SheetShell>
  );
}

function SheetShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-white rounded-t-3xl md:rounded-2xl shadow-xl max-h-[92vh] overflow-y-auto"
      >
        <div className="sticky top-0 z-10 bg-white border-b border-surface-border px-6 py-4 flex items-center justify-between">
          <h2 className="font-bold text-lg text-ink">{title}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-surface-sunken flex items-center justify-center">
            <XIcon size={18} />
          </button>
        </div>
        <div className="p-6">
          {children}
        </div>
      </div>
    </div>
  );
}
