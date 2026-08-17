'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { help as helpApi, users as usersApi, type HelpDoc } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useMessageStrings } from '@/i18n/messages';
import type { Locale } from '@/i18n/translations';

/**
 * The manual, in the reader's language.
 *
 * Rendered in an iframe on purpose. The manual is a standalone document that
 * styles `body`, `h2`, `table`; injected into the page it would repaint the
 * whole app. No `allow-scripts` and no `allow-same-origin` — it is content,
 * not code, and it stays that way.
 */

/** Documents are megabytes; keep the fetched one for the tab's lifetime. */
const cache = new Map<string, HelpDoc>();

export default function HelpPage() {
  const { user, token, setAuth } = useAuth();
  const locale = (user?.language as Locale) ?? 'cs';
  const m = useMessageStrings(locale);

  const [doc, setDoc] = useState<HelpDoc | null>(null);
  const [wanted, setWanted] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async (requested?: string) => {
    const key = requested ?? 'default';
    setLoading(true);
    setMissing(false);
    try {
      const cached = cache.get(key);
      const fresh = cached ?? (await helpApi.get(requested));
      cache.set(key, fresh);
      setDoc(fresh);
    } catch {
      setMissing(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(wanted ?? undefined); }, [load, wanted]);

  // Opening the manual clears the "new version" dot in the header.
  useEffect(() => {
    if (!doc || !user || !token) return;
    const seen = (user.preferences as any)?.helpSeenVersion ?? 0;
    if (doc.version <= seen) return;
    usersApi
      .updateMyPreferences({ ...(user.preferences ?? {}), helpSeenVersion: doc.version })
      .then((updated) => setAuth(token, { ...user, preferences: updated.preferences }))
      .catch(() => {});
  }, [doc?.version, user?.id, token]);

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <div className="bg-ink text-white px-4 pt-12 pb-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Link
            href="/cleanings"
            className="w-9 h-9 -ml-1 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/70"
            aria-label={m.help.back}
          >
            <ArrowLeft size={18} />
          </Link>
          <h1 className="text-xl font-bold">{m.help.title}</h1>
        </div>

        {doc && doc.availableLocales.length > 1 && (
          <div className="flex gap-1.5 mt-3 flex-wrap">
            {doc.availableLocales.map((l) => (
              <button
                key={l}
                onClick={() => setWanted(l)}
                className={`text-[11px] px-3 py-1 rounded-full font-medium transition ${
                  doc.locale === l ? 'bg-white text-ink' : 'bg-white/10 text-white/75 hover:bg-white/20'
                }`}
              >
                {LOCALE_LABEL[l] ?? l.toUpperCase()}
              </button>
            ))}
          </div>
        )}

        {doc && (
          <p className="text-[11px] text-white/45 mt-2">
            {m.help.updated(new Date(doc.publishedAt).toLocaleDateString())}
            {doc.isFallback && ` · ${m.help.fallbackNotice}`}
          </p>
        )}
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-sm text-ink-muted">
          {m.help.loading}
        </div>
      ) : missing || !doc ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
          <BookOpen size={30} className="text-ink-faint mb-3" />
          <p className="font-semibold text-ink">{m.help.empty}</p>
          <p className="text-sm text-ink-muted mt-1">{m.help.emptyHint}</p>
        </div>
      ) : (
        <iframe
          key={`${doc.locale}-${doc.version}`}
          srcDoc={doc.html}
          title={m.help.title}
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          className="flex-1 w-full border-0 bg-white"
        />
      )}
    </div>
  );
}

const LOCALE_LABEL: Record<string, string> = {
  cs: 'Čeština',
  uk: 'Українська',
  ru: 'Русский',
  en: 'English',
};
