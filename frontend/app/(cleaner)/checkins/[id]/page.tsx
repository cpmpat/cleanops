'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { checkins as checkinsApi, type CheckInDetail, type RatingAspect } from '@/lib/api';
import { translations, type Locale } from '@/i18n/translations';
import { useCheckInStrings } from '@/i18n/checkins';
import { addDays, dayParts } from '@/i18n/availability';
import { useRefreshOnReconnect } from '@/lib/socket';
import { cn } from '@/lib/utils';
import { Baby, BedSingle, ChevronLeft, ExternalLink, Phone, Users } from 'lucide-react';

/**
 * Agent · one check-in. Everything needed at the door (guest, phone, time,
 * registration link) and, from the arrival day on, the report: how it went
 * and how ready the apartment was.
 */
export default function CheckInDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const locale = (user?.language as Locale) ?? 'en';
  const t = translations[locale];
  const s = useCheckInStrings(locale);

  const [data, setData] = useState<CheckInDetail | null>(null);
  const [error, setError] = useState('');

  // The form. Filled from the saved report when there is one.
  const [comment, setComment] = useState('');
  const [scores, setScores] = useState<Partial<Record<RatingAspect, number>>>({});
  const [why, setWhy] = useState<Partial<Record<RatingAspect, string>>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await checkinsApi.detail(id);
      setData(d);
      setError('');
      if (d.report) {
        setComment(d.report.comment ?? '');
        setScores(Object.fromEntries(d.report.ratings.map(r => [r.aspect, r.score])));
        setWhy(Object.fromEntries(d.report.ratings.map(r => [r.aspect, r.comment ?? ''])));
      }
    } catch (e: any) {
      setError(e?.message ?? 'Failed');
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  useRefreshOnReconnect(load);

  useEffect(() => {
    if (!toast) return;
    const tid = setTimeout(() => setToast(''), 3000);
    return () => clearTimeout(tid);
  }, [toast]);

  async function save() {
    if (!data) return;
    // Same rule as the server, said before the round trip.
    for (const a of data.aspects) {
      const sc = scores[a];
      if (!sc) { setFormError(`${s.aspect[a]}: 1–5`); return; }
      if (sc < data.lowScore && (why[a] ?? '').trim().length < 5) { setFormError(`${s.aspect[a]}: ${s.lowNeedsComment}`); return; }
    }
    setBusy(true);
    setFormError('');
    try {
      await checkinsApi.saveReport(data.id, {
        comment: comment.trim() || undefined,
        ratings: data.aspects.map(a => ({ aspect: a, score: scores[a]!, comment: (why[a] ?? '').trim() || undefined })),
      });
      setToast(s.reportSaved);
      void load();
    } catch (e: any) {
      setFormError(e?.message ?? 'Failed');
    } finally {
      setBusy(false);
    }
  }

  const dayLabel = (day: string) => {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' });
    if (day === today) return s.today;
    if (day === addDays(today, 1)) return s.tomorrow;
    return dayParts(day, locale).long;
  };

  return (
    <div className="min-h-screen bg-surface tabular-nums">
      <div className="bg-ink text-white px-4 pt-12 pb-5">
        <Link href="/checkins" className="inline-flex items-center gap-1 text-white/60 text-sm mb-3">
          <ChevronLeft size={16} /> {s.back}
        </Link>
        {data && (
          <>
            <h1 className="text-xl font-bold">{data.accommodationName}</h1>
            <p className="text-white/70 text-sm mt-1">
              {dayLabel(data.day)} · <span className={cn('font-bold', data.arrivalAssumed ? 'text-amber-300' : 'text-white')}>{data.time}</span>
              {data.arrivalAssumed && <span className="text-amber-300"> · {s.timeNotConfirmed}</span>}
            </p>
          </>
        )}
      </div>

      <div className="px-4 py-4 space-y-3">
        {!data && !error && <div className="h-40 rounded-2xl bg-white border border-surface-border animate-pulse" />}
        {error && !data && (
          <div className="text-center py-12">
            <p className="text-sm text-red-600 mb-3">{error}</p>
            <button onClick={() => void load()} className="text-xs text-accent underline">{t.general.retry}</button>
          </div>
        )}

        {data && (
          <>
            {/* At the door */}
            <section className="rounded-2xl bg-white border border-surface-border divide-y divide-surface-border">
              <Row label={s.guest}>
                <span className="font-semibold text-ink">{data.guestName ?? '—'}</span>
              </Row>
              <Row label={s.call}>
                {data.guestPhone ? (
                  <a href={`tel:${data.guestPhone.replace(/\s+/g, '')}`} className="inline-flex items-center gap-1.5 font-semibold text-accent">
                    <Phone size={14} /> {data.guestPhone}
                  </a>
                ) : <span className="text-ink-faint text-sm">{s.noPhone}</span>}
              </Row>
              <Row label={s.guests}>
                <span className="inline-flex items-center gap-1.5 text-ink">
                  <Users size={14} className="text-ink-faint" />
                  {data.numAdults}{data.numChildren ? ` + ${data.numChildren}` : ''}
                  {data.needsCrib && <span className="inline-flex items-center gap-1 text-xs text-ink-soft ml-2"><Baby size={13} />{s.crib}</span>}
                  {data.separateBeds && <span className="inline-flex items-center gap-1 text-xs text-ink-soft ml-2"><BedSingle size={13} />{s.separateBeds}</span>}
                </span>
              </Row>
              <Row label="Ref">
                <span className="font-mono text-xs text-ink-muted">{data.bookingRef}</span>
              </Row>
            </section>

            {data.checkInLinkUrl && (
              <a
                href={data.checkInLinkUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 h-12 rounded-2xl bg-white border border-surface-border text-sm font-semibold text-accent"
              >
                <ExternalLink size={15} /> {s.openChekin}
              </a>
            )}

            {/* Report */}
            <section className="rounded-2xl bg-white border border-surface-border p-4 space-y-4">
              <h2 className="text-base font-bold text-ink">{s.reportTitle}</h2>

              {data.awaitingMyAnswer ? (
                <p className="text-sm text-amber-800">{s.acceptFirst}</p>
              ) : !data.canReport && !data.report ? (
                <p className="text-sm text-ink-muted">
                  {data.day > new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' }) ? s.reportFromArrivalDay : s.reportClosed}
                </p>
              ) : (
                <>
                  <div className="space-y-3">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">{s.readiness}</p>
                    {data.aspects.map(a => {
                      const sc = scores[a];
                      const low = !!sc && sc < data.lowScore;
                      return (
                        <div key={a} className="space-y-2">
                          <p className="text-sm font-semibold text-ink">{s.aspect[a]}</p>
                          <div className="grid grid-cols-5 gap-1.5">
                            {[1, 2, 3, 4, 5].map(n => (
                              <button
                                key={n}
                                type="button"
                                disabled={!data.canReport}
                                aria-pressed={sc === n}
                                onClick={() => setScores(prev => ({ ...prev, [a]: n }))}
                                className={cn(
                                  'h-12 rounded-xl text-lg font-bold transition disabled:opacity-60',
                                  sc === n
                                    ? n < data.lowScore ? 'bg-red-600 text-white' : 'bg-ink text-white'
                                    : 'bg-surface-sunken text-ink-soft',
                                )}
                              >
                                {n}
                              </button>
                            ))}
                          </div>
                          {low && (
                            <div className="space-y-1">
                              <p className="text-xs font-semibold text-red-700">{s.lowNeedsComment}</p>
                              <textarea
                                value={why[a] ?? ''}
                                disabled={!data.canReport}
                                onChange={e => setWhy(prev => ({ ...prev, [a]: e.target.value }))}
                                placeholder={s.whatWasWrong}
                                rows={3}
                                maxLength={1000}
                                className="w-full rounded-xl border border-red-300 px-3 py-2 text-sm"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <textarea
                    value={comment}
                    disabled={!data.canReport}
                    onChange={e => setComment(e.target.value)}
                    placeholder={s.reportComment}
                    rows={4}
                    maxLength={2000}
                    className="w-full rounded-xl border border-surface-border px-3 py-2 text-sm"
                  />

                  {formError && <p className="text-sm text-red-700 bg-red-50 rounded-xl px-3 py-2">{formError}</p>}

                  {data.canReport && (
                    <button
                      type="button"
                      onClick={() => void save()}
                      disabled={busy}
                      className="w-full h-[52px] rounded-2xl bg-ink text-white text-[15px] font-bold disabled:opacity-60"
                    >
                      {data.report ? s.updateReport : s.saveReport}
                    </button>
                  )}
                </>
              )}
            </section>
          </>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-24 left-4 right-4 z-50 bg-ink text-white text-sm rounded-xl px-4 py-3 shadow-modal text-center">
          {toast}
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className="text-right min-w-0">{children}</span>
    </div>
  );
}
