'use client';

import type { Locale } from '@/i18n/translations';

const KEY = 'cleanops_locale';
const VALID: Locale[] = ['en', 'cs', 'ru', 'uk'];

/**
 * Read the user's preferred locale for pre-login screens.
 * Order: localStorage → browser language → 'en'
 */
export function getStoredLocale(): Locale {
  if (typeof window === 'undefined') return 'en';

  const stored = localStorage.getItem(KEY);
  if (stored && VALID.includes(stored as Locale)) return stored as Locale;

  const browser = navigator.language.slice(0, 2).toLowerCase();
  if (VALID.includes(browser as Locale)) return browser as Locale;

  return 'en';
}

export function setStoredLocale(locale: Locale) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(KEY, locale);
  }
}
