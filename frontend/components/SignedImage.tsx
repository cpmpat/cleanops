'use client';
import { useEffect, useState } from 'react';
import { uploads } from '@/lib/api';
import { Loader2, Image as ImageIcon } from 'lucide-react';

/**
 * In-memory cache of signed read URLs so re-renders don't re-sign the same key.
 * Entry shape: { url, expiresAt (ms epoch) }. Cleared when entry is within 60s
 * of expiry, forcing a re-fetch.
 */
const readUrlCache = new Map<string, { url: string; expiresAt: number }>();
const SIGN_TTL_MIN = 60;
const REFRESH_BUFFER_MS = 60_000;

/**
 * Extracts the GCS object key from a canonical publicUrl, e.g.
 *   https://storage.googleapis.com/portal_app_media/562885/2026-05-11T...jpg
 *       → 562885/2026-05-11T...jpg
 *
 * Returns null if the URL doesn't match the expected bucket pattern.
 */
function keyFromUrl(url: string): string | null {
  if (!url) return null;
  const match = url.match(/^https:\/\/storage\.googleapis\.com\/[^/]+\/(.+)$/);
  if (match) return decodeURIComponent(match[1]);
  // Already a key (e.g. just "562885/photo.jpg")?
  if (!url.startsWith('http')) return url;
  return null;
}

async function getSignedUrl(key: string): Promise<string> {
  const now = Date.now();
  const cached = readUrlCache.get(key);
  if (cached && cached.expiresAt - now > REFRESH_BUFFER_MS) {
    return cached.url;
  }
  const res = await uploads.getReadUrl(key, SIGN_TTL_MIN);
  readUrlCache.set(key, {
    url: res.url,
    expiresAt: now + SIGN_TTL_MIN * 60 * 1000,
  });
  return res.url;
}

interface SignedImageProps {
  /** Either the canonical GCS publicUrl or the raw object key */
  src: string;
  alt?: string;
  className?: string;
}

/**
 * Renders an <img> from a private GCS object by transparently fetching a
 * signed read URL. Falls back to a placeholder on error.
 */
export function SignedImage({ src, alt = '', className }: SignedImageProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const key = keyFromUrl(src);
    if (!key) {
      setError(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(false);
    getSignedUrl(key)
      .then((url) => {
        if (cancelled) return;
        setSignedUrl(url);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [src]);

  if (loading) {
    return (
      <div
        className={
          className ??
          'w-full h-full flex items-center justify-center text-ink-muted'
        }
      >
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (error || !signedUrl) {
    return (
      <div
        className={
          className ??
          'w-full h-full flex items-center justify-center text-ink-faint'
        }
      >
        <ImageIcon size={16} />
      </div>
    );
  }

  return <img src={signedUrl} alt={alt} className={className} />;
}
