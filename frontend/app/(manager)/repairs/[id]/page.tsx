'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ChevronLeft, Wrench, Calendar, MapPin, Edit2, X as XIcon,
  CheckCircle2, XCircle, AlertTriangle, MessageSquare, Loader2,
  Send, Package, Image as ImageIcon, RefreshCw, FileWarning, Users,
} from 'lucide-react';
import {
  repairs as repairsApi, users as usersApi, ApiError,
} from '@/lib/api';
import type { Repair, RepairComment } from '@/lib/api';
import { RepairStatusBadge } from '@/components/RepairStatusBadge';
import { SignedImage } from '@/components/SignedImage';

export default function RepairDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const repairId = params.id;

  const [repair, setRepair] = useState<Repair | null>(null);
  const [comments, setComments] = useState<RepairComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Modals
  const [showEdit, setShowEdit] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [showReject, setShowReject] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await repairsApi.getById(repairId);
      setRepair(r);
      setComments(r.comments ?? []);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load repair');
    } finally {
      setLoading(false);
    }
  }, [repairId]);

  useEffect(() => { load(); }, [load]);

  // Action handlers
  async function handleApprove() {
    if (!confirm('Approve this repair as completed?')) return;
    try {
      await repairsApi.approve(repairId);
      await load();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Failed to approve');
    }
  }

  async function handleCancel() {
    if (!confirm('Cancel this repair? This cannot be undone.')) return;
    try {
      await repairsApi.cancel(repairId);
      await load();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Failed to cancel');
    }
  }

  if (loading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="h-8 bg-white rounded-xl animate-pulse mb-4" />
        <div className="h-48 bg-white rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (error || !repair) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <Link href="/repairs" className="flex items-center text-xs text-ink-faint hover:text-ink mb-4">
          <ChevronLeft size={14} /> Back to repairs
        </Link>
        <div className="p-4 bg-red-50 text-red-700 rounded-2xl text-sm">
          {error || 'Repair not found'}
        </div>
      </div>
    );
  }

  const canEdit       = !['DONE', 'CANCELLED'].includes(repair.status);
  const canAssign     = !['DONE', 'CANCELLED'].includes(repair.status);
  const canApprove    = repair.status === 'IN_REVIEW';
  const canReject     = repair.status === 'IN_REVIEW';
  const canCancel     = !['DONE', 'CANCELLED'].includes(repair.status);
  const showWork      = ['IN_REVIEW', 'DONE', 'REPORTED_BACK'].includes(repair.status);
  const due = new Date(repair.dueDate);
  const isOverdue = due < new Date() && !['DONE', 'CANCELLED'].includes(repair.status);
  const activeAssignees = repair.assignments.filter(
    (a) => a.status === 'ASSIGNED' || a.status === 'STARTED',
  );
  const primary = activeAssignees.find((a) => a.isPrimary);
  const openReports = repair.reports.filter((r) => !r.resolvedAt);

  return (
    <div className="p-6 max-w-4xl mx-auto pb-32">
      {/* Breadcrumb */}
      <Link href="/repairs" className="flex items-center gap-1 text-xs text-ink-faint hover:text-ink mb-3 transition">
        <ChevronLeft size={14} />
        Back to repairs
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <RepairStatusBadge status={repair.status} />
            {repair.incidentId && (
              <Link
                href={`/incidents/${repair.incidentId}`}
                className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint hover:text-ink transition"
              >
                ← From incident
              </Link>
            )}
          </div>
          <h1 className="text-2xl font-bold text-ink flex items-start gap-2">
            <Wrench size={22} className="text-ink-muted flex-shrink-0 mt-1" />
            <span className="break-words">{repair.title}</span>
          </h1>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={load}
            title="Refresh"
            className="p-2 text-ink-muted hover:text-ink rounded-xl hover:bg-surface-sunken transition"
          >
            <RefreshCw size={16} />
          </button>
          {canEdit && (
            <button
              onClick={() => setShowEdit(true)}
              title="Edit"
              className="p-2 text-ink-muted hover:text-ink rounded-xl hover:bg-surface-sunken transition"
            >
              <Edit2 size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Meta */}
      <div className="bg-white border border-surface-border rounded-2xl p-4 mb-4 space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <MapPin size={14} className="text-ink-muted flex-shrink-0" />
          <span className="font-semibold text-ink truncate">{repair.property.name}</span>
          {repair.property.address && (
            <span className="text-ink-muted text-xs truncate">— {repair.property.address}</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Calendar size={14} className={isOverdue ? 'text-red-600' : 'text-ink-muted'} />
          <span className={isOverdue ? 'font-semibold text-red-600' : 'text-ink'}>
            Due {due.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
          {isOverdue && <span className="text-xs font-semibold text-red-600">OVERDUE</span>}
        </div>
        {repair.description && (
          <p className="text-sm text-ink-muted whitespace-pre-wrap">{repair.description}</p>
        )}
      </div>

      {/* Action bar */}
      {(canApprove || canReject || canAssign || canCancel) && (
        <div className="bg-white border border-surface-border rounded-2xl p-3 mb-4 flex flex-wrap items-center gap-2">
          {canApprove && (
            <button
              onClick={handleApprove}
              className="px-3 py-2 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 transition flex items-center gap-1.5"
            >
              <CheckCircle2 size={16} />
              Approve as complete
            </button>
          )}
          {canReject && (
            <button
              onClick={() => setShowReject(true)}
              className="px-3 py-2 bg-amber-100 text-amber-800 rounded-xl text-sm font-semibold hover:bg-amber-200 transition flex items-center gap-1.5"
            >
              <XCircle size={16} />
              Reject review
            </button>
          )}
          {canAssign && (
            <button
              onClick={() => setShowAssign(true)}
              className="px-3 py-2 bg-white border border-surface-border text-ink rounded-xl text-sm font-semibold hover:bg-surface-sunken transition flex items-center gap-1.5"
            >
              <Users size={16} />
              {activeAssignees.length > 0 ? 'Manage assignees' : 'Assign repairmen'}
            </button>
          )}
          <div className="flex-1" />
          {canCancel && (
            <button
              onClick={handleCancel}
              className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-xl text-sm font-semibold transition flex items-center gap-1.5"
            >
              <XIcon size={16} />
              Cancel repair
            </button>
          )}
        </div>
      )}

      {/* Assignees */}
      <div className="bg-white border border-surface-border rounded-2xl p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Users size={14} className="text-ink-muted" />
          <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider">Assigned</span>
        </div>
        {activeAssignees.length === 0 ? (
          <p className="text-sm text-ink-faint italic">No active assignees</p>
        ) : (
          <div className="space-y-1.5">
            {activeAssignees.map((a) => (
              <div key={a.id} className="flex items-center gap-3 px-2 py-1.5 rounded-lg">
                <div className="w-7 h-7 rounded-full bg-ink/10 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-ink">{a.user.name[0]}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">{a.user.name}</p>
                  <p className="text-[11px] text-ink-faint truncate">{a.user.email}</p>
                </div>
                {a.isPrimary && (
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-ink">★ Primary</span>
                )}
                <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                  {a.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reports (problems reported back) */}
      {openReports.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <FileWarning size={14} className="text-red-700" />
            <span className="text-xs font-semibold text-red-700 uppercase tracking-wider">Problems reported</span>
          </div>
          <div className="space-y-3">
            {openReports.map((r) => (
              <div key={r.id} className="bg-white border border-red-200 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <UrgencyBadge urgency={r.urgency} />
                  <span className="text-[11px] text-ink-muted">
                    {r.author.name} • {new Date(r.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm text-ink whitespace-pre-wrap">{r.description}</p>
                {r.photoUrls.length > 0 && (
                  <div className="grid grid-cols-4 gap-1.5 mt-2">
                    {r.photoUrls.map((url, idx) => (
                      <div key={idx} className="aspect-square rounded-lg bg-surface-sunken overflow-hidden">
                        <SignedImage src={url} className="w-full h-full object-cover" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Materials used (when work submitted) */}
      {showWork && repair.materials.length > 0 && (
        <div className="bg-white border border-surface-border rounded-2xl p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Package size={14} className="text-ink-muted" />
            <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider">Materials used</span>
          </div>
          <div className="space-y-1.5">
            {repair.materials.map((m) => (
              <div key={m.id} className="flex items-center gap-3 px-2 py-1.5 text-sm">
                <span className="font-semibold text-ink flex-1">{m.material.name}</span>
                <span className="text-ink-muted">
                  {m.amount} {m.material.unit ?? ''}
                </span>
                {m.note && <span className="text-[11px] text-ink-faint truncate max-w-[40%]">{m.note}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Photos */}
      {showWork && repair.photos.length > 0 && (
        <div className="bg-white border border-surface-border rounded-2xl p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <ImageIcon size={14} className="text-ink-muted" />
            <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
              Photos ({repair.photos.length})
            </span>
          </div>
          <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
            {repair.photos.map((p) => (
              <a
                key={p.id}
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="aspect-square rounded-lg bg-surface-sunken overflow-hidden hover:opacity-90 transition"
              >
                <SignedImage src={p.url} className="w-full h-full object-cover" />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Comments thread */}
      <CommentsSection
        repairId={repairId}
        comments={comments}
        onPosted={async (c) => {
          setComments((prev) => [...prev, c]);
        }}
      />

      {/* Modals */}
      {showEdit && (
        <EditRepairModal
          repair={repair}
          onClose={() => setShowEdit(false)}
          onSaved={async () => { setShowEdit(false); await load(); }}
        />
      )}
      {showAssign && (
        <AssignModal
          repair={repair}
          onClose={() => setShowAssign(false)}
          onSaved={async () => { setShowAssign(false); await load(); }}
        />
      )}
      {showReject && (
        <RejectReviewModal
          repairId={repairId}
          onClose={() => setShowReject(false)}
          onSaved={async () => { setShowReject(false); await load(); }}
        />
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────

function UrgencyBadge({ urgency }: { urgency: 'LOW' | 'AVERAGE' | 'HIGH' }) {
  const styles = {
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

      <div className="max-h-[400px] overflow-y-auto p-4 space-y-3">
        {comments.length === 0 ? (
          <p className="text-sm text-ink-faint italic text-center py-4">
            No comments yet — start the conversation below.
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
                  <span className="text-[10px] text-ink-faint">
                    {new Date(c.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm text-ink whitespace-pre-wrap break-words">{c.body}</p>
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-surface-border p-3 flex gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              handleSend();
            }
          }}
          rows={1}
          placeholder="Write a comment... (⌘+Enter to send)"
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

function EditRepairModal({
  repair,
  onClose,
  onSaved,
}: {
  repair: Repair;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(repair.title);
  const [description, setDescription] = useState(repair.description ?? '');
  const [dueDate, setDueDate] = useState(repair.dueDate.slice(0, 10));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    if (!title.trim() || !dueDate) {
      setError('Title and due date are required');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await repairsApi.update(repair.id, {
        title: title.trim(),
        description: description.trim() || undefined,
        dueDate: new Date(dueDate + 'T23:59:59').toISOString(),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell title="Edit repair" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Title *">
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={inputClass} />
        </Field>
        <Field label="Description">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={1000} className={inputClass + ' resize-none'} />
        </Field>
        <Field label="Due date *">
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
        </Field>
        {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        <ModalActions onCancel={onClose} onConfirm={handleSave} submitting={submitting} confirmLabel="Save" />
      </div>
    </ModalShell>
  );
}

function AssignModal({
  repair,
  onClose,
  onSaved,
}: {
  repair: Repair;
  onClose: () => void;
  onSaved: () => void;
}) {
  const activeIds = repair.assignments
    .filter((a) => a.status === 'ASSIGNED' || a.status === 'STARTED')
    .map((a) => a.userId);
  const currentPrimary = repair.assignments.find((a) => a.isPrimary && (a.status === 'ASSIGNED' || a.status === 'STARTED'))?.userId;

  const [selectedIds, setSelectedIds] = useState<string[]>(activeIds);
  const [primaryId, setPrimaryId] = useState<string>(currentPrimary ?? '');
  const [repairmen, setRepairmen] = useState<Array<{ id: string; name: string; email: string }>>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
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

  function toggle(userId: string) {
    setSelectedIds((prev) => {
      const next = prev.includes(userId) ? prev.filter((x) => x !== userId) : [...prev, userId];
      if (next.length > 0 && (!primaryId || !next.includes(primaryId))) setPrimaryId(next[0]);
      else if (next.length === 0) setPrimaryId('');
      return next;
    });
  }

  async function handleSave() {
    if (selectedIds.length === 0) {
      setError('At least one assignee required (or cancel the repair instead).');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await repairsApi.assign(repair.id, {
        userIds: selectedIds,
        primaryUserId: primaryId || selectedIds[0],
      });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to assign');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell title="Manage assignees" onClose={onClose}>
      <div className="space-y-4">
        {repairmen.length === 0 ? (
          <p className="text-sm text-ink-faint italic text-center py-4">
            No active repairmen in your team.
          </p>
        ) : (
          <div className="space-y-1.5">
            {repairmen.map((r) => {
              const isSelected = selectedIds.includes(r.id);
              const isPrimary = primaryId === r.id;
              return (
                <label
                  key={r.id}
                  className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition ${
                    isSelected ? 'bg-ink/5 border-ink' : 'bg-white border-surface-border hover:border-ink-faint'
                  }`}
                >
                  <input type="checkbox" checked={isSelected} onChange={() => toggle(r.id)} className="w-4 h-4 rounded" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink truncate">{r.name}</p>
                    <p className="text-xs text-ink-muted truncate">{r.email}</p>
                  </div>
                  {isSelected && (
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); setPrimaryId(r.id); }}
                      className={`px-2 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-wide transition ${
                        isPrimary ? 'bg-ink text-white' : 'bg-white border border-surface-border text-ink-muted hover:border-ink-faint'
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
        {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        <ModalActions onCancel={onClose} onConfirm={handleSave} submitting={submitting} confirmLabel="Save" />
      </div>
    </ModalShell>
  );
}

function RejectReviewModal({
  repairId,
  onClose,
  onSaved,
}: {
  repairId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit() {
    setSubmitting(true);
    setError('');
    try {
      await repairsApi.rejectReview(repairId, note.trim() || undefined);
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to reject');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell title="Reject review" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-ink-muted">
          The repairman will be notified and the repair will go back to In Progress. Add a note explaining what needs to be fixed:
        </p>
        <Field label="Note (will be posted as a comment)">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} maxLength={500}
            placeholder="What needs to be redone?" className={inputClass + ' resize-none'} />
        </Field>
        {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        <ModalActions onCancel={onClose} onConfirm={handleSubmit} submitting={submitting} confirmLabel="Reject" confirmClassName="bg-amber-600 hover:bg-amber-700" />
      </div>
    </ModalShell>
  );
}

// ─── Shared modal primitives ───

const inputClass =
  'w-full rounded-xl border border-surface-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">{label}</label>
      {children}
    </div>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 p-0 md:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg bg-white rounded-t-3xl md:rounded-2xl shadow-xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-lg text-ink">{title}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-surface-sunken flex items-center justify-center">
            <XIcon size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalActions({
  onCancel,
  onConfirm,
  submitting,
  confirmLabel,
  confirmClassName = 'bg-ink hover:bg-ink-soft',
}: {
  onCancel: () => void;
  onConfirm: () => void;
  submitting: boolean;
  confirmLabel: string;
  confirmClassName?: string;
}) {
  return (
    <div className="flex gap-2 pt-2">
      <button onClick={onCancel} disabled={submitting}
        className="px-4 py-2.5 bg-white border border-surface-border text-ink rounded-xl text-sm font-semibold hover:bg-surface-sunken transition">
        Cancel
      </button>
      <div className="flex-1" />
      <button onClick={onConfirm} disabled={submitting}
        className={`px-4 py-2.5 text-white rounded-xl text-sm font-semibold transition disabled:opacity-40 flex items-center gap-1.5 ${confirmClassName}`}>
        {submitting && <Loader2 size={14} className="animate-spin" />}
        {confirmLabel}
      </button>
    </div>
  );
}
