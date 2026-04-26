'use client';
import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { auth as authApi, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { translations, type Locale } from '@/i18n/translations';
import { getStoredLocale } from '@/lib/locale-storage';
import { ArrowRight, Lock, AlertCircle } from 'lucide-react';

type Stage = 'verifying' | 'invalid' | 'set-password';

export default function VerifyPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setAuth } = useAuth();

  const [locale, setLocale] = useState<Locale>('en');
  const [stage, setStage] = useState<Stage>('verifying');
  const [setupToken, setSetupToken] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [userEmail, setUserEmail] = useState<string>('');
  const [isFirstTime, setIsFirstTime] = useState<boolean>(true);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const t = translations[locale].setPassword;
  const tLogin = translations[locale].login;
  const tGen = translations[locale].general;

  useEffect(() => {
    setLocale(getStoredLocale());
  }, []);

  // Verify the token on mount
  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setStage('invalid');
      return;
    }
    (async () => {
      try {
        const res = await authApi.verify(token);
        setSetupToken(res.setupToken);
        setName(res.name);
        setUserEmail(res.email);
        setIsFirstTime(res.isFirstTime);
        setStage('set-password');
      } catch {
        setStage('invalid');
      }
    })();
  }, [searchParams]);

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (newPassword.length < 8) {
      setError(t.minLength);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t.mustMatch);
      return;
    }

    setSubmitting(true);
    try {
      const { accessToken, user } = await authApi.setPassword(
        setupToken,
        newPassword,
      );
      setAuth(accessToken, user);
      router.replace(user.role === 'MANAGER' ? '/dashboard' : '/cleanings');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : tGen.error);
      }
      setSubmitting(false);
    }
  }

  // ─── Loading ─────────────────────────────────────
  if (stage === 'verifying') {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4">
          <img src="/airstay-logo.svg" alt="Airstay" className="w-14 h-14" />
          <p className="text-sm text-ink-muted">{t.verifying}</p>
        </div>
      </div>
    );
  }

  // ─── Invalid / expired link ──────────────────────
  if (stage === 'invalid') {
    return (
      <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="bg-white rounded-2xl border border-surface-border shadow-card p-6 text-center">
            <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
              <AlertCircle size={26} className="text-red-600" />
            </div>
            <h2 className="font-bold text-ink mb-2">{t.invalidLink}</h2>
            <a
              href="/login"
              className="inline-flex mt-4 items-center gap-2 px-4 py-2.5 bg-ink text-white rounded-xl text-sm font-semibold hover:bg-ink-soft transition"
            >
              {t.requestNew} <ArrowRight size={14} />
            </a>
          </div>
        </div>
      </div>
    );
  }

  // ─── Set password form ───────────────────────────
  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-4">
            <img
              src="/airstay-logo.svg"
              alt="Airstay"
              className="w-16 h-16 drop-shadow-md"
            />
          </div>
          <h1 className="text-2xl font-bold text-ink tracking-tight">
            {isFirstTime ? t.titleFirst : t.titleReset}
          </h1>
          <p className="text-sm text-ink-muted mt-1.5">
            {isFirstTime ? t.subtitleFirst : t.subtitleReset}
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-surface-border shadow-card p-6">
          {/* User identity badge */}
          <div className="flex items-center gap-3 mb-5 pb-4 border-b border-surface-border">
            <div className="w-10 h-10 rounded-full bg-accent-soft flex items-center justify-center shrink-0">
              <Lock size={16} className="text-accent" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink truncate">{name}</p>
              <p className="text-xs text-ink-muted truncate">{userEmail}</p>
            </div>
          </div>

          <form onSubmit={handleSetPassword} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
                {t.newPassword}
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-surface-border bg-surface text-ink text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition"
                autoComplete="new-password"
                minLength={8}
                required
                autoFocus
              />
              <p className="text-xs text-ink-faint mt-1.5">{t.minLength}</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
                {t.confirmPassword}
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-surface-border bg-surface text-ink text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>

            {error && (
              <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
            )}

            <button
              type="submit"
              disabled={submitting || !newPassword || !confirmPassword}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-ink text-white rounded-xl text-sm font-semibold hover:bg-ink-soft transition disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
            >
              {submitting ? t.settingUp : t.setBtn}
              {!submitting && <ArrowRight size={16} />}
            </button>
          </form>
        </div>

        {/* Back to login */}
        <div className="text-center mt-6">
          <a
            href="/login"
            className="text-xs text-ink-muted hover:text-ink transition"
          >
            ← {tLogin.backToLogin}
          </a>
        </div>
      </div>
    </div>
  );
}
