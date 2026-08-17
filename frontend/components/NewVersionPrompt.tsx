'use client';
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useMessageStrings } from '@/i18n/messages';
import type { Locale } from '@/i18n/translations';

/**
 * Cleaners never reload. Without this they keep running the JavaScript they
 * downloaded weeks ago, against an API that has moved on — and the symptom is
 * never "old app", it is some feature quietly not working.
 *
 * The bundle knows the build it was compiled from; the server answers with the
 * build it is serving now. Different means a deploy happened under their feet.
 */
const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev';
const CHECK_EVERY_MS = 10 * 60 * 1000;

export function NewVersionPrompt({ locale }: { locale: Locale }) {
  const m = useMessageStrings(locale);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    // In dev the build id changes on every restart — nagging would be noise.
    if (!BUILD_ID || BUILD_ID.startsWith('local-') || BUILD_ID === 'dev') return;

    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch('/api/app-version', { cache: 'no-store' });
        const data = await res.json();
        if (!cancelled && data?.buildId && data.buildId !== BUILD_ID) setStale(true);
      } catch {
        // Offline — irrelevant, we will ask again.
      }
    };

    check();
    const onVisible = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(onVisible, CHECK_EVERY_MS);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, []);

  if (!stale) return null;

  return (
    <div className="fixed bottom-24 left-3 right-3 z-40 flex items-center gap-3 bg-ink text-white rounded-2xl px-4 py-3 shadow-lg">
      <p className="text-[13px] flex-1">{m.newVersion.message}</p>
      <button
        onClick={() => window.location.reload()}
        className="flex items-center gap-1.5 bg-white text-ink rounded-xl px-3 py-1.5 text-[13px] font-bold"
      >
        <RefreshCw size={13} />
        {m.newVersion.action}
      </button>
    </div>
  );
}
