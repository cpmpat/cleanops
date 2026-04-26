'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { auth as authApi, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { translations, type Locale } from '@/i18n/translations';
import { getStoredLocale, setStoredLocale } from '@/lib/locale-storage';
import { ArrowRight, Mail, Globe, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

const LOCALES: { code: Locale; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'cs', label: 'CS' },
  { code: 'ru', label: 'RU' },
  { code: 'uk', label: 'UK' },
];

type Mode = 'password' | 'magic-request' | 'magic-sent';

export default function LoginPage() {
  const router = useRouter();
  const { setAuth, user, loading } = useAuth();

  const [locale, setLocaleState] = useState<Locale>('en');
  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [devToken, setDevToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const t = translations[locale].login;
  const tGen = translations[locale].general;

  // Hydrate locale from storage on mount
  useEffect(() => {
    setLocaleState(getStoredLocale());
  }, []);

  // Redirect if already logged in
  useEffect(() => {
    if (!loading && user) {
      router.replace(user.role === 'MANAGER' ? '/dashboard' : '/cleanings');
    }
  }, [user, loading, router]);

  function changeLocale(l: Locale) {
    setLocaleState(l);
    setStoredLocale(l);
  }

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setSubmitting(true);
    setError('');
    try {
      const { accessToken, user } = await authApi.login(email, password);
      setAuth(accessToken, user);
      router.replace(user.role === 'MANAGER' ? '/dashboard' : '/cleanings');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError(t.invalidCredentials);
      } else {
        setError(err instanceof Error ? err.message : tGen.error);
      }
      setSubmitting(false);
    }
  }

  async function handleMagicRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await authApi.requestMagicLink(email);
      setMode('magic-sent');
      if (res._dev_token) setDevToken(res._dev_token);
    } catch (err) {
      setError(err instanceof Error ? err.message : tGen.error);
    } finally {
      setSubmitting(false);
    }
  }

  function backToPassword() {
    setMode('password');
    setDevToken(null);
    setError('');
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <img src="/airstay-logo.svg" alt="Airstay" className="w-14 h-14" />
          <p className="text-sm text-ink-muted">{tGen.loading}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo + app name */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-4">
            <img
              src="/airstay-logo.svg"
              alt="Airstay"
              className="w-16 h-16 drop-shadow-md"
            />
          </div>
          <h1 className="text-2xl font-bold text-ink tracking-tight">
            Airstay <span className="text-ink-muted font-medium">Portal App</span>
          </h1>
          <p className="text-sm text-ink-muted mt-1.5">{t.subtitle}</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-surface-border shadow-card p-6">

          {/* ─── Password login ─── */}
          {mode === 'password' && (
            <form onSubmit={handlePasswordLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
                  {t.email}
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-surface-border bg-surface text-ink text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition"
                  placeholder="name@company.com"
                  autoComplete="email"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
                  {t.password}
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-surface-border bg-surface text-ink text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition"
                  autoComplete="current-password"
                  required
                />
              </div>

              {error && (
                <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
              )}

              <button
                type="submit"
                disabled={submitting || !email || !password}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-ink text-white rounded-xl text-sm font-semibold hover:bg-ink-soft transition disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
              >
                {submitting ? t.signingIn : t.loginBtn}
                {!submitting && <ArrowRight size={16} />}
              </button>

              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => { setMode('magic-request'); setError(''); }}
                  className="text-xs text-ink-muted hover:text-ink transition underline underline-offset-2"
                >
                  {t.firstTime}
                </button>
              </div>
            </form>
          )}

          {/* ─── Magic link request ─── */}
          {mode === 'magic-request' && (
            <form onSubmit={handleMagicRequest} className="space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <Lock size={16} className="text-ink-muted" />
                <p className="text-xs text-ink-muted">{t.firstTime}</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
                  {t.email}
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-surface-border bg-surface text-ink text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition"
                  placeholder="name@company.com"
                  autoComplete="email"
                  required
                  autoFocus
                />
              </div>

              {error && (
                <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
              )}

              <button
                type="submit"
                disabled={submitting || !email}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-ink text-white rounded-xl text-sm font-semibold hover:bg-ink-soft transition disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
              >
                {submitting ? t.sendingLink : t.requestLink}
                {!submitting && <ArrowRight size={16} />}
              </button>

              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={backToPassword}
                  className="text-xs text-ink-muted hover:text-ink transition"
                >
                  ← {t.backToLogin}
                </button>
              </div>
            </form>
          )}

          {/* ─── Magic link sent confirmation ─── */}
          {mode === 'magic-sent' && (
            <div className="text-center py-2">
              <div className="w-14 h-14 rounded-full bg-accent-soft flex items-center justify-center mx-auto mb-4">
                <Mail size={26} className="text-accent" />
              </div>
              <h2 className="font-bold text-ink mb-1">{t.emailSent}</h2>
              <p className="text-sm text-ink-muted">{t.emailSentSub}</p>

              {devToken && (
                <div className="mt-5 pt-5 border-t border-surface-border">
                  <p className="text-xs text-ink-faint mb-2">Dev mode</p>
                  <a
                    href={`/auth/verify?token=${devToken}`}
                    className="inline-flex w-full px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 transition items-center justify-center gap-2"
                  >
                    {t.devMode} <ArrowRight size={14} />
                  </a>
                </div>
              )}

              <button
                onClick={backToPassword}
                className="mt-4 text-xs text-ink-muted hover:text-ink transition"
              >
                ← {t.backToLogin}
              </button>
            </div>
          )}
        </div>

        {/* Language switcher */}
        <div className="flex items-center justify-center gap-1 mt-6">
          <Globe size={13} className="text-ink-faint" />
          <div className="flex gap-1 ml-1">
            {LOCALES.map(({ code, label }) => (
              <button
                key={code}
                onClick={() => changeLocale(code)}
                className={cn(
                  'px-2.5 py-1 rounded-lg text-xs font-medium transition',
                  locale === code
                    ? 'bg-ink text-white'
                    : 'text-ink-muted hover:text-ink hover:bg-surface-sunken',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
