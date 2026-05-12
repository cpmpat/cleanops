'use client';
import { useLocale } from '@/lib/locale-context';
import { useState, useCallback, useEffect } from 'react';
import { integrations, users as usersApi, assignments as assignApi, type PlanningBooking, type User } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { translations, type Locale } from '@/i18n/translations';
import { StatusBadge, ChannelDot } from '@/components/StatusBadge';
import { formatTime, todayISO, cn } from '@/lib/utils';
import { Search, Filter, Edit2, X, Send, UserPlus, ChevronDown, ArrowLeftRight } from 'lucide-react';
import type { EventStatus } from '@/lib/api';

const STATUSES: EventStatus[] = ['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

export default function PlanningPage() {
  const { locale } = useLocale();
  const t = translations[locale];
  const tp = t.planning;

  // ── Filters ──
  const [arrivalFrom, setArrivalFrom] = useState(todayISO());
  const [arrivalTo, setArrivalTo] = useState('');
  const [creationFrom, setCreationFrom] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [unitSearch, setUnitSearch] = useState('');
  const [refSearch, setRefSearch] = useState('');

  // ── Data ──
  const [bookings, setBookings] = useState<PlanningBooking[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cleaners, setCleaners] = useState<User[]>([]);

  // ── Edit time modal ──
  const [editing, setEditing] = useState<PlanningBooking | null>(null);
  const [editCheckIn, setEditCheckIn] = useState('');
  const [editCheckOut, setEditCheckOut] = useState('');
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<'success' | 'error' | null>(null);

  // ── Assign modal ──
  const [assigning, setAssigning] = useState<PlanningBooking | null>(null);
  const [reassigningUserId, setReassigningUserId] = useState<string | null>(null);
  const [selectedCleaner, setSelectedCleaner] = useState('');
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState('');

  useEffect(() => {
    usersApi.list()
      .then(all => setCleaners(all.filter(u => u.role === 'CLEANER')))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await integrations.planning.list({
        arrivalFrom: arrivalFrom || undefined,
        arrivalTo: arrivalTo || undefined,
        creationDateFrom: creationFrom || undefined,
        status: statusFilter || undefined,
      });
      setBookings(data);
      setLoaded(true);
    } catch {}
    finally { setLoading(false); }
  }, [arrivalFrom, arrivalTo, creationFrom, statusFilter]);

  const filtered = bookings.filter(b => {
    const matchUnit = !unitSearch || b.accommodationName.toLowerCase().includes(unitSearch.toLowerCase());
    const matchRef = !refSearch || b.bookingRef.toLowerCase().includes(refSearch.toLowerCase());
    return matchUnit && matchRef;
  });

  function openEdit(b: PlanningBooking) {
    setEditing(b);
    setEditCheckIn(b.checkInTime ? formatTime(b.checkInTime) : '');
    setEditCheckOut(b.checkOutTime ? formatTime(b.checkOutTime) : '');
    setPushResult(null);
  }

  function openAssign(b: PlanningBooking, oldUserId?: string) {
    setAssigning(b);
    setReassigningUserId(oldUserId ?? null);
    setSelectedCleaner('');
    setAssignError('');
  }

  async function handlePush() {
    if (!editing?.pmsBookingId) return;
    setPushing(true);
    setPushResult(null);
    try {
      const arrDate = editing.checkInTime.split('T')[0];
      const depDate = editing.checkOutTime?.split('T')[0] ?? arrDate;
      await integrations.planning.updateTimes(editing.pmsBookingId, {
        checkInTime: editCheckIn ? `${arrDate}T${editCheckIn}:00.000Z` : undefined,
        checkOutTime: editCheckOut ? `${depDate}T${editCheckOut}:00.000Z` : undefined,
      });
      setPushResult('success');
      setBookings(prev => prev.map(b =>
        b.pmsBookingId === editing.pmsBookingId
          ? {
              ...b,
              checkInTime: `${arrDate}T${editCheckIn}:00.000Z`,
              checkOutTime: editCheckOut ? `${depDate}T${editCheckOut}:00.000Z` : b.checkOutTime,
            }
          : b
      ));
    } catch {
      setPushResult('error');
    } finally {
      setPushing(false);
    }
  }

  async function handleAssign() {
    if (!assigning || !selectedCleaner) return;
    setAssignBusy(true);
    setAssignError('');
    try {
      if (reassigningUserId) {
        await assignApi.reassign(assigning.id, reassigningUserId, selectedCleaner);
      } else {
        await assignApi.assign(assigning.id, selectedCleaner);
      }
      const cleaner = cleaners.find(c => c.id === selectedCleaner);
      setBookings(prev => prev.map(b => {
        if (b.id !== assigning.id) return b;
        if (reassigningUserId) {
          return {
            ...b,
            assignments: b.assignments.map(a =>
              a.userId === reassigningUserId
                ? { ...a, userId: selectedCleaner, userName: cleaner?.name ?? '' }
                : a
            ),
          };
        }
        return {
          ...b,
          assignments: [
            ...b.assignments,
            { id: 'new-' + Date.now(), userId: selectedCleaner, userName: cleaner?.name ?? '', isPrimary: b.assignments.length === 0, status: 'ASSIGNED' as const },
          ],
        };
      }));
      setAssigning(null);
    } catch (e: any) {
      setAssignError(e.message ?? 'Failed to assign');
    } finally {
      setAssignBusy(false);
    }
  }

  return (
    <div className="p-6 max-w-6xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink">{tp.title}</h1>
        <p className="text-sm text-ink-muted mt-0.5">{tp.subtitle}</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-surface-border p-4 mb-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <div>
            <label className="block text-xs font-semibold text-ink-muted mb-1">{tp.filterArrival} {tp.filterFrom}</label>
            <input type="date" value={arrivalFrom} onChange={e => setArrivalFrom(e.target.value)}
              className="w-full text-sm px-3 py-2 rounded-xl border border-surface-border bg-surface focus:outline-none focus:ring-2 focus:ring-accent" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-muted mb-1">{tp.filterArrival} {tp.filterTo}</label>
            <input type="date" value={arrivalTo} onChange={e => setArrivalTo(e.target.value)}
              className="w-full text-sm px-3 py-2 rounded-xl border border-surface-border bg-surface focus:outline-none focus:ring-2 focus:ring-accent" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-muted mb-1">{tp.filterCreated} {tp.filterFrom}</label>
            <input type="date" value={creationFrom} onChange={e => setCreationFrom(e.target.value)}
              className="w-full text-sm px-3 py-2 rounded-xl border border-surface-border bg-surface focus:outline-none focus:ring-2 focus:ring-accent" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-muted mb-1">{tp.filterStatus}</label>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="w-full text-sm px-3 py-2 rounded-xl border border-surface-border bg-surface focus:outline-none focus:ring-2 focus:ring-accent">
              <option value="">{tp.allStatuses}</option>
              {STATUSES.map(s => <option key={s} value={s}>{t.status[s]}</option>)}
            </select>
          </div>
        </div>

        {/* Search row */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              type="text"
              placeholder="Filter by unit name (e.g. Skořepka 4, unit 2)"
              value={unitSearch}
              onChange={e => setUnitSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-surface-border bg-surface focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              type="text"
              placeholder="Filter by booking ref"
              value={refSearch}
              onChange={e => setRefSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-surface-border bg-surface focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 px-5 py-2 bg-ink text-white rounded-xl text-sm font-semibold hover:bg-ink-soft transition disabled:opacity-50"
          >
            <Filter size={14} />
            {loading ? t.general.loading : 'Apply'}
          </button>
        </div>
      </div>

      {/* Results */}
      {!loaded ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-surface-border">
          <Filter size={32} className="mx-auto text-ink-faint mb-3" />
          <p className="text-sm text-ink-muted">Set filters and click Apply to load bookings</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-surface-border">
          <p className="text-sm text-ink-muted">{tp.noBookings}</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-surface-border overflow-hidden">
          <div className="px-4 py-3 border-b border-surface-border">
            <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider">{filtered.length} bookings</p>
          </div>
          <div className="divide-y divide-surface-border">
            {filtered.map(b => (
              <div key={b.id} className="flex items-center gap-3 px-4 py-3.5 hover:bg-surface-sunken transition group">
                {b.status && <StatusBadge status={b.status} t={t} size="sm" />}

                {/* Unit + ref */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">{b.accommodationName}</p>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="font-mono text-xs text-ink-faint">{b.bookingRef}</span>
                    <ChannelDot channel={b.channel} label={t.channel[b.channel] ?? b.channel} />
                  </div>
                </div>

                {/* Times */}
                <div className="text-right flex-shrink-0 w-28">
                  <p className="text-xs font-semibold text-ink">↓ {formatTime(b.checkInTime)}</p>
                  {b.checkOutTime && <p className="text-xs text-ink-muted">↑ {formatTime(b.checkOutTime)}</p>}
                </div>

                {/* Assignees */}
                <div className="flex items-center gap-2 flex-shrink-0 w-52 justify-end">
                  {b.assignments.length === 0 ? (
                    <span className="text-xs text-amber-600 font-medium">⚠ Unassigned</span>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      {b.assignments.slice(0, 2).map(a => (
                        <div key={a.id} className="flex items-center gap-1 bg-surface-sunken rounded-full pl-1 pr-2.5 py-1">
                          <div className="w-5 h-5 rounded-full bg-ink text-white text-[10px] flex items-center justify-center font-bold">
                            {a.userName[0]}
                          </div>
                          <span className="text-xs text-ink-soft max-w-[60px] truncate">{a.userName.split(' ')[0]}</span>
                          {/* Reassign button */}
                          <button
                            onClick={() => openAssign(b, a.userId)}
                            title={`Reassign ${a.userName}`}
                            className="ml-0.5 text-ink-faint hover:text-accent transition"
                          >
                            <ArrowLeftRight size={11} />
                          </button>
                        </div>
                      ))}
                      {b.assignments.length > 2 && (
                        <span className="text-xs text-ink-faint">+{b.assignments.length - 2}</span>
                      )}
                    </div>
                  )}

                  {/* Add cleaner */}
                  {b.assignments.length < 3 && (
                    <button
                      onClick={() => openAssign(b)}
                      title="Assign cleaner"
                      className="p-1.5 rounded-lg text-ink-muted hover:text-accent hover:bg-accent-soft transition"
                    >
                      <UserPlus size={15} />
                    </button>
                  )}

                  {/* Edit times */}
                  {b.pmsBookingId && (
                    <button
                      onClick={() => openEdit(b)}
                      title="Edit check-in/out times"
                      className="p-1.5 rounded-lg text-ink-muted hover:text-accent hover:bg-accent-soft transition opacity-0 group-hover:opacity-100"
                    >
                      <Edit2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Edit times modal ── */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setEditing(null)} />
          <div className="relative bg-white rounded-2xl shadow-modal w-full max-w-sm mx-4 p-6 animate-scale-in">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="font-bold text-ink">{tp.editTimes}</h3>
                <p className="text-xs text-ink-muted mt-0.5 truncate max-w-[220px]">{editing.accommodationName}</p>
              </div>
              <button onClick={() => setEditing(null)} className="p-1.5 rounded-lg hover:bg-surface-sunken text-ink-muted">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-ink-muted mb-1.5">{tp.checkInTime}</label>
                <input type="time" value={editCheckIn} onChange={e => setEditCheckIn(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-surface-border text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-muted mb-1.5">{tp.checkOutTime}</label>
                <input type="time" value={editCheckOut} onChange={e => setEditCheckOut(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-surface-border text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
              </div>
            </div>
            {pushResult === 'success' && (
              <p className="mt-4 text-sm text-emerald-600 bg-emerald-50 rounded-xl px-3 py-2.5 font-medium">{tp.pushed}</p>
            )}
            {pushResult === 'error' && (
              <p className="mt-4 text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2.5">{t.general.error}</p>
            )}
            <button
              onClick={handlePush}
              disabled={pushing || (!editCheckIn && !editCheckOut)}
              className="mt-5 w-full flex items-center justify-center gap-2 py-3 bg-ink text-white rounded-xl font-semibold text-sm hover:bg-ink-soft transition disabled:opacity-50"
            >
              <Send size={15} />
              {pushing ? tp.pushing : tp.pushToAvantio}
            </button>
          </div>
        </div>
      )}

      {/* ── Assign cleaner modal ── */}
      {assigning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setAssigning(null)} />
          <div className="relative bg-white rounded-2xl shadow-modal w-full max-w-sm mx-4 p-6 animate-scale-in">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="font-bold text-ink">
                  {reassigningUserId ? 'Reassign Cleaner' : 'Assign Cleaner'}
                </h3>
                <p className="text-xs text-ink-muted mt-0.5 truncate max-w-[220px]">{assigning.accommodationName}</p>
              </div>
              <button onClick={() => setAssigning(null)} className="p-1.5 rounded-lg hover:bg-surface-sunken text-ink-muted">
                <X size={16} />
              </button>
            </div>

            {/* Current assignees */}
            {assigning.assignments.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">Currently assigned</p>
                <div className="space-y-1.5">
                  {assigning.assignments.map(a => (
                    <div key={a.id} className={cn(
                      'flex items-center gap-2 rounded-xl px-3 py-2',
                      a.userId === reassigningUserId ? 'bg-amber-50 border border-amber-200' : 'bg-surface-sunken',
                    )}>
                      <div className="w-6 h-6 rounded-full bg-ink text-white text-xs flex items-center justify-center font-bold">
                        {a.userName[0]}
                      </div>
                      <span className="text-sm font-medium text-ink flex-1">{a.userName}</span>
                      {a.isPrimary && <span className="text-[10px] text-ink-faint">primary</span>}
                      {a.userId === reassigningUserId && <span className="text-[10px] text-amber-600 font-semibold">replacing</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Cleaner picker */}
            <div className="mb-4">
              <label className="block text-xs font-semibold text-ink-muted mb-1.5">
                {reassigningUserId ? 'Select replacement cleaner' :
                  assigning.assignments.length === 0 ? 'Select primary cleaner' : 'Select secondary cleaner'}
              </label>
              <div className="relative">
                <select
                  value={selectedCleaner}
                  onChange={e => setSelectedCleaner(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-surface-border text-sm focus:outline-none focus:ring-2 focus:ring-accent bg-white appearance-none pr-8"
                >
                  <option value="">— Choose cleaner —</option>
                  {cleaners
                    .filter(c => !assigning.assignments.some(a => a.userId === c.id) || c.id === reassigningUserId)
                    .map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))
                  }
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
              </div>
            </div>

            {assignError && (
              <p className="mb-3 text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{assignError}</p>
            )}

            <button
              onClick={handleAssign}
              disabled={assignBusy || !selectedCleaner}
              className="w-full flex items-center justify-center gap-2 py-3 bg-accent text-white rounded-xl font-semibold text-sm hover:bg-accent-hover transition disabled:opacity-50"
            >
              <UserPlus size={15} />
              {assignBusy ? 'Saving...' : reassigningUserId ? 'Confirm Reassignment' : 'Assign'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
