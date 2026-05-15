'use client';
import { useState, useRef, useEffect } from 'react';
import { assignments as assignApi, uploads, users as usersApi, type CleaningEvent, type User } from '@/lib/api';
import { StatusBadge, TypeBadge, ChannelDot } from './StatusBadge';
import { formatTime, cn } from '@/lib/utils';
import type { Translations } from '@/i18n/translations';
import {
  X, Camera, MapPin, Clock, Users, AlertTriangle,
  CheckCircle2, UserPlus, ChevronDown, ArrowLeftRight,
} from 'lucide-react';

interface EventDetailSheetProps {
  event: CleaningEvent;
  t: Translations;
  userId?: string;
  isManager?: boolean;
  onClose: () => void;
  onUpdate?: (event: CleaningEvent) => void;
  onStatusChange?: () => void;
}

export function EventDetailSheet({
  event, t, userId, isManager, onClose, onUpdate, onStatusChange,
}: EventDetailSheetProps) {
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Manager assignment state
  const [cleaners, setCleaners] = useState<User[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [reassigningUserId, setReassigningUserId] = useState<string | null>(null);
  const [selectedCleaner, setSelectedCleaner] = useState('');
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState('');

  useEffect(() => {
    if (isManager) {
      usersApi.list()
        .then(all => setCleaners(all.filter(u => u.role === 'CLEANER')))
        .catch(() => {});
    }
  }, [isManager]);

  const myAssignment = event.assignments.find(
    a => a.userId === userId && !['REASSIGNED', 'REJECTED'].includes(a.status)
  );
  const activeAssignees = event.assignments.filter(a => a.status !== 'REASSIGNED');
  const canAddMore = activeAssignees.length < 3;
  const availableCleaners = cleaners.filter(
    c => !activeAssignees.some(a => a.userId === c.id) || c.id === reassigningUserId
  );

  // ── Cleaner actions ──
  async function handleStart() {
    if (!myAssignment) return;
    setBusy(true); setActionError('');
    try {
      await assignApi.start(myAssignment.id);
      onStatusChange?.();
      onClose();
    } catch (e: any) { setActionError(e.message); }
    finally { setBusy(false); }
  }

  async function handleComplete() {
    if (!myAssignment) return;
    setBusy(true); setActionError('');
    try {
      await assignApi.complete(myAssignment.id);
      onStatusChange?.();
      onClose();
    } catch (e: any) { setActionError(e.message); }
    finally { setBusy(false); }
  }

  async function handleReject() {
    if (!myAssignment) return;
    setBusy(true); setActionError('');
    try {
      await assignApi.reject(myAssignment.id);
      onStatusChange?.();
      onClose();
    } catch (e: any) { setActionError(e.message); }
    finally { setBusy(false); }
  }

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      await uploads.photo(event.id, file);
      onStatusChange?.();
    } catch (e: any) { setActionError(e.message); }
    finally { setBusy(false); }
  }

  // ── Manager: confirm assign / reassign ──
  async function handleAssignConfirm() {
    if (!selectedCleaner) return;
    setAssignBusy(true); setAssignError('');
    try {
      if (reassigningUserId) {
        await assignApi.reassign(event.id, reassigningUserId, selectedCleaner);
      } else {
        await assignApi.assign(event.id, selectedCleaner);
      }
      setShowPicker(false);
      setReassigningUserId(null);
      setSelectedCleaner('');
      onStatusChange?.();
    } catch (e: any) { setAssignError(e.message ?? 'Failed'); }
    finally { setAssignBusy(false); }
  }

  function openAdd() {
    setReassigningUserId(null);
    setSelectedCleaner('');
    setAssignError('');
    setShowPicker(true);
  }

  function openReassign(oldUserId: string) {
    setReassigningUserId(oldUserId);
    setSelectedCleaner('');
    setAssignError('');
    setShowPicker(true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="relative bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-y-auto shadow-modal animate-slide-up">

        {/* Handle + header */}
        <div className="sticky top-0 bg-white z-10 rounded-t-2xl">
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-surface-sunken" />
          </div>
          <div className="flex items-center justify-between px-5 py-3 border-b border-surface-border">
            <div className="flex items-center gap-2">
              <StatusBadge status={event.status} t={t} />
              <TypeBadge type={event.cleaningType} t={t} />
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-surface-sunken flex items-center justify-center text-ink-muted hover:bg-surface-border transition"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5">

          {/* Property name + address */}
          <div>
            <h2 className="text-lg font-bold text-ink leading-snug">{event.accommodationName}</h2>
            {event.property?.address && (
              <a
                href={`https://maps.google.com/?q=${encodeURIComponent(event.property.address)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-accent mt-1 hover:underline"
              >
                <MapPin size={13} />
                {event.property.address}
              </a>
            )}
          </div>

          {/* Key info grid */}
          <div className="grid grid-cols-2 gap-3">
            <InfoCell label={t.event.timeSlot} icon={<Clock size={13} />}>
              <span className="font-semibold text-ink">{formatTime(event.timeSlot)}</span>
            </InfoCell>
            <InfoCell label={t.event.checkIn} icon={<Clock size={13} />}>
              <span className="text-ink">{formatTime(event.checkInTime)}</span>
            </InfoCell>
            {event.previousGuestCheckOutTime && (() => {
              const prev = new Date(event.previousGuestCheckOutTime);
              const checkIn = new Date(event.checkInTime);
              const sameDay = prev.toDateString() === checkIn.toDateString();
              const gapH = Math.round((checkIn.getTime() - prev.getTime()) / (1000 * 60 * 60));
              const subtitle = sameDay
                ? `${gapH}h gap`
                : prev.toLocaleDateString();
              return (
                <InfoCell label={(t.event as any).previousLeft ?? 'Previous left'} icon={<Clock size={13} />}>
                  <span className="text-ink">{formatTime(event.previousGuestCheckOutTime)}</span>
                  <span className="text-[11px] text-ink-faint ml-1">· {subtitle}</span>
                </InfoCell>
              );
            })()}
            {(() => {
              if (!event.checkOutTime) return null;
              const ms = new Date(event.checkOutTime).getTime() - new Date(event.checkInTime).getTime();
              if (!Number.isFinite(ms) || ms <= 0) return null;
              const nights = Math.round(ms / (1000 * 60 * 60 * 24));
              return (
                <InfoCell label={(t.event as any).lengthOfStay ?? 'Length of stay'} icon={<Clock size={13} />}>
                  <span className="text-ink">
                    {nights} {nights === 1 ? ((t.event as any).night ?? 'night') : ((t.event as any).nights ?? 'nights')}
                  </span>
                </InfoCell>
              );
            })()}
            <InfoCell label={t.event.guests} icon={<Users size={13} />}>
              <span className="text-ink">
                {event.numAdults} {t.event.adults}
                {event.numChildren > 0 && `, ${event.numChildren} ${t.event.children}`}
              </span>
            </InfoCell>
            <InfoCell label={t.event.channel}>
              <ChannelDot channel={event.channel} label={t.channel[event.channel] ?? event.channel} />
            </InfoCell>
            <InfoCell label={t.event.booking}>
              <span className="font-mono text-xs text-ink-muted">{event.bookingRef}</span>
            </InfoCell>
          </div>

          {/* ── Assignees section ── */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
                {t.event.assignedTo}
              </p>
              {isManager && canAddMore && !showPicker && (
                <button
                  onClick={openAdd}
                  className="flex items-center gap-1.5 text-xs text-accent font-semibold hover:underline"
                >
                  <UserPlus size={13} />
                  {activeAssignees.length === 0 ? t.event.assign : t.event.addSecondary}
                </button>
              )}
            </div>

            {/* No assignee warning */}
            {activeAssignees.length === 0 && !showPicker && (
              <div className="flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5">
                <AlertTriangle size={14} className="text-amber-500 flex-shrink-0" />
                <p className="text-xs text-amber-700 font-medium">{t.event.noAssignee}</p>
              </div>
            )}

            {/* Assignee rows */}
            {activeAssignees.length > 0 && (
              <div className="space-y-2">
                {activeAssignees.map(a => (
                  <div
                    key={a.id}
                    className={cn(
                      'flex items-center justify-between rounded-xl px-3 py-2.5',
                      reassigningUserId === a.userId && showPicker
                        ? 'bg-amber-50 border border-amber-200'
                        : 'bg-surface-sunken',
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-ink text-white text-xs flex items-center justify-center font-bold flex-shrink-0">
                        {a.user.name[0]}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-ink">{a.user.name}</p>
                        <p className="text-[10px] text-ink-faint capitalize">{a.isPrimary ? 'primary' : 'secondary'} · {a.status.toLowerCase()}</p>
                      </div>
                    </div>
                    {isManager && (
                      <button
                        onClick={() => openReassign(a.userId)}
                        className="flex items-center gap-1 text-xs text-ink-muted hover:text-accent transition px-2 py-1 rounded-lg hover:bg-white"
                      >
                        <ArrowLeftRight size={12} />
                        {t.event.reassign}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Inline picker */}
            {isManager && showPicker && (
              <div className="mt-3 bg-accent-soft border border-accent/20 rounded-xl p-4">
                <p className="text-xs font-semibold text-accent mb-3">
                  {reassigningUserId
                    ? `Replacing ${activeAssignees.find(a => a.userId === reassigningUserId)?.user.name ?? ''}`
                    : activeAssignees.length === 0 ? 'Assign primary cleaner' : 'Add secondary cleaner'
                  }
                </p>
                <div className="relative mb-3">
                  <select
                    value={selectedCleaner}
                    onChange={e => setSelectedCleaner(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-surface-border text-sm focus:outline-none focus:ring-2 focus:ring-accent bg-white appearance-none pr-8"
                  >
                    <option value="">— Choose cleaner —</option>
                    {availableCleaners.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
                </div>
                {assignError && (
                  <p className="text-xs text-red-600 mb-2">{assignError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={handleAssignConfirm}
                    disabled={assignBusy || !selectedCleaner}
                    className="flex-1 py-2 bg-accent text-white rounded-xl text-sm font-semibold hover:bg-accent-hover transition disabled:opacity-50"
                  >
                    {assignBusy ? 'Saving...' : 'Confirm'}
                  </button>
                  <button
                    onClick={() => { setShowPicker(false); setReassigningUserId(null); }}
                    className="px-4 py-2 border border-surface-border rounded-xl text-sm text-ink-muted hover:bg-surface-sunken transition"
                  >
                    {t.general.cancel}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Manager note */}
          {event.managerNote && (
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3.5">
              <p className="text-xs font-semibold text-amber-700 mb-1">{t.event.note}</p>
              <p className="text-sm text-amber-900">{event.managerNote}</p>
            </div>
          )}

          {/* Supply note */}
          {event.supplyNote && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3.5">
              <p className="text-xs font-semibold text-blue-700 mb-1">{t.event.supplyNote}</p>
              <p className="text-sm text-blue-900">{event.supplyNote}</p>
            </div>
          )}

          {/* Tags */}
          {(event.tags?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {event.tags?.map(({ tag }) => (
                <span
                  key={tag.id}
                  className="px-2.5 py-1 rounded-full text-xs font-medium bg-surface-sunken text-ink-soft border border-surface-border"
                  style={tag.color ? { background: tag.color + '20', borderColor: tag.color + '40', color: tag.color } : {}}
                >
                  {tag.name}
                </span>
              ))}
            </div>
          )}

          {/* Photos */}
          {event.photos.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">{t.event.photos}</p>
              <div className="grid grid-cols-3 gap-2">
                {event.photos.map(p => (
                  <a key={p.id} href={p.url} target="_blank" rel="noopener">
                    <img src={p.url} alt="cleaning photo" className="aspect-square rounded-xl object-cover w-full" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Action error */}
          {actionError && (
            <div className="flex items-center gap-2 bg-red-50 text-red-700 rounded-xl px-3 py-2.5 text-sm">
              <AlertTriangle size={14} />
              {actionError}
            </div>
          )}

          {/* Cleaner actions */}
          {!isManager && myAssignment && (
            <div className="space-y-2 pt-1">
              {myAssignment.status === 'ASSIGNED' && (
                <>
                  <button
                    onClick={handleStart}
                    disabled={busy}
                    className="w-full flex items-center justify-center gap-2 py-3.5 bg-accent text-white rounded-xl font-semibold text-sm hover:bg-accent-hover transition disabled:opacity-50"
                  >
                    {t.event.start}
                  </button>
                  <button
                    onClick={handleReject}
                    disabled={busy}
                    className="w-full py-3 text-red-600 border border-red-200 rounded-xl text-sm font-medium hover:bg-red-50 transition disabled:opacity-50"
                  >
                    {t.event.reject}
                  </button>
                </>
              )}

              {myAssignment.status === 'STARTED' && (
                <>
                  <button
                    onClick={handleComplete}
                    disabled={busy}
                    className="w-full flex items-center justify-center gap-2 py-3.5 bg-emerald-600 text-white rounded-xl font-semibold text-sm hover:bg-emerald-700 transition disabled:opacity-50"
                  >
                    <CheckCircle2 size={18} />
                    {t.event.complete}
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={busy}
                    className="w-full flex items-center justify-center gap-2 py-3 border border-surface-border text-ink-soft rounded-xl text-sm font-medium hover:bg-surface-sunken transition disabled:opacity-50"
                  >
                    <Camera size={16} />
                    {t.event.uploadPhoto}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={handlePhoto}
                  />
                </>
              )}

              {myAssignment.status === 'COMPLETED' && (
                <div className="flex items-center justify-center gap-2 py-3 bg-emerald-50 text-emerald-700 rounded-xl text-sm font-semibold">
                  <CheckCircle2 size={16} />
                  Completed
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoCell({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-surface-sunken rounded-xl p-3">
      <div className="flex items-center gap-1 text-ink-faint mb-1">
        {icon}
        <p className="text-[10px] font-semibold uppercase tracking-wider">{label}</p>
      </div>
      <div className="text-sm">{children}</div>
    </div>
  );
}
