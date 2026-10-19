'use client';
import { useLocale } from '@/lib/locale-context';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { integrations, turnovers as turnoversApi, type PlanningBooking, type User, type AgentOptionsResponse, type AgentOption } from '@/lib/api';
import { translations } from '@/i18n/translations';
import { StatusBadge, ChannelDot } from '@/components/StatusBadge';
import { formatTime, formatOccupancy, todayISO, cn, APP_TIME_ZONE } from '@/lib/utils';
import { useSocket } from '@/lib/socket';
import { Search, Filter, X, Send, UserPlus, ChevronDown, ArrowLeftRight, AlertCircle, Check, RotateCcw, Users, Baby, BedSingle, Flame, Crown, Lock, UserCheck, Columns2, SlidersHorizontal, Phone, CloudOff, Cloud } from 'lucide-react';
import type { TurnoverStatus } from '@/lib/api';
import { AssignedPanel } from './AssignedPanel';
import { PlanningSummary } from './PlanningSummary';

/** Arrival-turnover statuses the desk can filter on. CANCELLED/SKIPPED rows are never listed. */
const STATUSES: TurnoverStatus[] = ['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'FLAGGED'];

/** YYYY-MM-DD in Europe/Prague — the day a cleaner would call "today". */
const pragueDay = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' });

/**
 * Same rule as the cleaner's card: the guest arrives today and the turnover
 * was only created today — so nobody planned for it yesterday. Kept identical
 * so the desk and the cleaner never disagree about which job is the fire.
 */
/**
 * Last-minute = the guest booked today and arrives today (both Prague days).
 * Keyed to the PMS booking date, not the turnover row's createdAt: a turnover
 * gets a fresh row on every change (time edit, neighbour re-threaded), so its
 * createdAt says when it was last touched, not when the guest booked.
 */
function isLastMinute(b: PlanningBooking): boolean {
  if (!b.pmsCreatedAt || b.status === 'COMPLETED') return false;
  const today = pragueDay(new Date().toISOString());
  return pragueDay(b.checkInTime) === today && pragueDay(b.pmsCreatedAt) === today;
}

/**
 * Quick windows in whole Prague days: today, tomorrow, today + tomorrow, three
 * days from today. They used to run from *now*, so every arrival already past —
 * and every unconfirmed one sitting at the assumed 15:00 — vanished from
 * "today" in the afternoon (19 Oct 2026).
 */
type QuickWindow = 'today' | 'tomorrow' | 'today2' | 'days3';

/** Offsets from today (first and last day, inclusive). */
const QUICK_DAYS: Record<QuickWindow, [number, number]> = {
  today: [0, 0],
  tomorrow: [1, 1],
  today2: [0, 1],
  days3: [0, 2],
};

/** First and last Prague day of a quick window, as YYYY-MM-DD (the API reads a bare date as that whole day). */
function quickRange(w: QuickWindow): { from: string; to: string } {
  const today = pragueDay(new Date().toISOString());
  const [y, m, d] = today.split('-').map(Number);
  const at = (n: number) => new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  const [a, b] = QUICK_DAYS[w];
  return { from: at(a), to: at(b) };
}

/**
 * One row's unsaved edit. Values are "HH:mm" in Europe/Prague — exactly what
 * the input shows and exactly what the backend receives. The date is the
 * booking's own arrival / departure day and is resolved server-side; the
 * client never builds an instant, because the last time it did it labelled
 * Prague wall-clock as UTC and 15:10 became 17:10 everywhere.
 */
type Draft = {
  checkIn: string;
  checkOut: string;
  /**
   * The desk picked this tab's time on a row whose time was only assumed
   * (FALLBACK). Picking 15:00 over an assumed 15:00 is still a decision:
   * it is pushed, and from then on the time counts as set by a person.
   */
  confirm?: boolean;
};
type RowState = 'pushing' | 'ok' | 'error';

/** How many rows are pushed to Avantio at once. Small: Avantio rate-limits, and one PUT is ~1 s. */
const PUSH_CONCURRENCY = 3;

/**
 * One column template for the header and every row, so a heading sits over
 * the cell it names. Columns: status · unit/guest · party · setup · check-in ·
 * check-out · row actions · cleaner.
 */
const GRID = 'grid grid-cols-[7.5rem_6.75rem_minmax(0,1fr)_6.5rem_3.5rem_4.75rem_8.75rem_8.75rem_4rem_11.5rem] items-center gap-x-3';
/**
 * With the Assigned view open the list loses ~26rem. Guests, setup and the
 * locked check-out column step aside so the unit name has the room
 * (Check-In tab only — the panel never opens on Check-Out).
 */
const GRID_COMPACT = 'grid grid-cols-[7.5rem_6.75rem_minmax(0,1fr)_6.5rem_8.75rem_4rem_11.5rem] items-center gap-x-3';
/** The same two grids with the optional guest-phone column (Additional attributes) after the unit setup. */
const GRID_PHONE = 'grid grid-cols-[7.5rem_6.75rem_minmax(0,1fr)_6.5rem_9.5rem_3.5rem_4.75rem_8.75rem_8.75rem_4rem_11.5rem] items-center gap-x-3';
const GRID_COMPACT_PHONE = 'grid grid-cols-[7.5rem_6.75rem_minmax(0,1fr)_6.5rem_9.5rem_8.75rem_4rem_11.5rem] items-center gap-x-3';
const gridFor = (compact: boolean, phone: boolean) =>
  compact ? (phone ? GRID_COMPACT_PHONE : GRID_COMPACT) : (phone ? GRID_PHONE : GRID);

/** Extra columns the desk can switch on (Additional attributes). Remembered per browser. */
type ExtraAttr = 'guestPhone';
const EXTRA_ATTRS: Array<{ key: ExtraAttr; label: string; hint: string }> = [
  { key: 'guestPhone', label: 'Guest phone', hint: 'Edit the guest\'s phone; it is pushed to Avantio and the check-in agent sees it' },
];
const EXTRAS_KEY = 'planning.extraAttrs';
/**
 * Below this list width (px) the full grid leaves the unit name too little
 * room — a laptop with the menu open, or a zoomed browser — and the list goes
 * compact on its own, whatever the panel does.
 */
const COMPACT_BELOW_PX = 1340;

/** Intl tags for the four UI languages — the day column reads "Thu 25 Sep" / "čt 25. 9." in the operator's language. */
const LOCALE_TAG: Record<string, string> = { en: 'en-GB', cs: 'cs-CZ', ru: 'ru-RU', uk: 'uk-UA' };

/** "Monday, 18/10" (cs "pondělí, 18/10"), Prague calendar — the day this row's time belongs to. */
function dayLabel(iso: string, locale: string): string {
  try {
    const d = new Date(iso);
    const weekday = d.toLocaleDateString(LOCALE_TAG[locale] ?? 'en-GB', { weekday: 'long', timeZone: APP_TIME_ZONE });
    const [, mm, dd] = pragueDay(iso).split('-');
    return `${weekday}, ${dd}/${mm}`;
  } catch { return iso.slice(0, 10); }
}

/**
 * Which side of the stay this tab plans. Check-In bounds the list by arrival,
 * reports the turnover before the guest arrives, and edits only the check-in
 * time; Check-Out bounds by departure, reports the turnover after the guest
 * leaves, and edits only the check-out time. The other time is shown locked,
 * so two desk operators never push the same field from two tabs.
 */
export type PlanningMode = 'checkIn' | 'checkOut';

export function PlanningView({ mode }: { mode: PlanningMode }) {
  const { locale } = useLocale();
  const t = translations[locale];
  const tp = t.planning as typeof t.planning & Record<string, string>;
  const byCheckOut = mode === 'checkOut';
  /** The time this tab owns, and the one it only shows. */
  const ownSource = (b: PlanningBooking) => (byCheckOut ? b.checkOutSource : b.checkInSource);
  const ownTime = (b: PlanningBooking) => (byCheckOut ? (b.checkOutTime ?? b.checkInTime) : b.checkInTime);

  // ── Filters ──
  const [arrivalFrom, setArrivalFrom] = useState(todayISO());
  const [arrivalTo, setArrivalTo] = useState('');
  const [creationFrom, setCreationFrom] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  // One search over every loaded row: unit, guest or booking ref.
  const [search, setSearch] = useState('');
  // Bookings whose check-in time we assumed (15:00) because the PMS sent 00:00 / nothing.
  const [onlyUnconfirmed, setOnlyUnconfirmed] = useState(false);
  // Check-In tab: plan state filter, and the split "Assigned" view.
  const [planFilter, setPlanFilter] = useState<'ALL' | PlanState>('ALL');
  const [splitOpen, setSplitOpen] = useState(false);
  // Additional attributes: extra columns the desk switches on (Oct 2026).
  const [extras, setExtras] = useState<ExtraAttr[]>([]);
  const [extrasOpen, setExtrasOpen] = useState(false);
  useEffect(() => {
    try { const v = JSON.parse(localStorage.getItem(EXTRAS_KEY) ?? '[]'); if (Array.isArray(v)) setExtras(v.filter((x: string) => EXTRA_ATTRS.some(a => a.key === x))); } catch { /* private window */ }
  }, []);
  function toggleExtra(k: ExtraAttr) {
    setExtras(prev => {
      const next = prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k];
      try { localStorage.setItem(EXTRAS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }
  const showPhone = extras.includes('guestPhone') && !byCheckOut;
  const [highlight, setHighlight] = useState<string | null>(null);
  // The list's own width, so a narrow window (menu open, zoom) goes compact too.
  const listRef = useRef<HTMLDivElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < COMPACT_BELOW_PX));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Compact: guests, setup and the time this tab does not edit step aside so
  // the unit name has room. On with the Assigned view, or when space is short.
  const compact = (splitOpen && !byCheckOut) || narrow;
  // A quick window overrides the date inputs while it is active.
  const [quick, setQuick] = useState<QuickWindow | null>('today');
  // Default: by unit name, so the desk reads the list the way the building is laid out.
  const [sortKey, setSortKey] = useState<'unit' | 'time'>('unit');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // ── Data ──
  const [bookings, setBookings] = useState<PlanningBooking[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cleaners, setCleaners] = useState<User[]>([]);

  // ── Inline time edits ──
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [pushingAll, setPushingAll] = useState(false);
  // An assumed time shows empty while its field has focus, so that picking the
  // same time (15:00 over an assumed 15:00) is a change the browser reports.
  // Leaving the field without picking restores the assumed time untouched.
  const [blankFor, setBlankFor] = useState<string | null>(null);
  // Setup-request toggles save on click; this holds the ids mid-flight / failed.
  const [flagBusy, setFlagBusy] = useState<Record<string, 'saving' | 'error'>>({});

  // ── Assign modal ──
  const [assigning, setAssigning] = useState<PlanningBooking | null>(null);
  const [reassigningUserId, setReassigningUserId] = useState<string | null>(null);
  const [selectedCleaner, setSelectedCleaner] = useState('');
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState('');

  // ── Check-in agent picker ──
  const [agentFor, setAgentFor] = useState<PlanningBooking | null>(null);
  const [agentData, setAgentData] = useState<AgentOptionsResponse | null>(null);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentError, setAgentError] = useState('');
  // An agent who has not declared the arrival: picked once, confirmed on the second click.
  const [agentOverride, setAgentOverride] = useState<AgentOption | null>(null);
  // The agent's report on that check-in, when there is one.
  const [agentReport, setAgentReport] = useState<Awaited<ReturnType<typeof integrations.planning.report>>>(null);

  function openAgentPicker(b: PlanningBooking) {
    setAgentFor(b);
    setAgentData(null);
    setAgentError('');
    setAgentOverride(null);
    setAgentReport(null);
    if (b.checkInReport) {
      integrations.planning.report(b.id).then(setAgentReport).catch(() => {});
    }
    setAgentLoading(true);
    integrations.planning.agentOptions(b.id)
      .then(setAgentData)
      .catch(e => setAgentError(e?.message ?? 'Could not load agents'))
      .finally(() => setAgentLoading(false));
  }

  async function saveAgent(agentId: string | null, override = false) {
    if (!agentFor) return;
    setAgentBusy(true);
    setAgentError('');
    try {
      const r = await integrations.planning.setAgent(agentFor.id, { agentId, override });
      setBookings(prev => prev.map(x => x.id === agentFor.id ? { ...x, ...r } : x));
      setAgentFor(null);
    } catch (e: any) {
      setAgentError(e?.message ?? 'Could not save');
    } finally {
      setAgentBusy(false);
    }
  }

  async function agreedByPhone() {
    if (!agentFor) return;
    setAgentBusy(true);
    setAgentError('');
    try {
      await integrations.planning.agreeByPhone(agentFor.id);
      const now = new Date().toISOString();
      setBookings(prev => prev.map(x => x.id === agentFor.id
        ? { ...x, checkInAgentConsent: 'PHONE' as const, checkInAgentSeenAt: now }
        : x));
      setAgentFor(null);
    } catch (e: any) {
      setAgentError(e?.message ?? 'Could not save');
    } finally {
      setAgentBusy(false);
    }
  }

  // Everyone who can open Planning may assign and reassign (MANAGER, ADMIN,
  // FRONT_DESK_MANAGER, FRONT_DESK — PLANNING_ROLES on the API).
  const mayAssign = true;

  useEffect(() => {
    integrations.planning.cleaners()
      .then(setCleaners)
      .catch(() => {});
  }, []);

  /**
   * `keepDrafts`: a background refresh (socket event) must not wipe what the
   * operator is typing; an explicit Apply starts clean.
   */
  const load = useCallback(async (window: QuickWindow | null = quick, keepDrafts = false) => {
    setLoading(true);
    try {
      const range = window ? quickRange(window) : null;
      const data = await integrations.planning.list({
        by: mode,
        arrivalFrom: range ? range.from : (arrivalFrom || undefined),
        arrivalTo: range ? range.to : (arrivalTo || undefined),
        creationDateFrom: creationFrom || undefined,
        status: statusFilter || undefined,
      });
      setBookings(data);
      if (!keepDrafts) { setDrafts({}); setRowState({}); }
      setLoaded(true);
    } catch {}
    finally { setLoading(false); }
  }, [mode, quick, arrivalFrom, arrivalTo, creationFrom, statusFilter]);

  // Each tab opens on the next 24 h — the desk's working window — so the
  // list is there before anyone touches a filter.
  useEffect(() => { void load('today'); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleaners claiming, starting and finishing jobs broadcast event:updated;
  // so does the PMS sync and a push from the other planning tab. Refresh in
  // place so the Status column is live, keeping any unsaved edits.
  useSocket({
    'event:updated': () => { if (loaded) void load(undefined, true); },
    'event:cancelled': () => { if (loaded) void load(undefined, true); },
    // An agent answered, or another desk user changed an agent.
    'checkin:changed': () => { if (loaded) void load(undefined, true); },
  });

  function pickQuick(w: QuickWindow) {
    const next = quick === w ? null : w;
    setQuick(next);
    if (next) void load(next);
  }

  const unconfirmedCount = bookings.filter(b => ownSource(b) === 'FALLBACK').length;

  const filtered = bookings.filter(b => {
    const q = search.trim().toLowerCase();
    const matchSearch = !q || b.accommodationName.toLowerCase().includes(q)
      || b.bookingRef.toLowerCase().includes(q)
      || (b.guestName ?? '').toLowerCase().includes(q);
    const matchUnconfirmed = !onlyUnconfirmed || ownSource(b) === 'FALLBACK';
    const matchPlan = byCheckOut || planFilter === 'ALL' || planState(b) === planFilter;
    return matchSearch && matchUnconfirmed && matchPlan;
  }).sort((a, b) => {
    const cmp = sortKey === 'unit'
      ? a.accommodationName.localeCompare(b.accommodationName, 'cs', { numeric: true, sensitivity: 'base' })
      : ownTime(a).localeCompare(ownTime(b));
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const planCounts = useMemo(() => {
    const c = { UNASSIGNED: 0, ASSIGNED: 0, PLANNED: 0 };
    for (const b of bookings) {
      const st = planState(b);
      if (st) c[st]++;
    }
    return c;
  }, [bookings]);

  // The panel shows the days the main list covers (at most a week).
  const panelRange = useMemo(() => {
    const days = bookings.map(b => pragueDay(b.checkInTime)).sort();
    const from = days[0] ?? pragueDay(new Date().toISOString());
    const last = days[days.length - 1] ?? from;
    const cap = new Date(Date.parse(`${from}T12:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
    return { from, to: last < cap ? last : cap };
  }, [bookings]);

  function pickFromPanel(id: string) {
    setHighlight(id);
    document.getElementById(`row-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function toggleSort(key: 'unit' | 'time') {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }

  // ── Draft bookkeeping ──
  const stored = (b: PlanningBooking): Draft => ({
    checkIn: formatTime(b.checkInTime),
    checkOut: b.checkOutTime ? formatTime(b.checkOutTime) : '',
  });

  function isDirty(b: PlanningBooking): boolean {
    const d = drafts[b.id];
    if (!d) return false;
    const s = stored(b);
    return d.checkIn !== s.checkIn || d.checkOut !== s.checkOut || (!!d.confirm && ownSource(b) === 'FALLBACK');
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
  /**
   * A confirmed draft (see Draft.confirm) pushes this tab's time even when it
   * equals the assumed one: Avantio gets it and the row is marked as set by a
   * person, which is what turns it bold on the cleaner's card.
   */
  async function pushRow(b: PlanningBooking): Promise<boolean> {
    const d = drafts[b.id];
    if (!d || !b.pmsBookingId) return false;
    const confirm = !!d.confirm && ownSource(b) === 'FALLBACK';
    const s = stored(b);
    const body: { checkInTime?: string; checkOutTime?: string } = {};
    // Each tab pushes only the time it owns; the other input is locked anyway.
    if (!byCheckOut && d.checkIn && (confirm || d.checkIn !== s.checkIn)) body.checkInTime = d.checkIn;
    if (byCheckOut && d.checkOut && (confirm || d.checkOut !== s.checkOut)) body.checkOutTime = d.checkOut;
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
      await integrations.planning.setup(b.id, { [key]: next });
      setFlagBusy(prev => without(prev, b.id));
    } catch {
      setBookings(prev => prev.map(x => (x.id === b.id ? { ...x, [key]: !next } : x)));
      setFlagBusy(prev => ({ ...prev, [b.id]: 'error' }));
      setTimeout(() => setFlagBusy(prev => (prev[b.id] === 'error' ? without(prev, b.id) : prev)), 3000);
    }
  }

  /** Desk sets the guest phone: saved here, pushed to Avantio; the row shows whether Avantio took it. */
  async function saveGuestPhone(b: PlanningBooking, value: string): Promise<void> {
    const res = await integrations.planning.setGuestPhone(b.id, value.trim() || null);
    setBookings(prev => prev.map(x => (x.id === b.id ? {
      ...x,
      guestPhone: res.guestPhone,
      guestPhoneSource: res.guestPhoneSource,
      guestPhonePushedAt: res.pushed ? new Date().toISOString() : (value.trim() ? x.guestPhonePushedAt ?? null : null),
      guestPhonePushError: res.pushError,
    } : x)));
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
    <div className="p-6 max-w-[1600px] pb-28">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink">{byCheckOut ? tp.titleCheckOut : tp.title}</h1>
        <p className="text-sm text-ink-muted mt-0.5">{byCheckOut ? tp.subtitleCheckOut : tp.subtitle} · {tp.inlineHint}</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-surface-border p-4 mb-4">
        {/* Quick windows */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider mr-1">{byCheckOut ? tp.filterDeparture : tp.filterArrival}</span>
          {quickBtn('today', tp.next24)}
          {quickBtn('tomorrow', tp.quickTomorrow)}
          {quickBtn('today2', tp.next48)}
          {quickBtn('days3', tp.next72)}
        </div>

        <div className={cn('grid grid-cols-2 md:grid-cols-4 gap-3 mb-3 transition', quick && 'opacity-50')}>
          <div>
            <label className="block text-xs font-semibold text-ink-muted mb-1">{byCheckOut ? tp.filterDeparture : tp.filterArrival} {tp.filterFrom}</label>
            <input type="date" value={arrivalFrom} onChange={e => { setQuick(null); setArrivalFrom(e.target.value); }}
              className="w-full text-sm px-3 py-2 rounded-xl border border-surface-border bg-surface focus:outline-none focus:ring-2 focus:ring-accent" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-muted mb-1">{byCheckOut ? tp.filterDeparture : tp.filterArrival} {tp.filterTo}</label>
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

        {/* Apply. Unconfirmed, the plan chips, Additional attributes and the search live in the list header now. */}
        <div className="flex gap-2 justify-end">
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

      {loaded && !byCheckOut && bookings.length > 0 && (
        <div className="mb-4">
          {/* Figures follow the current filters (range, plan chips, search, unconfirmed) so they agree with the rows below. */}
          <PlanningSummary bookings={filtered} onPick={pickFromPanel} />
        </div>
      )}

      {loaded && bookings.length > 0 && <StatusLegend t={t} byCheckOut={byCheckOut} />}

      {/* Results — with the split "Assigned" view beside them when on. */}
      <div className={cn(splitOpen && !byCheckOut && loaded && 'flex gap-4 items-start')}>
      <div ref={listRef} className="flex-1 min-w-0">
      {!loaded ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-surface-border">
          <Filter size={32} className="mx-auto text-ink-faint mb-3" />
          <p className="text-sm text-ink-muted">{loading ? t.general.loading : 'Set filters and click Apply to load bookings'}</p>
        </div>
      ) : bookings.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-surface-border">
          <p className="text-sm text-ink-muted">{tp.noBookings}</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-surface-border overflow-hidden">
          <div className="px-4 py-2 border-b border-surface-border flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider">Bookings</p>
              <label className="relative flex items-center">
                <Search size={13} className="absolute left-2.5 text-ink-muted pointer-events-none" />
                <input
                  type="search"
                  aria-label="Search check-ins"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-60 pl-8 pr-2.5 py-1.5 text-[12.5px] rounded-[10px] border border-surface-border bg-white focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
              </label>
              {!byCheckOut && (
                <div className="flex items-center gap-1 text-[11.5px] font-semibold">
                  {([
                    ['ALL', 'All', bookings.length, 'text-ink-soft'],
                    ['UNASSIGNED', 'Unassigned', planCounts.UNASSIGNED, 'text-coral-deep'],
                    ['ASSIGNED', 'Assigned', planCounts.ASSIGNED, 'text-sand-deep'],
                    ['PLANNED', 'Planned', planCounts.PLANNED, 'text-accent'],
                  ] as const).map(([key, label, n, tone]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setPlanFilter(key)}
                      title={PLAN_HINT[key]}
                      className={cn(
                        'rounded-full px-2.5 py-1 border transition',
                        planFilter === key ? 'bg-ink text-white border-ink' : 'border-surface-border hover:border-ink-muted',
                      )}
                    >
                      {label} <span className={planFilter === key ? 'text-white/70' : tone}>{n}</span>
                    </button>
                  ))}
                </div>
              )}
              {/* Combines with the plan chips and the search: e.g. Unassigned + Unconfirmed time. */}
              <button
                type="button"
                onClick={() => setOnlyUnconfirmed(v => !v)}
                title={byCheckOut ? tp.unconfirmedOutHint : tp.unconfirmedHint}
                aria-pressed={onlyUnconfirmed}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold border transition',
                  onlyUnconfirmed ? 'bg-sand-soft border-sand text-sand-deep' : 'border-surface-border text-ink-soft hover:border-ink-muted',
                )}
              >
                <AlertCircle size={12} />
                {tp.unconfirmedFilter}
                {unconfirmedCount > 0 && (
                  <span className={onlyUnconfirmed ? 'text-sand-deep' : 'text-sand-deep/80'}>{unconfirmedCount}</span>
                )}
              </button>
            </div>
            <div className="flex items-center gap-2">
              {!byCheckOut && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setExtrasOpen(o => !o)}
                    aria-expanded={extrasOpen}
                    className={cn(
                      'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11.5px] font-semibold border transition',
                      extras.length ? 'bg-accent-soft border-transparent text-accent' : 'border-surface-border text-ink-soft hover:border-ink-muted',
                    )}
                  >
                    <SlidersHorizontal size={13} />
                    Additional attributes
                    {extras.length > 0 && <span className="rounded-full bg-white text-accent px-1.5 leading-4">{extras.length}</span>}
                  </button>
                  {extrasOpen && (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => setExtrasOpen(false)} />
                      <div className="absolute right-0 z-40 mt-2 w-80 bg-white border border-surface-border rounded-2xl shadow-lg p-2">
                        <p className="px-2 pt-1 pb-2 text-[10px] font-semibold tracking-[0.08em] uppercase text-ink-muted">Show in the list, per reservation</p>
                        {EXTRA_ATTRS.map(a => {
                          const on = extras.includes(a.key);
                          return (
                            <button key={a.key} type="button" onClick={() => toggleExtra(a.key)}
                              className="w-full flex items-start gap-2.5 text-left px-2 py-2 rounded-lg hover:bg-surface-sunken">
                              <span className={cn('mt-0.5 w-4 h-4 rounded border flex items-center justify-center flex-shrink-0',
                                on ? 'bg-accent border-accent text-white' : 'border-surface-border bg-white')}>
                                {on && <Check size={11} />}
                              </span>
                              <span className="min-w-0">
                                <span className="block text-[13px] font-semibold text-ink">{a.label}</span>
                                <span className="block text-[11.5px] text-ink-muted leading-snug">{a.hint}</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}
              {!byCheckOut && (
                <button
                  type="button"
                  onClick={() => setSplitOpen(o => !o)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11.5px] font-semibold border transition',
                    splitOpen ? 'bg-ink text-white border-ink' : 'border-surface-border text-ink-soft hover:border-ink-muted',
                  )}
                >
                  <Columns2 size={13} />
                  Assigned view
                  {planCounts.UNASSIGNED > 0 && (
                    <span className="rounded-full bg-coral-soft text-coral-deep px-1.5 leading-4">{planCounts.UNASSIGNED} unassigned</span>
                  )}
                </button>
              )}
            </div>
          </div>
          {/* Column headings — same grid as the rows. Unit and Check-in sort. */}
          <div className={cn(gridFor(compact, showPhone), 'px-4 py-1.5 border-b border-surface-border bg-surface-sunken/60 text-[11px] font-semibold text-ink-muted uppercase tracking-wider')}>
            {/* Day: the calendar day this tab's time falls on — sorts with the time column. */}
            <button type="button" onClick={() => toggleSort('time')} className="text-left hover:text-ink transition">
              {tp.day}{sortKey === 'time' && (sortDir === 'asc' ? ' ↑' : ' ↓')}
            </button>
            <span>{tp.filterStatus}</span>
            <button type="button" onClick={() => toggleSort('unit')} className="text-left hover:text-ink transition">
              {tp.sortUnit} · {tp.guest}{sortKey === 'unit' && (sortDir === 'asc' ? ' ↑' : ' ↓')}
            </button>
            <span title={`${tp.checkInTypeLabel} · ${tp.checkInMethodLabel} · ${tp.unitStandard}`}>Check-in · Std</span>
            {showPhone && <span>Guest phone</span>}
            {!compact && <span className="text-center" title={tp.guests}><Users size={12} className="inline -mt-0.5" /></span>}
            {!compact && <span className="text-center">{tp.setup}</span>}
            {/* Time headings carry the same 1.5-unit dot spacer the cells have, so the label starts where the input does. */}
            {!(compact && byCheckOut) && <span className="flex items-center gap-1.5">
              <span className="w-1.5 flex-shrink-0" />
              {byCheckOut ? (
                <span className="flex items-center gap-1"><Lock size={10} /> {tp.checkInTime}</span>
              ) : (
                <button type="button" onClick={() => toggleSort('time')} className="text-left hover:text-ink transition">
                  ↓ {tp.checkInTime}{sortKey === 'time' && (sortDir === 'asc' ? ' ↑' : ' ↓')}
                </button>
              )}
            </span>}
            {!(compact && !byCheckOut) && <span className="flex items-center gap-1.5">
              <span className="w-1.5 flex-shrink-0" />
              {byCheckOut ? (
                <button type="button" onClick={() => toggleSort('time')} className="text-left hover:text-ink transition">
                  ↑ {tp.checkOutTime}{sortKey === 'time' && (sortDir === 'asc' ? ' ↑' : ' ↓')}
                </button>
              ) : (
                <span className="flex items-center gap-1"><Lock size={10} /> {tp.checkOutTime}</span>
              )}
            </span>}
            <span />
            <span className="text-right">{tp.cleaner}</span>
          </div>
          <div className="divide-y divide-surface-border">
            {filtered.length === 0 && (
              <p className="px-4 py-10 text-center text-sm text-ink-muted">{tp.noBookings}</p>
            )}
            {filtered.map(b => {
              const d = drafts[b.id] ?? stored(b);
              const dirty = isDirty(b);
              const state = rowState[b.id];
              const editable = !!b.pmsBookingId;
              const lastMinute = !byCheckOut && isLastMinute(b);
              const done = b.status === 'COMPLETED';
              return (
                <div
                  key={b.id}
                  id={`row-${b.id}`}
                  onClick={() => { if (splitOpen) setHighlight(b.id); }}
                  className={cn(
                    gridFor(compact, showPhone), 'px-4 py-2.5 transition group',
                    highlight === b.id && 'ring-2 ring-inset ring-accent',
                    dirty ? 'bg-sand-soft/70' : 'hover:bg-surface-sunken',
                    state === 'error' && 'bg-coral-soft',
                    lastMinute && !dirty && 'border-l-4 border-l-coral',
                    b.isOwnerStay && !lastMinute && !dirty && 'border-l-4 border-l-sand',
                    done && 'opacity-70',
                  )}
                >
                  {/* The day this tab's time falls on. Today is set in bold so the desk sees the line between today and tomorrow. */}
                  {(() => {
                    const iso = ownTime(b);
                    const isTodayRow = pragueDay(iso) === pragueDay(new Date().toISOString());
                    return (
                      <span className={cn('text-xs tabular-nums whitespace-nowrap', isTodayRow ? 'font-bold text-ink' : 'text-ink-soft')}>
                        {dayLabel(iso, locale)}
                      </span>
                    );
                  })()}

                  {/* Turnover status: before arrival (Check-In) or after departure (Check-Out) — what the cleaner did with it. */}
                  <div className="min-w-0">
                    {b.status ? (
                      <StatusBadge status={b.status as any} t={t} size="sm" />
                    ) : (
                      <span className="text-[11px] text-ink-faint italic" title={tp.noTurnover}>{tp.noTurnover}</span>
                    )}
                  </div>

                  {/* Unit + guest + ref */}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink truncate">{b.accommodationName}</p>
                    <div className="flex items-center gap-2 mt-0.5 min-w-0 whitespace-nowrap">
                      {/* Same two flags the cleaner's card wears, at list size. */}
                      {b.isOwnerStay && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-sand-soft border border-sand/70 text-sand-deep px-1.5 py-px text-[10px] font-bold uppercase tracking-wide flex-shrink-0" title={tp.ownerStay}>
                          <Crown size={10} />
                          {tp.ownerStay}
                        </span>
                      )}
                      {lastMinute && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-coral-soft border border-coral/40 text-coral-deep px-1.5 py-px text-[10px] font-bold uppercase tracking-wide flex-shrink-0" title={tp.lastMinute}>
                          <Flame size={10} />
                          {tp.lastMinute}
                        </span>
                      )}
                      {b.guestName && (
                        <span className="text-xs text-ink-soft truncate max-w-[180px]" title={`${tp.guest}: ${b.guestName}`}>
                          {b.guestName}
                        </span>
                      )}
                      <span className="font-mono text-xs text-ink-faint truncate max-w-[170px]" title={b.bookingRef}>{b.bookingRef}</span>
                      <ChannelDot channel={b.channel} label={t.channel[b.channel] ?? b.channel} />
                    </div>
                  </div>

                  {/* From the accommodation sheet, stacked: type, method, standard — what the desk needs before sending anyone. */}
                  <UnitSetup type={b.checkInType} method={b.checkInMethod} standard={b.accommodationStandard} tp={tp} />
                  {showPhone && <PhoneCell b={b} onSave={v => saveGuestPhone(b, v)} />}

                  {!compact && (<>
                  {/* Guests — same "adults+children" reading the cleaner's card uses */}
                  <span
                    className="flex items-center justify-center gap-1 text-xs text-ink-soft tabular-nums"
                    title={`${tp.guests}: ${b.numAdults} + ${b.numChildren}`}
                  >
                    <Users size={13} className="text-ink-faint" />
                    {formatOccupancy(b.numAdults, b.numChildren)}
                  </span>

                  {/* Setup requests — local only, cleaner sees them on the card */}
                  <div className="flex items-center justify-center gap-1" title={tp.localOnly}>
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
                      <span className="text-[11px] text-coral-deep font-medium" title={tp.saveFailed}>!</span>
                    )}
                  </div>

                  </>)}

                  {!(compact && byCheckOut) && (<>
                  {/* Check-in — editable on the Check-In tab, locked on Check-Out. The amber dot means we assumed the time. */}
                  <div className="flex items-center gap-1.5">
                    <span
                      title={b.checkInSource === 'FALLBACK' ? tp.unconfirmedHint : undefined}
                      className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', b.checkInSource === 'FALLBACK' && !dirty ? 'bg-sand' : 'bg-transparent')}
                    />
                    <label className="flex items-center gap-1 text-xs text-ink-muted" title={byCheckOut ? tp.lockedHint : undefined}>
                      <input
                        type="time"
                        value={blankFor === b.id && !drafts[b.id] ? '' : d.checkIn}
                        onFocus={() => { if (!byCheckOut && b.checkInSource === 'FALLBACK' && !drafts[b.id]) setBlankFor(b.id); }}
                        onBlur={() => setBlankFor(prev => (prev === b.id ? null : prev))}
                        disabled={byCheckOut || !editable || state === 'pushing'}
                        readOnly={byCheckOut}
                        onChange={e => { if (e.target.value) setDraft(b, { checkIn: e.target.value, confirm: b.checkInSource === 'FALLBACK' }); }}
                        onKeyDown={e => { if (e.key === 'Enter' && dirty) void pushRow(b); }}
                        aria-label={tp.checkInTime}
                        className={cn(
                          'w-[7.25rem] px-2 py-1.5 rounded-lg border text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-accent',
                          byCheckOut
                            ? 'border-transparent bg-surface-sunken/60 text-ink-faint cursor-not-allowed'
                            : 'font-semibold text-ink disabled:opacity-60',
                          !byCheckOut && dirty && d.checkIn !== stored(b).checkIn ? 'border-sand bg-white' : !byCheckOut && 'border-surface-border bg-transparent',
                        )}
                      />
                    </label>
                  </div>

                  </>)}

                  {!(compact && !byCheckOut) && (<>
                  {/* Check-out — editable on the Check-Out tab, locked on Check-In. */}
                  <div className="flex items-center gap-1.5">
                    <span
                      title={b.checkOutSource === 'FALLBACK' ? tp.unconfirmedOutHint : undefined}
                      className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', byCheckOut && b.checkOutSource === 'FALLBACK' && !dirty ? 'bg-sand' : 'bg-transparent')}
                    />
                    <label className="flex items-center gap-1 text-xs text-ink-muted" title={byCheckOut ? undefined : tp.lockedHint}>
                      <input
                        type="time"
                        value={blankFor === b.id && !drafts[b.id] ? '' : d.checkOut}
                        onFocus={() => { if (byCheckOut && b.checkOutSource === 'FALLBACK' && !drafts[b.id]) setBlankFor(b.id); }}
                        onBlur={() => setBlankFor(prev => (prev === b.id ? null : prev))}
                        disabled={!byCheckOut || !editable || state === 'pushing'}
                        readOnly={!byCheckOut}
                        onChange={e => { if (e.target.value) setDraft(b, { checkOut: e.target.value, confirm: b.checkOutSource === 'FALLBACK' }); }}
                        onKeyDown={e => { if (e.key === 'Enter' && dirty) void pushRow(b); }}
                        aria-label={tp.checkOutTime}
                        className={cn(
                          'w-[7.25rem] px-2 py-1.5 rounded-lg border text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-accent',
                          byCheckOut
                            ? 'font-semibold text-ink disabled:opacity-60'
                            : 'border-transparent bg-surface-sunken/60 text-ink-faint cursor-not-allowed',
                          byCheckOut && dirty && d.checkOut !== stored(b).checkOut ? 'border-sand bg-white' : byCheckOut && 'border-surface-border bg-transparent',
                        )}
                      />
                    </label>
                  </div>

                  </>)}

                  {/* Row action: push / undo / result */}
                  <div className="flex items-center justify-end gap-1">
                      {state === 'pushing' && <span className="text-[11px] text-ink-faint">{tp.pushing}</span>}
                      {state === 'ok' && <Check size={15} className="text-accent" />}
                      {state === 'error' && <span className="text-[11px] text-coral-deep font-medium" title={tp.pushFailed}>!</span>}
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

                  {/* Assignees */}
                  <div className="flex flex-col items-end gap-1 min-w-0">
                  <div className="flex items-center gap-2 justify-end min-w-0">
                    {b.assignments.length === 0 ? (
                      b.turnoverId && !done
                        ? <span className="text-xs text-sand-deep font-medium">⚠ Unassigned</span>
                        : <span className="text-xs text-ink-faint" />
                    ) : (
                      <div className="flex items-center gap-1.5">
                        {b.assignments.slice(0, 2).map(a => (
                          <div key={a.id} className="flex items-center gap-1 bg-surface-sunken rounded-full pl-1 pr-2.5 py-1">
                            <div className="w-5 h-5 rounded-full bg-ink text-white text-[10px] flex items-center justify-center font-bold">
                              {a.userName[0]}
                            </div>
                            <span className="text-xs text-ink-soft max-w-[60px] truncate">{a.userName.split(' ')[0]}</span>
                            {mayAssign && <button
                              onClick={() => openAssign(b, a.userId)}
                              title={`Reassign ${a.userName}`}
                              className="ml-0.5 text-ink-faint hover:text-accent transition"
                            >
                              <ArrowLeftRight size={11} />
                            </button>}
                          </div>
                        ))}
                        {b.assignments.length > 2 && (
                          <span className="text-xs text-ink-faint">+{b.assignments.length - 2}</span>
                        )}
                      </div>
                    )}
                    {mayAssign && b.turnoverId && !done && b.assignments.length < 3 && (
                      <button
                        onClick={() => openAssign(b)}
                        title="Assign cleaner"
                        className="p-1.5 rounded-lg text-ink-muted hover:text-accent hover:bg-accent-soft transition"
                      >
                        <UserPlus size={15} />
                      </button>
                    )}
                  </div>
                  {/* Check-in agent: who meets the guest. Only on the Check-In tab. */}
                  {!byCheckOut && mayAssign && !b.isOwnerStay && (() => {
                    const a = agentChipState(b);
                    return (
                      <button
                        onClick={() => openAgentPicker(b)}
                        title={a.title}
                        className={cn(
                          'relative inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition max-w-full',
                          a.kind === 'awaiting' && 'border-sand/70 bg-sand-soft text-sand-deep font-medium',
                          a.kind === 'set' && 'border-surface-border bg-surface-sunken text-ink-soft font-medium',
                          a.kind === 'declined' && 'border-dashed border-coral/70 text-coral-deep font-medium',
                          a.kind === 'empty' && 'border-dashed border-surface-border text-ink-faint hover:text-accent hover:border-accent',
                        )}
                      >
                        <UserCheck size={11} className="flex-shrink-0" />
                        <span className="truncate">{a.label}</span>
                        {a.dot && (
                          <span className={cn(
                            'absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-white',
                            a.dot === 'red' ? 'bg-coral animate-pulse' : 'bg-sand',
                          )} />
                        )}
                      </button>
                    );
                  })()}
                  {/* The agent's report: cleanliness at a glance, red below 3. */}
                  {!byCheckOut && b.checkInReport && (() => {
                    const c = b.checkInReport.scores.CLEANLINESS;
                    return (
                      <button
                        type="button"
                        onClick={() => openAgentPicker(b)}
                        title="Agent's report — open"
                        className={cn(
                          'text-[10.5px] leading-tight rounded-full px-1.5 py-px border',
                          c !== undefined && c < 3 ? 'border-coral/70 bg-coral-soft text-coral-deep font-semibold' : 'border-accent/25 bg-accent-soft text-accent',
                        )}
                      >
                        ✓ report{c !== undefined ? ` · clean ${c}/5` : ''}{b.checkInReport.hasComment ? ' · 💬' : ''}
                      </button>
                    );
                  })()}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      </div>
      {splitOpen && !byCheckOut && loaded && (
        <AssignedPanel
          from={panelRange.from}
          to={panelRange.to}
          refreshKey={bookings}
          highlight={highlight}
          onPick={pickFromPanel}
          onClose={() => setSplitOpen(false)}
        />
      )}
      </div>

      {/* ── Sticky push bar ── */}
      {dirtyRows.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 pointer-events-none">
          <div className="max-w-[1600px] mx-auto px-6 pb-5">
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
                      a.userId === reassigningUserId ? 'bg-sand-soft border border-sand/40' : 'bg-surface-sunken',
                    )}>
                      <div className="w-6 h-6 rounded-full bg-ink text-white text-xs flex items-center justify-center font-bold">
                        {a.userName[0]}
                      </div>
                      <span className="text-sm font-medium text-ink flex-1">{a.userName}</span>
                      {a.isPrimary && <span className="text-[10px] text-ink-faint">primary</span>}
                      {a.userId === reassigningUserId && <span className="text-[10px] text-sand-deep font-semibold">replacing</span>}
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
              <p className="mb-3 text-sm text-coral-deep bg-coral-soft rounded-xl px-3 py-2">{assignError}</p>
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

      {/* ── Check-in agent modal ── */}
      {agentFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setAgentFor(null)} />
          <div className="relative bg-white rounded-2xl shadow-modal w-full max-w-sm mx-4 p-6 animate-scale-in">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold text-ink">Check-in agent</h3>
                <p className="text-xs text-ink-muted mt-0.5 truncate max-w-[240px]">
                  {agentFor.accommodationName}
                  {agentData && ` · ${agentData.day} ${agentData.arrival}`}
                </p>
              </div>
              <button onClick={() => setAgentFor(null)} className="p-1.5 rounded-lg hover:bg-surface-sunken text-ink-muted">
                <X size={16} />
              </button>
            </div>

            {agentReport && (
              <div className={cn(
                'mb-3 rounded-xl border px-3 py-2.5 text-xs space-y-1',
                agentReport.ratings.some(r => r.score < 3) ? 'border-coral/40 bg-coral-soft' : 'border-accent/25 bg-accent-soft',
              )}>
                <p className="font-semibold text-ink">
                  Report by {agentReport.agentName ?? 'agent'} · {formatTime(agentReport.updatedAt)}
                </p>
                {agentReport.ratings.map(r => (
                  <p key={r.aspect} className={r.score < 3 ? 'text-coral-deep' : 'text-ink-soft'}>
                    {r.aspect === 'CLEANLINESS' ? 'Cleanliness' : r.aspect}: <strong>{r.score}/5</strong>
                    {r.comment && <> — {r.comment}</>}
                  </p>
                ))}
                {agentReport.comment && <p className="text-ink-soft whitespace-pre-line">{agentReport.comment}</p>}
                {agentReport.cleanerNames.length > 0 && (
                  <p className="text-ink-muted">Cleaned by {agentReport.cleanerNames.join(', ')}</p>
                )}
              </div>
            )}

            {agentFor.checkInAgentId && agentFor.checkInAgentConsent === 'PENDING' && (
              <div className="mb-3 rounded-xl border border-sand/70 bg-sand-soft px-3 py-2.5">
                <p className="text-xs text-sand-deep">
                  Waiting for <strong>{agentFor.checkInAgentName}</strong> to accept in the app — they had not declared this arrival.
                </p>
                <button
                  onClick={() => void agreedByPhone()}
                  disabled={agentBusy}
                  className="mt-2 w-full py-2 bg-white border border-sand/70 text-sand-deep rounded-lg text-xs font-semibold hover:bg-sand-soft transition disabled:opacity-50"
                >
                  Agreed by phone
                </button>
              </div>
            )}

            {!agentFor.checkInAgentId && agentFor.checkInDeclinedAgentName && (
              <p className="mb-3 text-xs text-coral-deep bg-coral-soft border border-coral/40 rounded-xl px-3 py-2">
                {agentFor.checkInDeclinedAgentName} declined
                {agentFor.checkInDeclinedAt && ` at ${formatTime(agentFor.checkInDeclinedAt)}`}. Pick someone else.
              </p>
            )}

            {agentData?.arrivalAssumed && (
              <p className="mb-3 text-xs text-sand-deep bg-sand-soft border border-sand/40 rounded-xl px-3 py-2">
                Arrival time not confirmed (assumed {agentData.arrival}). Agents who declared anything that day are listed as a fit.
              </p>
            )}

            {agentLoading && <p className="text-sm text-ink-faint py-4">Loading…</p>}

            {agentData && (
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {agentData.options.length === 0 && (
                  <p className="text-sm text-ink-faint py-2">No active agents.</p>
                )}
                {agentData.options.map(o => {
                  const current = o.id === agentData.currentAgentId;
                  const note =
                    o.fit === 'AVAILABLE' ? (o.declared.join(', ') || 'Available')
                    : o.fit === 'TIME_UNCONFIRMED' ? `Time not confirmed${o.declared.length ? ` · ${o.declared.join(', ')}` : ''}`
                    : o.fit === 'OUTSIDE_HOURS' ? `Not available · declared ${o.declared.join(', ') || 'other hours'}`
                    : o.fit === 'TIME_OFF' ? `Time off${o.timeOffReason ? ` · ${o.timeOffReason === 'VACATION' ? 'vacation' : o.timeOffReason === 'SICK' ? 'sick' : 'other'}` : ''}`
                    : agentData.deadlinePassed ? 'Not available · nothing declared (deadline passed)'
                    : 'Not available · nothing declared yet';
                  return (
                    <button
                      key={o.id}
                      disabled={agentBusy || current}
                      onClick={() => (o.eligible ? void saveAgent(o.id) : setAgentOverride(o))}
                      className={cn(
                        'w-full text-left flex items-center gap-2 rounded-xl px-3 py-2 border transition disabled:opacity-60',
                        current ? 'border-accent bg-accent-soft' : o.eligible ? 'border-surface-border hover:bg-surface-sunken' : 'border-surface-border bg-surface-sunken/50 hover:bg-surface-sunken',
                        agentOverride?.id === o.id && 'border-sand bg-sand-soft',
                      )}
                    >
                      <div className={cn('w-6 h-6 rounded-full text-xs flex items-center justify-center font-bold', o.eligible ? 'bg-ink text-white' : 'bg-surface-border text-ink-muted')}>
                        {o.name[0]}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={cn('text-sm font-medium truncate', o.eligible ? 'text-ink' : 'text-ink-muted')}>{o.name}</p>
                        <p className={cn('text-[11px] truncate', o.fit === 'TIME_UNCONFIRMED' ? 'text-sand-deep' : 'text-ink-faint')}>{note}</p>
                      </div>
                      {current && <span className="text-[10px] text-accent font-semibold">current</span>}
                    </button>
                  );
                })}
              </div>
            )}

            {agentOverride && (
              <div className="mt-3 rounded-xl border border-sand/70 bg-sand-soft px-3 py-2.5">
                <p className="text-xs text-sand-deep">
                  <strong>{agentOverride.name}</strong> has not declared this arrival. Assign only if you have agreed it with them. This is recorded as an override.
                </p>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => void saveAgent(agentOverride.id, true)}
                    disabled={agentBusy}
                    className="flex-1 py-2 bg-sand text-white rounded-lg text-xs font-semibold hover:bg-sand transition disabled:opacity-50"
                  >
                    {agentBusy ? 'Saving…' : 'Assign anyway'}
                  </button>
                  <button onClick={() => setAgentOverride(null)} className="px-3 py-2 rounded-lg text-xs text-ink-muted hover:bg-white transition">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {agentError && (
              <p className="mt-3 text-sm text-coral-deep bg-coral-soft rounded-xl px-3 py-2">{agentError}</p>
            )}

            {agentFor.checkInAgentId && (
              <button
                onClick={() => void saveAgent(null)}
                disabled={agentBusy}
                className="mt-3 w-full py-2.5 rounded-xl border border-surface-border text-sm text-ink-soft hover:bg-surface-sunken transition disabled:opacity-50"
              >
                Remove agent
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Where a check-in stands in planning (Check-In tab). Owner stays need no
 * agent and are not counted.
 *   UNASSIGNED  no agent
 *   ASSIGNED    an agent, but something is still open: the arrival time is
 *               our 15:00 guess, the agent has not accepted an override, or
 *               has not seen the change yet
 *   PLANNED     agent, confirmed time, agent has seen and (if needed) agreed
 */
type PlanState = 'UNASSIGNED' | 'ASSIGNED' | 'PLANNED';

function planState(b: PlanningBooking): PlanState | null {
  if (b.isOwnerStay) return null;
  if (!b.checkInAgentId) return 'UNASSIGNED';
  const open =
    b.checkInSource === 'FALLBACK' ||
    b.checkInAgentConsent === 'PENDING' ||
    (!!b.checkInAgentNotified && !b.checkInAgentSeenAt);
  return open ? 'ASSIGNED' : 'PLANNED';
}

const PLAN_HINT: Record<'ALL' | PlanState, string> = {
  ALL: 'Every check-in in the list',
  UNASSIGNED: 'No agent yet',
  ASSIGNED: 'Agent set, but the time is unconfirmed or the agent has not seen / accepted it',
  PLANNED: 'Agent set, time confirmed, agent has seen it',
};

/**
 * What the check-in agent chip says. An unseen change gets an amber dot; one
 * still unseen 15 minutes after it was made, with the guest due within three
 * hours, gets a red one — the desk should phone.
 */
function agentChipState(b: PlanningBooking): {
  kind: 'empty' | 'declined' | 'awaiting' | 'set';
  label: string;
  title: string;
  dot: null | 'amber' | 'red';
} {
  const first = (n?: string | null) => (n ?? '').split(' ')[0];
  if (!b.checkInAgentId) {
    return b.checkInDeclinedAgentName
      ? { kind: 'declined', label: `${first(b.checkInDeclinedAgentName)} ✕`, title: `${b.checkInDeclinedAgentName} declined — pick someone else`, dot: 'red' }
      : { kind: 'empty', label: 'Agent', title: 'Check-in agent', dot: null };
  }
  const awaiting = b.checkInAgentConsent === 'PENDING';
  const unseen = !!b.checkInAgentNotified && !b.checkInAgentSeenAt;
  const changedAt = b.checkInAgentAssignedAt ? new Date(b.checkInAgentAssignedAt).getTime() : null;
  const now = Date.now();
  const urgent =
    (awaiting || unseen) &&
    changedAt !== null &&
    now - changedAt > 15 * 60_000 &&
    new Date(b.checkInTime).getTime() - now < 3 * 3600_000;
  const name = b.checkInAgentName ?? '';
  return {
    kind: awaiting ? 'awaiting' : 'set',
    label: awaiting ? `${first(name)} ?` : first(name),
    title: awaiting
      ? `Waiting for ${name} to accept (override)`
      : unseen
        ? `${name} has not seen this yet`
        : b.checkInAgentConsent === 'PHONE'
          ? `${name} — agreed by phone`
          : `${name}`,
    dot: urgent ? 'red' : awaiting || unseen ? 'amber' : null,
  };
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


// ─── Unit setup (CDM) ────────────────────────────────────────────────────────

/** Squash "Self-checkin" / "self check-in" / "SELF_CHECKIN" to one key. */
const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Accommodation standard: the four values the CDM list carries, each its own colour. */
const STANDARD_TONE: Record<string, string> = {
  lux: 'bg-[#1B2420] text-[#F3D99B]',
  airstay: 'bg-accent text-white',
  comfort: 'bg-[#E6ECF6] text-[#2F5DA8]',
  basic: 'bg-[#EFEAE0] text-[#5B5446]',
};

/** Check-in type / method: known values pinned, anything new gets a stable colour from its name. */
const SETUP_TONE: Record<string, string> = {
  lockbox: 'bg-sand-soft text-sand-deep',
  keybox: 'bg-sand-soft text-sand-deep',
  ttlock: 'bg-[#E6ECF6] text-[#2F5DA8]',
  nuki: 'bg-accent-soft text-accent',
  personal: 'bg-[#EFEAF3] text-[#5E4B75]',
  selfcheckin: 'bg-[#E3EEEE] text-[#2E6E73]',
  reception: 'bg-[#F3E6EC] text-[#8A3B5C]',
};
const SETUP_FALLBACK = [
  'bg-[#E3EEEE] text-[#2E6E73]', 'bg-[#EFEAF3] text-[#5E4B75]', 'bg-[#E6ECF6] text-[#2F5DA8]',
  'bg-sand-soft text-sand-deep', 'bg-accent-soft text-accent', 'bg-[#F3E6EC] text-[#8A3B5C]',
];
function setupTone(v: string, table: Record<string, string>): string {
  const k = norm(v);
  if (table[k]) return table[k];
  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) | 0;
  return SETUP_FALLBACK[Math.abs(h) % SETUP_FALLBACK.length];
}

function UnitSetup({ type, method, standard, tp }: {
  type?: string | null; method?: string | null; standard?: string | null; tp: any;
}) {
  const rows: Array<[string | null | undefined, string, Record<string, string>]> = [
    [type, tp.checkInTypeLabel, SETUP_TONE],
    [method, tp.checkInMethodLabel, SETUP_TONE],
    [standard, tp.unitStandard, STANDARD_TONE],
  ];
  return (
    <div className="min-w-0 flex flex-col items-start gap-[3px]">
      {rows.map(([v, label, table]) => v ? (
        <span key={label} title={`${label}: ${v}`}
          className={cn('max-w-full truncate rounded-[5px] px-1.5 text-[10px] leading-[15px] font-semibold', setupTone(v, table))}>
          {v}
        </span>
      ) : (
        <span key={label} title={`${label}: —`} className="text-[10px] leading-[15px] text-ink-faint px-1.5">—</span>
      ))}
    </div>
  );
}

// ─── Status legend ───────────────────────────────────────────────────────────

const LEGEND_STATUSES: Array<[TurnoverStatus | 'CANCELLED', string]> = [
  ['PENDING', 'cleaning in the pool, nobody took it'],
  ['ASSIGNED', 'a cleaner has it, not started'],
  ['IN_PROGRESS', 'being cleaned now'],
  ['COMPLETED', 'ready for the guest'],
  ['FLAGGED', 'done, but the cleaner reported a problem'],
];

/** A low white box above the list: what each status and mark in it means. */
function StatusLegend({ t, byCheckOut }: { t: any; byCheckOut: boolean }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 rounded-2xl border border-surface-border bg-white px-4 py-2.5 text-[11px] text-ink-muted">
      {LEGEND_STATUSES.map(([st, meaning]) => (
        <span key={st} className="flex items-center gap-1.5">
          <StatusBadge status={st as any} t={t} size="sm" />
          <span>{meaning}</span>
        </span>
      ))}
      {!byCheckOut && (
        <>
          <span className="w-px h-4 bg-surface-border" />
          <span className="flex items-center gap-1.5"><span className="w-1 h-4 rounded-full bg-coral" />last minute</span>
          <span className="flex items-center gap-1.5"><span className="w-1 h-4 rounded-full bg-sand" />owner stay</span>
          <span className="flex items-center gap-1.5"><b className="font-mono font-bold text-ink">16:30</b>confirmed time</span>
          <span className="flex items-center gap-1.5"><span className="font-mono text-ink-muted">15:00</span><span className="w-1.5 h-1.5 rounded-full bg-sand" />assumed time</span>
        </>
      )}
    </div>
  );
}


// ─── Guest phone (Additional attributes) ─────────────────────────────────────

/**
 * The guest's phone, editable. Saved on Enter or when the field loses focus,
 * then pushed to Avantio by the backend. The icon says where the number stands:
 * a green cloud — Avantio has it; a coral one — Avantio refused (hover for why,
 * the agent still sees our number); none — the number came from Avantio.
 */
function PhoneCell({ b, onSave }: { b: PlanningBooking; onSave: (value: string) => Promise<void> }) {
  const [draft, setDraft] = useState(b.guestPhone ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');
  const [err, setErr] = useState('');
  useEffect(() => { setDraft(b.guestPhone ?? ''); }, [b.guestPhone]);

  async function commit() {
    if (draft.trim() === (b.guestPhone ?? '').trim()) return;
    setState('saving'); setErr('');
    try { await onSave(draft); setState('idle'); }
    catch (e: any) { setState('error'); setErr(e?.message ?? 'Could not save'); }
  }

  const desk = b.guestPhoneSource === 'DESK';
  return (
    <div className="min-w-0 flex items-center gap-1" onClick={e => e.stopPropagation()}>
      <div className={cn('flex-1 min-w-0 flex items-center gap-1 h-7 px-1.5 rounded-lg border bg-white',
        state === 'error' ? 'border-coral' : 'border-surface-border focus-within:ring-2 focus-within:ring-accent/30')}>
        <Phone size={11} className="text-ink-faint flex-shrink-0" />
        <input
          type="tel"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setDraft(b.guestPhone ?? ''); (e.target as HTMLInputElement).blur(); } }}
          placeholder="+420…"
          disabled={state === 'saving'}
          className="w-full min-w-0 bg-transparent outline-none font-mono text-[11.5px] text-ink placeholder:text-ink-faint disabled:opacity-60"
          title={state === 'error' ? err : desk ? 'Entered by the front desk' : b.guestPhone ? 'From Avantio' : 'No phone yet'}
        />
      </div>
      <span className="w-4 flex-shrink-0 flex justify-center">
        {state === 'saving' ? <span className="w-2 h-2 rounded-full bg-sand animate-pulse" />
          : desk && b.guestPhonePushError ? <span title={b.guestPhonePushError}><CloudOff size={13} className="text-coral" /></span>
          : desk && b.guestPhonePushedAt ? <span title="Pushed to Avantio"><Cloud size={13} className="text-accent" /></span>
          : null}
      </span>
    </div>
  );
}
