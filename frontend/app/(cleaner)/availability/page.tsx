'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { availability as availabilityApi, type AvailabilityBlock, type MyAvailability } from '@/lib/api';
import { HelpLink } from '@/components/HelpLink';
import { translations, type Locale } from '@/i18n/translations';
import {
  useAvailabilityStrings, addDays, mondayOf, dayParts, hhmm, formatDuration,
  type AvailabilityStrings,
} from '@/i18n/availability';
import { useRefreshOnReconnect } from '@/lib/socket';
import { cn } from '@/lib/utils';
import { Clock, Copy, Lock, LogOut, Minus, Plus, X } from 'lucide-react';

/** Minutes. A block ends by 06:00 next morning and is never 24 h long. */
const STEP = 30;
const MAX_END = 1440 + 6 * 60;

const PRESETS: { key: 'morning' | 'afternoon' | 'evening' | 'late'; start: number; end: number }[] = [
  { key: 'morning', start: 8 * 60, end: 12 * 60 },
  { key: 'afternoon', start: 12 * 60, end: 18 * 60 },
  { key: 'evening', start: 18 * 60, end: 23 * 60 },
  { key: 'late', start: 21 * 60, end: 25 * 60 },
];

type Sheet =
  | { mode: 'add'; day: string }
  | { mode: 'edit'; block: AvailabilityBlock };

/** "18:00 – 23:00", "21:00 – 01:00" */
const rangeLabel = (start: number, end: number) => `${hhmm(start)} – ${hhmm(end)}`;

/**
 * Agent · Availability.
 *
 * No hours on a day means not available — the list says so in words, so an
 * empty day never reads as "free to be called". Today's hours can be added to
 * but not changed or removed (the desk has planned around them); from
 * tomorrow on everything is editable.
 */
export default function AvailabilityPage() {
  const { user, logout } = useAuth();
  const locale = (user?.language as Locale) ?? 'en';
  const t = translations[locale];
  const s = useAvailabilityStrings(locale);

  const [data, setData] = useState<MyAvailability | null>(null);
  const [error, setError] = useState('');
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await availabilityApi.mine());
      setError('');
    } catch (e: any) {
      setError(e?.message ?? s.saveFailed);
    }
  }, [s.saveFailed]);

  useEffect(() => { void load(); }, [load]);
  useRefreshOnReconnect(load);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 3000);
    return () => clearTimeout(id);
  }, [toast]);

  const today = data?.today ?? null;
  const byDay = useMemo(() => {
    const map = new Map<string, AvailabilityBlock[]>();
    for (const b of data?.blocks ?? []) {
      const list = map.get(b.day) ?? [];
      list.push(b);
      map.set(b.day, list);
    }
    return map;
  }, [data]);

  // Today → Sunday of next week, in two groups.
  const groups = useMemo(() => {
    if (!today) return [];
    const monday = mondayOf(today);
    const thisWeek: string[] = [];
    for (let d = today; d <= addDays(monday, 6); d = addDays(d, 1)) thisWeek.push(d);
    const nextWeek = Array.from({ length: 7 }, (_, i) => addDays(monday, 7 + i));
    return [
      { key: 'this', label: s.thisWeek, days: thisWeek },
      { key: 'next', label: s.nextWeek, days: nextWeek },
    ];
  }, [today, s.thisWeek, s.nextWeek]);

  const summary = useMemo(() => {
    const days = groups[0]?.days ?? [];
    let n = 0;
    let minutes = 0;
    for (const d of days) {
      const list = byDay.get(d);
      if (!list?.length) continue;
      n++;
      minutes += list.reduce((acc, b) => acc + (b.endMinute - b.startMinute), 0);
    }
    return { n, minutes };
  }, [groups, byDay]);

  async function copyWeek() {
    if (!today) return;
    try {
      const res = await availabilityApi.copyWeek(mondayOf(today));
      setData(res);
      setToast(res.copied > 0 ? s.copied(res.copied) : s.nothingToCopy);
    } catch (e: any) {
      setToast(e?.message ?? s.saveFailed);
    }
  }

  const greeting = user?.name ? `${t.greeting}, ${user.name.split(' ')[0]}` : t.greeting;

  return (
    <div className="min-h-screen bg-surface tabular-nums">
      <div className="bg-ink text-white px-4 pt-12 pb-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-white/60 text-sm font-medium">{greeting}</p>
            <h1 className="text-xl font-bold mt-0.5">{s.title}</h1>
            <p className="text-white/60 text-xs mt-1 leading-relaxed">{s.subtitle}</p>
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <button
              onClick={logout}
              className="flex items-center gap-1.5 text-white/60 hover:text-white transition text-xs py-1.5 px-2 rounded-lg hover:bg-white/10"
            >
              <LogOut size={14} />
              {t.general.logout}
            </button>
            <HelpLink locale={locale} />
          </div>
        </div>
        {data && (
          <span className="mt-3 inline-flex items-center gap-1.5 bg-white/10 rounded-full px-3 py-1.5 text-xs font-semibold">
            <Clock size={12} />
            {s.summary(summary.n, formatDuration(summary.minutes))}
          </span>
        )}
      </div>

      <div className="px-4 py-4 space-y-2">
        {!data && !error && (
          <div className="space-y-2">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-16 rounded-2xl bg-white border border-surface-border animate-pulse" />)}
          </div>
        )}
        {error && !data && (
          <div className="text-center py-12">
            <p className="text-sm text-red-600 mb-3">{error}</p>
            <button onClick={() => void load()} className="text-xs text-accent underline">{t.general.retry}</button>
          </div>
        )}

        {data && groups.map(group => (
          <section key={group.key} className="space-y-2">
            <div className="flex items-center justify-between px-1 pt-2">
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">{group.label}</h2>
              {group.key === 'next' && (
                <button
                  type="button"
                  onClick={() => void copyWeek()}
                  className="flex items-center gap-1.5 text-xs font-semibold text-accent py-2 px-1"
                >
                  <Copy size={13} />
                  {s.copyWeek}
                </button>
              )}
            </div>
            {group.days.map(day => (
              <DayCard
                key={day}
                day={day}
                isToday={day === today}
                blocks={byDay.get(day) ?? []}
                locale={locale}
                s={s}
                onAdd={() => setSheet({ mode: 'add', day })}
                onEdit={block => setSheet({ mode: 'edit', block })}
              />
            ))}
          </section>
        ))}
      </div>

      {toast && (
        <div className="fixed left-4 right-4 bottom-24 z-50 bg-ink text-white text-sm font-medium rounded-2xl px-4 py-3 shadow-modal text-center">
          {toast}
        </div>
      )}

      {sheet && data && (
        <TimeSheet
          sheet={sheet}
          data={data}
          byDay={byDay}
          locale={locale}
          s={s}
          onClose={() => setSheet(null)}
          onSaved={next => { setData(next); setSheet(null); }}
        />
      )}
    </div>
  );
}

function DayCard({
  day, isToday, blocks, locale, s, onAdd, onEdit,
}: {
  day: string;
  isToday: boolean;
  blocks: AvailabilityBlock[];
  locale: Locale;
  s: AvailabilityStrings;
  onAdd: () => void;
  onEdit: (b: AvailabilityBlock) => void;
}) {
  const p = dayParts(day, locale);
  const empty = blocks.length === 0;
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-2xl px-3 py-2.5',
        isToday ? 'bg-white border-[1.5px] border-ink' : empty ? 'bg-surface-sunken border border-surface-border' : 'bg-white border border-surface-border',
      )}
    >
      <div className="w-11 flex flex-col items-center flex-shrink-0">
        <span className={cn('text-[11px] font-bold', isToday ? 'text-ink' : 'text-ink-muted')}>{p.dow}</span>
        <span className={cn('text-xl font-bold leading-tight', empty && !isToday ? 'text-ink-soft' : 'text-ink')}>{p.num}</span>
        {isToday && (
          <span className="text-[9px] font-bold text-white bg-ink rounded-full px-1.5 mt-0.5 uppercase">{s.today}</span>
        )}
      </div>

      {empty ? (
        <>
          <span className="flex-1 text-sm text-ink-muted">{s.notAvailable}</span>
          <button
            type="button"
            onClick={onAdd}
            className="h-11 px-3.5 rounded-xl border border-surface-border bg-white text-sm font-semibold text-ink flex items-center gap-1.5 active:scale-[0.98] transition"
          >
            <Plus size={16} />
            {s.addTime}
          </button>
        </>
      ) : (
        <>
          <div className="flex-1 flex flex-wrap gap-1.5 min-w-0">
            {blocks.map(b => (
              isToday ? (
                // Today is fixed: shown, not editable.
                <span
                  key={b.id}
                  title={s.todayLocked}
                  className="inline-flex items-center gap-1.5 min-h-10 px-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm font-bold"
                >
                  {rangeLabel(b.startMinute, b.endMinute)}
                  <Lock size={12} className="opacity-60" />
                </span>
              ) : (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => onEdit(b)}
                  className="min-h-10 px-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm font-bold active:scale-[0.98] transition"
                >
                  {rangeLabel(b.startMinute, b.endMinute)}
                </button>
              )
            ))}
          </div>
          <button
            type="button"
            onClick={onAdd}
            aria-label={s.addTimeOn(dayParts(day, locale).long)}
            className="w-11 h-11 rounded-xl border border-surface-border bg-white text-ink-soft flex items-center justify-center flex-shrink-0 active:scale-[0.98] transition"
          >
            <Plus size={20} />
          </button>
        </>
      )}
    </div>
  );
}

function TimeSheet({
  sheet, data, byDay, locale, s, onClose, onSaved,
}: {
  sheet: Sheet;
  data: MyAvailability;
  byDay: Map<string, AvailabilityBlock[]>;
  locale: Locale;
  s: AvailabilityStrings;
  onClose: () => void;
  onSaved: (next: MyAvailability) => void;
}) {
  const day = sheet.mode === 'add' ? sheet.day : sheet.block.day;
  const [start, setStart] = useState(sheet.mode === 'edit' ? sheet.block.startMinute : 18 * 60);
  const [end, setEnd] = useState(sheet.mode === 'edit' ? sheet.block.endMinute : 23 * 60);
  const [extraDays, setExtraDays] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // The end may not reach a full 24 h after the start: "05:00 → 06:00 next
  // day" and "05:00 → 06:00" would be the same two strings on the wire.
  const maxEnd = Math.min(MAX_END, start + 1440 - STEP);

  function moveStart(delta: number) {
    const next = Math.max(0, Math.min(1440 - STEP, start + delta));
    setStart(next);
    if (end <= next) setEnd(next + STEP);
    else if (end > Math.min(MAX_END, next + 1440 - STEP)) setEnd(Math.min(MAX_END, next + 1440 - STEP));
  }
  function moveEnd(delta: number) {
    setEnd(Math.max(start + STEP, Math.min(maxEnd, end + delta)));
  }

  // "Same hours also on": the next six days from this one, within the horizon.
  const nextDays = useMemo(
    () => Array.from({ length: 6 }, (_, i) => addDays(day, i + 1)).filter(d => d <= data.horizon),
    [day, data.horizon],
  );

  async function save() {
    setBusy(true);
    setErr('');
    try {
      const next = sheet.mode === 'add'
        ? await availabilityApi.add([day, ...Array.from(extraDays)], hhmm(start), hhmm(end))
        : await availabilityApi.update(sheet.block.id, hhmm(start), hhmm(end));
      onSaved(next);
    } catch (e: any) {
      setErr(e?.message ?? s.saveFailed);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (sheet.mode !== 'edit') return;
    setBusy(true);
    setErr('');
    try {
      onSaved(await availabilityApi.remove(sheet.block.id));
    } catch (e: any) {
      setErr(e?.message ?? s.saveFailed);
    } finally {
      setBusy(false);
    }
  }

  const p = dayParts(day, locale);
  const dayCount = 1 + extraDays.size;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label={p.long}>
      <button type="button" aria-label={s.close} onClick={onClose} className="absolute inset-0 bg-black/50" />
      <div className="relative bg-white rounded-t-3xl px-5 pt-2.5 pb-6 max-h-[92vh] overflow-y-auto space-y-4 safe-area-pb animate-slide-up">
        <div className="w-10 h-1 rounded-full bg-stone-300 mx-auto" />

        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-ink first-letter:uppercase">{p.long}</h2>
            <p className="text-sm text-ink-muted mt-0.5">{sheet.mode === 'edit' ? s.editTitle : s.sheetQuestion}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={s.close} className="w-11 h-11 rounded-xl bg-surface-sunken text-ink-soft flex items-center justify-center">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">{s.quickPick}</p>
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map(pr => {
              const on = pr.start === start && pr.end === end;
              return (
                <button
                  key={pr.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => { setStart(pr.start); setEnd(pr.end); }}
                  className={cn(
                    'text-left rounded-2xl px-3 py-2.5 min-h-[56px] transition',
                    on ? 'bg-emerald-50 border-2 border-emerald-700 text-emerald-900' : 'bg-white border border-stone-300 text-ink',
                  )}
                >
                  <span className="block text-sm font-bold">{s[pr.key]}</span>
                  <span className={cn('block text-[13px]', on ? 'text-emerald-900' : 'text-ink-soft')}>
                    {rangeLabel(pr.start, pr.end)}{pr.end > 1440 && <span className="text-ink-muted"> (+1)</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">{s.exact}</p>
          <div className="grid grid-cols-2 gap-2.5">
            <Stepper
              label={s.from}
              value={hhmm(start)}
              onMinus={() => moveStart(-STEP)}
              onPlus={() => moveStart(STEP)}
              minusLabel={s.earlier(s.from)}
              plusLabel={s.later30(s.from)}
            />
            <Stepper
              label={s.till}
              value={hhmm(end)}
              suffix={end > 1440 ? '+1' : undefined}
              onMinus={() => moveEnd(-STEP)}
              onPlus={() => moveEnd(STEP)}
              minusLabel={s.earlier(s.till)}
              plusLabel={s.later30(s.till)}
            />
          </div>
          <p className="text-[11.5px] text-ink-muted px-0.5">{s.overnightHint}</p>
        </div>

        {sheet.mode === 'add' && nextDays.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">{s.alsoOn}</p>
            <div className="grid grid-cols-7 gap-1.5">
              <span className="h-[52px] rounded-xl bg-ink text-white flex flex-col items-center justify-center" aria-current="true">
                <span className="text-[10px] font-bold">{p.dow}</span>
                <span className="text-[15px] font-bold leading-tight">{p.num}</span>
              </span>
              {nextDays.map(d => {
                const dp = dayParts(d, locale);
                const on = extraDays.has(d);
                const has = (byDay.get(d)?.length ?? 0) > 0;
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    aria-label={dp.long}
                    onClick={() => setExtraDays(prev => {
                      const next = new Set(prev);
                      if (next.has(d)) next.delete(d); else next.add(d);
                      return next;
                    })}
                    className={cn(
                      'relative h-[52px] rounded-xl flex flex-col items-center justify-center transition',
                      on ? 'bg-emerald-50 border-2 border-emerald-700 text-emerald-900' : 'bg-white border border-stone-300 text-ink',
                    )}
                  >
                    <span className={cn('text-[10px] font-bold', on ? '' : 'text-ink-muted')}>{dp.dow}</span>
                    <span className="text-[15px] font-bold leading-tight">{dp.num}</span>
                    {has && <span className="absolute bottom-1 w-1.5 h-1.5 rounded-full bg-emerald-700" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {err && <p className="text-sm text-red-700 bg-red-50 rounded-xl px-3 py-2">{err}</p>}

        <div className="space-y-2 pt-1">
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="w-full h-[54px] rounded-2xl bg-ink text-white text-[15px] font-bold disabled:opacity-60"
          >
            {sheet.mode === 'edit' ? s.saveChange : s.save(rangeLabel(start, end), dayCount)}
          </button>
          {sheet.mode === 'edit' && (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              className="w-full h-12 rounded-2xl text-red-700 text-sm font-semibold disabled:opacity-60"
            >
              {s.remove}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stepper({
  label, value, suffix, onMinus, onPlus, minusLabel, plusLabel,
}: {
  label: string;
  value: string;
  suffix?: string;
  onMinus: () => void;
  onPlus: () => void;
  minusLabel: string;
  plusLabel: string;
}) {
  return (
    <div className="border border-surface-border rounded-2xl p-2 space-y-1">
      <span className="block text-[11.5px] font-semibold text-ink-muted pl-1">{label}</span>
      <div className="flex items-center justify-between">
        <button type="button" onClick={onMinus} aria-label={minusLabel} className="w-11 h-11 rounded-xl bg-surface-sunken text-ink flex items-center justify-center active:scale-95 transition">
          <Minus size={18} />
        </button>
        <span className="text-[22px] font-bold text-ink">
          {value}
          {suffix && <sup className="text-[11px] font-semibold text-ink-muted ml-0.5">{suffix}</sup>}
        </span>
        <button type="button" onClick={onPlus} aria-label={plusLabel} className="w-11 h-11 rounded-xl bg-surface-sunken text-ink flex items-center justify-center active:scale-95 transition">
          <Plus size={18} />
        </button>
      </div>
    </div>
  );
}
