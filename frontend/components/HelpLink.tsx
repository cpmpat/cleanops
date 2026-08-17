'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { HelpCircle } from 'lucide-react';
import { help as helpApi, type HelpMeta } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useMessageStrings } from '@/i18n/messages';
import type { Locale } from '@/i18n/translations';

/**
 * "Nápověda" in the dark header, under "Odhlásit".
 *
 * Hidden until a manual actually exists — a help button that opens an empty
 * page is worse than no button. The dot means the manual changed since this
 * person last opened it, which is why we ask for the version (a few bytes)
 * rather than the document (megabytes).
 */
export function HelpLink({ locale }: { locale: Locale }) {
  const { user } = useAuth();
  const m = useMessageStrings(locale);
  const [meta, setMeta] = useState<HelpMeta | null>(null);

  useEffect(() => {
    helpApi.meta().then(setMeta).catch(() => {});
  }, []);

  if (!meta?.exists) return null;

  const seen = (user?.preferences as any)?.helpSeenVersion ?? 0;
  const isNew = meta.version > seen;

  return (
    <Link
      href="/help"
      className="flex items-center gap-1.5 text-white/60 hover:text-white transition text-xs py-1.5 px-2 rounded-lg hover:bg-white/10"
    >
      <HelpCircle size={14} />
      {m.help.title}
      {isNew && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
    </Link>
  );
}
