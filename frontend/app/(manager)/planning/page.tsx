'use client';
import { useLocale } from '@/lib/locale-context';
import { useState, useCallback, useEffect, useMemo } from 'react';
import { integrations, bookings as bookingsApi, users as usersApi, turnovers as turnoversApi, type PlanningBooking, type User } from '@/lib/api';
import { translations } from '@/i18n/translations';
import { StatusBadge, ChannelDot } from '@/components/StatusBadge';
import { formatTime, formatOccupancy, todayISO, cn } from '@/lib/utils';
import { Search, Filter, X, Send, UserPlus, ChevronDown, ArrowLeftRight, AlertCircle, Check, RotateCcw, Users, Baby, BedSingle, Flame } from 'lucide-react';
import type { TurnoverStatus } from '@/lib/api';

/** Arrival-turnover statuses the desk can filter on. CANCELLED/SKIPPED rows are never listed. */
const STATUSES: TurnoverStatus[] = ['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'FLAGGED'];

/** YYYY-MM-DD in Europe/Prague — the day a cleaner would call "today". */
const pragueDay = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' });

/**
 * Same rule as the cleaner's card: the guest arrives today and the turnover
 * was only created today — so nobody planned for it yesterday. Kept identical
 * so the desk and the cleaner never disagree about which job is the fire.
 */
function isLastMinute(b: PlanningBooking): boolean {
  if (!b.turnoverCreatedAt || b.status === 'COMPLETED') return false;
  const today = pragueDay(new Date().toISOString());
  return pragueDay(b.checkInTime) === today && pragueDay(b.turnoverCreatedAt) === today;
}

/** Quick arrival windows, measured from *now* — not from midnight. */
type QuickWindow = 24 | 48 | 72;

/**
 * One row's unsaved edit. Values are "HH:mm" in Europe/Prague — exactly what
 * the input shows and exactly what the backend receives. The date is the
 * booking's own arrival / departure day and is resolved server-side; the
 * client never builds an instant, because the last time it did it labelled
 * Prague wall-clock as UTC and 15:10 became 17:10 everywhere.
 */
type Draft = { checkIn: string; checkOut: string };
type RowState = 'pushing' | 'ok' | 'error';

/** How many rows are pushed to Avantio at once. Small: Avantio rate-limits, and one PUT is ~1 s. */
const PUSH_CONCURRENCY = 3;

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
  // Bookings whose check-in time we assumed (15:00) because the PMS sent 00:00 / nothing.
  const [onlyUnconfirmed, setOnlyUnconfirmed] = useState(false);
  // A quick window overrides the date inputs while it is active.
  const [quick, setQuick] = useState<QuickWindow | null>(null);

  // ── Data ──
  const [bookings, setBookings] = useState<PlanningBooking[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cleaners, setCleaners] = useState<User[]>([]);

  // ── Inline time edits ──
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [pushingAll, setPushingAll] = useState(false);
  // Setup-request toggles save on click; this holds the ids mid-flight / failed.
  const [flagBusy, setFlagBusy] = useState<Record<string, 'saving' | 'error'>>({});

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

  const load = useCallback(async (window: QuickWindow | null = quick) => {
    setLoading(true);
    try {
      const now = new Date();
      const data = await integrations.planning.list({
        arrivalFrom: window ? now.toISOString() : (arrivalFrom || undefined),
        arrivalTo: window ? new Date(now.getTime() + window * 3_600_000).toISOString() : (arrivalTo || undefined),
        creationDateFrom: creationFrom || undefined,
        status: statusFilter || undefined,
      });
      setBookings(data);
      setDrafts({});
      setRowState({});
      setLoaded(true);
    } catch {}
    finally { setLoading(false); }
  }, [quick, arrivalFrom, arrivalTo, creationFrom, statusFilter]);

  function pickQuick(w: QuickWindow) {
    const next = quick === w ? null : w;
    setQuick(next);
    if (next) void load(next);
  }

  const unconfirmedCount = bookings.filter(b => b.checkInSource === 'FALLBACK').length;

  const filtered = bookings.filter(b => {
    const matchUnit = !unitSearch || b.accommodationName.toLowerCase().includes(unitSearch.toLowerCase());
    const matchRef = !refSearch || b.bookingRef.toLowerCase().includes(refSearch.toLowerCase())
      || (b.guestName ?? '').toLowerCase().includes(refSearch.toLowerCase());
    const matchUnconfirmed = !onlyUnconfirmed || b.checkInSource === 'FALLBACK';
    return matchUnit && matchRef && matchUnconfirmed;
  });

  // ── Draft bookkeeping ──
  const stored = (b: PlanningBooking): Draft => ({
    checkIn: formatTime(b.checkInTime),
    checkOut: b.checkOutTime ? formatTime(b.checkOutTime) : '',
  });

  function isDirty(b: PlanningBooking): boolean {
    const d = drafts[b.id];
    if (!d) return false;
    const s = stored(b);
    return d.checkIn !== s.checkIn || d.checkOut !== s.checkOut;
  }

  function setDraft(b: PlanningBooking, patch: Partial<Draft>) {
    setDrafts(prev => ({ ...prev, [b.id]: { ...(prev[b.id] ?? stored(b)), ...patch } }));
    setRowState(prev => without(prev, b.id));
  }

  function discardDraft(b: PlanningBooking) {
    setDrafts(prev => without(prev, b.id));
    setRowState(prev => without(prev, b.id));
  }

  const dirtyRows = useMemo(
    () => bookings.filter(b => b.pmsBookingId && isDirty(b)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookings, drafts],
  );

  /** Push one row. Sends only the fields that changed; HH:mm, Prague. */
  async function pushRow(b: PlanningBooking): Promise<boolean> {
    const d = drafts[b.id];
    if (!d || !b.pmsBookingId) return false;
    const s = stored(b);
    const body: { checkInTime?: string; checkOutTime?: string } = {};
    if (d.checkIn && d.checkIn !== s.checkIn) body.checkInTime = d.checkIn;
    if (d.checkOut && d.checkOut !== s.checkOut) body.checkOutTime = d.checkOut;
    if (!body.checkInTime && !body.checkOutTime) { discardDraft(b); return true; }

    setRowState(prev => ({ ...prev, [b.id]: 'pushing' }));
    try {
      await integrations.planning.updateTimes(b.pmsBookingId, body);
      // Reflect what the server now holds. Re-anchor on the booking's own day
      // in Prague — the same rule the backend applied — so the row shows the
      // typed time without a reload and without inventing a UTC instant.
      setBookings(prev => prev.map(x => x.id !== b.id ? x : {
        ...x,
        checkInTime: body.checkInTime ? withPragueTime(x.checkInTime, body.checkInTime) : x.checkInTime,
        checkOutTime: body.checkOutTime ? withPragueTime(x.checkOutTime ?? x.checkInTime, body.checkOutTime) : x.checkOutTime,
        checkInSource: body.checkInTime ? ('MANAGER' as const) : x.checkInSource,
        checkOutSource: body.checkOutTime ? ('MANAGER' as const) : x.checkOutSource,
      }));
      setDrafts(prev => without(prev, b.id));
      setRowState(prev => ({ ...prev, [b.id]: 'ok' }));
      setTimeout(() => setRowState(prev => (prev[b.id] === 'ok' ? without(prev, b.id) : prev)), 2500);
      return true;
    } catch {
      setRowState(prev => ({ ...prev, [b.id]: 'error' }));
      return false;
    }
  }

  /** Push every dirty row, a few at a time. Failed rows stay dirty and marked. */
  async function pushAll() {
    if (pushingAll || dirtyRows.length === 0) return;
    setPushingAll(true);
    try {
      const queue = [...dirtyRows];
      const workers = Array.from({ length: Math.min(PUSH_CONCURRENCY, queue.length) }, async () => {
        for (let b = queue.shift(); b; b = queue.shift()) await pushRow(b);
      });
      await Promise.all(workers);
    } finally {
      setPushingAll(false);
    }
  }

  function discardAll() {
    setDrafts({});
    setRowState({});
  }

  /**
   * Crib / separate beds. These are ours, not Avantio's: saved straight to the
   * booking row via PATCH /bookings/:id, never pushed to the PMS, never
   * overwritten by the sync. Optimistic, reverted on failure.
   */
  async function toggleFlag(b: PlanningBooking, key: 'needsCrib' | 'separateBeds') {
    const next = !b[key];
    setBookings(prev => prev.map(x => (x.id === b.id ? { ...x, [key]: next } : x)));
    setFlagBusy(prev => ({ ...prev, [b.id]: 'saving' }));
    try {
      await bookingsApi.update(b.id, { [key]: next });
      setFlagBusy(prev => without(prev, b.id));
    } catch {
      setBookings(prev => prev.map(x => (x.id === b.id ? { ...x, [key]: !next } : x)));
      setFlagBusy(prev => ({ ...prev, [b.id]: 'error' }));
      setTimeout(() => setFlagBusy(prev => (prev[b.id] === 'error' ? without(prev, b.id) : prev)), 3000);
    }
  }

  // ── Assign ──
  function openAssign(b: PlanningBooking, oldUserId?: string) {
    setAssigning(b);
    setReassigningUserId(oldUserId ?? null);
    setSelectedCleaner('');
    setAssignError('');
  }

  async function handleAssign() {
    if (!assigning || !selectedCleaner) return;
    if (!assigning.turnoverId) { setAssignError(tp.noTurnover); return; }
    setAssignBusy(true);
    setAssignError('');
    try {
      // Assignments live on the turnover — the row the cleaner claims, starts
      // and marks done. The old /assignments/* calls wrote to the legacy
      // Cleaning row, which the cleaner app no longer reads.
      if (reassigningUserId) {
        await turnoversApi.unassign(assigning.turnoverId, reassigningUserId);
      }
      const isPrimary = reassigningUserId
        ? assigning.assignments.find(a => a.userId === reassigningUserId)?.isPrimary
        : assigning.assignments.length === 0;
      await turnoversApi.assign(assigning.turnoverId, selectedCleaner, isPrimary);
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
      // A fresh assignment moves the turnover out of the pool.
      setBookings(prev => prev.map(b => (b.id === assigning.id && b.status === 'PENDING' ? { ...b, status: 'ASSIGNED' } : b)));
      setAssigning(null);
    } catch (e: any) {
      setAssignError(e.message ?? tp.assignFailed);
    } finally {
      setAssignBusy(false);
    }
  }

  const quickBtn = (w: QuickWindow, label: string) => (
    <button
      key={w}
      type="button"
      onClick={() => pickQuick(w)}
      className={cn(
        'px-3 py-2 rounded-xl text-sm font-semibold border transition',
        quick === w
          ? 'bg-ink text-white border-ink'
          : 'bg-surface border-surface-border text-ink-muted hover:text-ink'
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="p-6 max-w-6xl pb-28">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink">{tp.title}</h1>
        <p className="text-sm text-ink-muted mt-0.5">{tp.subtitle} · {tp.inlineHint}</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-surface-border p-4 mb-4">
        {/* Quick windows */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider mr-1">{tp.filterArrival}</span>
          {quickBtn(24, tp.next24)}
          {quickBtn(48, tp.next48)}
          {quickBtn(72, tp.next72)}
        </div>

        <div className={cn('grid grid-cols-2 md:grid-cols-4 gap-3 mb-3 transition', quick && 'opacity-50')}>
          <div>
            <label className="block text-xs font-semibold text-ink-muted mb-1">{tp.filterArrival} {tp.filterFrom}</label>
            <input type="date" value={arrivalFrom} onChange={e => { setQuick(null); setArrivalFrom(e.target.value); }}
              className="w-full text-sm px-3 py-2 rounded-xl border border-surface-border bg-surface focus:outline-none focus:ring-2 focus:ring-accent" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-muted mb-1">{tp.filterArrival} {tp.filterTo}</label>
            <input type="date" value={arrivalTo} onChange={e => { setQuick(null); setArrivalTo(e.target.value); }}
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
              {STATUSES.map(s => <option key={s} value={s}>{t.status[s as keyof typeof t.status] ?? s}</option>)}
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
              placeholder="Filter by booking ref or guest"
              value={refSearch}
              onChange={e => setRefSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-surface-border bg-surface focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <button
            type="button"
            onClick={() => setOnlyUnconfirmed(v => !v)}
            title={tp.unconfirmedHint}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition',
              onlyUnconfirmed
                ? 'bg-amber-100 border-amber-400 text-amber-900'
                : 'bg-surface border-surface-border text-ink-muted hover:text-ink'
            )}
          >
            <AlertCircle size={14} />
            {tp.unconfirmedFilter}
            {unconfirmedCount > 0 && (
              <span className={cn(
                'text-[11px] font-bold rounded-full px-1.5 py-0.5 leading-none',
                onlyUnconfirmed ? 'bg-amber-400 text-amber-950' : 'bg-amber-100 text-amber-800'
              )}>
                {unconfirmedCount}
              </span>
            )}
          </button>
          <button
            onClick={() => void load(null)}
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
          <div className="px-4 py-3 border-b border-surface-border flex items-center justify-between">
            <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider">{filtered.length} bookings</p>
            <p className="text-xs text-ink-faint">{tp.checkInTime} ↓ · {tp.checkOutTime} ↑ · Europe/Prague</p>
          </div>
          <div className="divide-y divide-surface-border">
            {filtered.map(b => {
              const d = drafts[b.id] ?? stored(b);
              const dirty = isDirty(b);
              const state = rowState[b.id];
              const editable = !!b.pmsBookingId;
              const lastMinute = isLastMinute(b);
              const done = b.status === 'COMPLETED';
              return (
                <div
                  key={b.id}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 transition group',
                    dirty ? 'bg-amber-50/70' : 'hover:bg-surface-sunken',
                    state === 'error' && 'bg-red-50',
                    lastMinute && !dirty && 'border-l-4 border-l-red-400',
                    done && 'opacity-70',
                  )}
                >
                  {/* Arrival-turnover status: what the cleaner did with it. */}
                  {b.status ? (
                    <StatusBadge status={b.status as any} t={t} size="sm" />
                  ) : (
                    <span className="text-[11px] text-ink-faint w-16 text-center" title={tp.noTurnover}>—</span>
                  )}

                  {/* Unit + guest + ref */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink truncate flex items-center gap-2">
                      {b.accommodationName}
                      {lastMinute && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 text-red-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide flex-shrink-0">
                          <Flame size={10} />
                          {tp.lastMinute}
                        </span>
                      )}
                    </p>
                    <div className="flex items-center gap-3 mt-0.5 min-w-0">
                      {b.guestName && (
                        <span className="text-xs text-ink-soft truncate max-w-[220px]" title={`${tp.guest}: ${b.guestName}`}>
                          {b.guestName}
                        </span>
                      )}
                      <span className="font-mono text-xs text-ink-faint">{b.bookingRef}</span>
                      <ChannelDot channel={b.channel} label={t.channel[b.channel] ?? b.channel} />
                    </div>
                  </div>

                  {/* Guests — same "adults+children" reading the cleaner's card uses */}
                  <span
                    className="flex items-center gap-1 text-xs text-ink-soft tabular-nums flex-shrink-0 w-12"
                    title={`${tp.guests}: ${b.numAdults} + ${b.numChildren}`}
                  >
                    <Users size={13} className="text-ink-faint" />
                    {formatOccupancy(b.numAdults, b.numChildren)}
                  </span>

                  {/* Setup requests — local only, cleaner sees them on the card */}
                  <div className="flex items-center gap-1 flex-shrink-0" title={tp.localOnly}>
                    <button
                      type="button"
                      onClick={() => void toggleFlag(b, 'needsCrib')}
                      disabled={flagBusy[b.id] === 'saving'}
                      aria-pressed={!!b.needsCrib}
                      title={`${tp.crib} — ${tp.localOnly}`}
                      className={cn(
                        'p-1.5 rounded-lg border transition disabled:opacity-60',
                        b.needsCrib
                          ? 'bg-sky-50 border-sky-300 text-sky-800'
                          : 'border-transparent text-ink-faint hover:text-ink hover:bg-surface-sunken',
                      )}
                    >
                      <Baby size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleFlag(b, 'separateBeds')}
                      disabled={flagBusy[b.id] === 'saving'}
                      aria-pressed={!!b.separateBeds}
                      title={`${tp.separateBeds} — ${tp.localOnly}`}
                      className={cn(
                        'p-1.5 rounded-lg border transition disabled:opacity-60',
                        b.separateBeds
                          ? 'bg-violet-50 border-violet-300 text-violet-800'
                          : 'border-transparent text-ink-faint hover:text-ink hover:bg-surface-sunken',
                      )}
                    >
                      <BedSingle size={15} />
                    </button>
                    {flagBusy[b.id] === 'error' && (
                      <span className="text-[11px] text-red-600 font-medium" title={tp.saveFailed}>!</span>
                    )}
                  </div>

                  {/* Times — inline */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {b.checkInSource === 'FALLBACK' && !dirty && (
                      <span title={tp.unconfirmedHint} className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                    )}
                    <label className="flex items-center gap-1 text-xs text-ink-muted">
                      <span aria-hidden>↓</span>
                      <input
                        type="time"
                        value={d.checkIn}
                        disabled={!editable || state === 'pushing'}
                        onChange={e => setDraft(b, { checkIn: e.target.value })}
                        onKeyDown={e => { if (e.key === 'Enter' && dirty) void pushRow(b); }}
                        aria-label={tp.checkInTime}
                        className={cn(
                          'w-[7.25rem] px-2.5 py-1.5 rounded-lg border text-sm font-semibold text-ink tabular-nums focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-60',
                          dirty && d.checkIn !== stored(b).checkIn ? 'border-amber-400 bg-white' : 'border-surface-border bg-transparent',
                        )}
                      />
                    </label>
                    <label className="flex items-center gap-1 text-xs text-ink-muted">
                      <span aria-hidden>↑</span>
                      <input
                        type="time"
                        value={d.checkOut}
                        disabled={!editable || state === 'pushing'}
                        onChange={e => setDraft(b, { checkOut: e.target.value })}
                        onKeyDown={e => { if (e.key === 'Enter' && dirty) void pushRow(b); }}
                        aria-label={tp.checkOutTime}
                        className={cn(
                          'w-[7.25rem] px-2.5 py-1.5 rounded-lg border text-sm text-ink-muted tabular-nums focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-60',
                          dirty && d.checkOut !== stored(b).checkOut ? 'border-amber-400 bg-white' : 'border-surface-border bg-transparent',
                        )}
                      />
                    </label>

                    {/* Row action: push / undo / result */}
                    <div className="w-16 flex items-center justify-end gap-1">
                      {state === 'pushing' && <span className="text-[11px] text-ink-faint">{tp.pushing}</span>}
                      {state === 'ok' && <Check size={15} className="text-emerald-600" />}
                      {state === 'error' && <span className="text-[11px] text-red-600 font-medium" title={tp.pushFailed}>!</span>}
                      {dirty && state !== 'pushing' && (
                        <>
                          <button
                            onClick={() => void pushRow(b)}
                            title={tp.pushToAvantio}
                            className="p-1.5 rounded-lg text-ink hover:text-accent hover:bg-accent-soft transition"
                          >
                            <Send size={14} />
                          </button>
                          <button
                            onClick={() => discardDraft(b)}
                            title={tp.discard}
                            className="p-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-surface-sunken transition"
                          >
                            <RotateCcw size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Assignees */}
                  <div className="flex items-center gap-2 flex-shrink-0 w-44 justify-end">
                    {b.assignments.length === 0 ? (
                      b.turnoverId && !done
                        ? <span className="text-xs text-amber-600 font-medium">⚠ Unassigned</span>
                        : <span className="text-xs text-ink-faint" />
                    ) : (
                      <div className="flex items-center gap-1.5">
                        {b.assignments.slice(0, 2).map(a => (
                          <div key={a.id} className="flex items-center gap-1 bg-surface-sunken rounded-full pl-1 pr-2.5 py-1">
                            <div className="w-5 h-5 rounded-full bg-ink text-white text-[10px] flex items-center justify-center font-bold">
                              {a.userName[0]}
                            </div>
                            <span className="text-xs text-ink-soft max-w-[60px] truncate">{a.userName.split(' ')[0]}</span>
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
                    {b.turnoverId && !done && b.assignments.length < 3 && (
                      <button
                        onClick={() => openAssign(b)}
                        title="Assign cleaner"
                        className="p-1.5 rounded-lg text-ink-muted hover:text-accent hover:bg-accent-soft transition"
                      >
                        <UserPlus size={15} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Sticky push bar ── */}
      {dirtyRows.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 pointer-events-none">
          <div className="max-w-6xl mx-auto px-6 pb-5">
            <div className="pointer-events-auto flex items-center gap-3 bg-ink text-white rounded-2xl shadow-modal px-5 py-3 animate-scale-in">
              <span className="text-sm font-semibold flex-1">
                {dirtyRows.length === 1 ? tp.pendingOne : `${dirtyRows.length} ${tp.pendingMany}`}
              </span>
              <button
                onClick={discardAll}
                disabled={pushingAll}
                className="px-3 py-2 rounded-xl text-sm font-medium text-white/80 hover:text-white hover:bg-white/10 transition disabled:opacity-50"
              >
                {tp.discard}
              </button>
              <button
                onClick={() => void pushAll()}
                disabled={pushingAll}
                className="flex items-center gap-2 px-4 py-2 bg-white text-ink rounded-xl text-sm font-semibold hover:bg-surface transition disabled:opacity-50"
              >
                <Send size={14} />
                {pushingAll ? tp.pushing : tp.pushAll}
              </button>
            </div>
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

/** A copy of `obj` without `key`. */
function without<T>(obj: Record<string, T>, key: string): Record<string, T> {
  if (!(key in obj)) return obj;
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

/**
 * The instant that reads `hhmm` in Europe/Prague on the same Prague day as
 * `iso`. Mirrors backend `atTimeInAppZone(todayInAppZone(anchor), time)`; used
 * only to update the row optimistically after a successful push, so the
 * server's value and the row agree without a reload. DST-safe: the offset is
 * resolved at the target time, not at midnight.
 */
function withPragueTime(iso: string, hhmm: string): string {
  const day = new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' });
  const [h = '00', m = '00'] = hhmm.split(':');
  const probe = new Date(`${day}T${h.padStart(2, '0')}:${m.padStart(2, '0')}:00Z`);
  const asZoned = new Date(probe.toLocaleString('sv-SE', { timeZone: 'Europe/Prague' }).replace(' ', 'T') + 'Z');
  return new Date(probe.getTime() - (asZoned.getTime() - probe.getTime())).toISOString();
}
