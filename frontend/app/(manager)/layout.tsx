'use client';
import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { translations, type Locale } from '@/i18n/translations';
import {
  LayoutDashboard, Users, Building2, CalendarCheck,
  CalendarRange, Settings, LogOut, ChevronRight, Globe,
  AlertTriangle, Activity, Database, Wrench, Mail,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { LocaleProvider, useLocale } from '@/lib/locale-context';
import { messageStrings } from '@/i18n/messages';
import { NewVersionPrompt } from '@/components/NewVersionPrompt';

const LOCALES: { code: Locale; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'cs', label: 'CS' },
  { code: 'ru', label: 'RU' },
  { code: 'uk', label: 'UK' },
];

export default function ManagerLayout({ children }: { children: React.ReactNode }) {
  return (
    <LocaleProvider>
      <ManagerShell>{children}</ManagerShell>
    </LocaleProvider>
  );
}

function ManagerShell({ children }: { children: React.ReactNode }) {
  const { user, loading, loadFromStorage, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { locale, setLocale } = useLocale();

  useEffect(() => { loadFromStorage(); }, []);

  useEffect(() => {
    if (!loading) {
      if (!user) { router.replace('/login'); return; }
      if (user.role === 'REPAIRMAN') { router.replace('/my-repairs'); return; }
      // ADMIN sees the manager app. The other new roles have no home of their
      // own yet, so they land in the cleaner app until their scope is defined.
      if (user.role !== 'MANAGER' && user.role !== 'ADMIN') {
        router.replace('/cleanings');
        return;
      }
    }
  }, [user, loading]);

  const t = translations[locale];

  const navItems = [
    { href: '/dashboard',  icon: LayoutDashboard, label: t.nav.dashboard },
    { href: '/planning',   icon: CalendarCheck,   label: t.nav.planning },
    { href: '/schedule',   icon: CalendarRange,   label: (t.nav as any).schedule ?? 'Schedule' },
    { href: '/streams',    icon: Activity,        label: (t.nav as any).streams  ?? 'Streams' },
    { href: '/incidents',  icon: AlertTriangle,   label: t.nav.incidents },
    { href: '/repairs',    icon: Wrench,          label: (t.nav as any).repairs  ?? 'Repairs' },
    { href: '/messages',   icon: Mail,            label: messageStrings[locale].manager.navLabel },
    { href: '/staff',      icon: Users,           label: t.nav.staff },
    { href: '/properties', icon: Building2,       label: t.nav.properties },
    { href: '/datasets',   icon: Database,        label: (t.nav as any).datasets ?? 'Datasets' },
    { href: '/settings',   icon: Settings,        label: t.nav.settings },
  ];

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="w-10 h-10 rounded-2xl bg-ink animate-pulse" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface flex">
      <NewVersionPrompt locale={locale} />
      <aside className="w-56 bg-ink flex-shrink-0 flex flex-col fixed h-full z-30">

        <div className="px-5 py-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <img src="/airstay-logo.svg" alt="Airstay" className="w-8 h-8 flex-shrink-0" />
            <div className="min-w-0">
              <p className="font-bold text-white text-sm leading-tight tracking-tight">Airstay</p>
              <p className="text-white/50 text-[10px] leading-tight">Portal App</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
          {navItems.map(({ href, icon: Icon, label }) => {
            const active = pathname === href || pathname?.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors',
                  active ? 'bg-white/15 text-white' : 'text-white/60 hover:text-white hover:bg-white/10',
                )}
              >
                <Icon size={17} strokeWidth={active ? 2.5 : 1.8} className="flex-shrink-0" />
                {label}
                {active && <ChevronRight size={14} className="ml-auto opacity-40" />}
              </Link>
            );
          })}
        </nav>

        <div className="px-3 py-3 border-t border-white/10">
          <div className="flex items-center gap-1.5 px-2 mb-2">
            <Globe size={12} className="text-white/40" />
            <span className="text-[10px] text-white/40 uppercase tracking-wider font-semibold">Language</span>
          </div>
          <div className="flex gap-1 px-1">
            {LOCALES.map(({ code, label }) => (
              <button
                key={code}
                onClick={() => setLocale(code)}
                className={cn(
                  'flex-1 py-1.5 rounded-lg text-xs font-semibold transition',
                  locale === code ? 'bg-white text-ink' : 'text-white/40 hover:text-white hover:bg-white/10',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="px-3 py-4 border-t border-white/10">
          <div className="flex items-center gap-3 px-3 py-2 mb-1">
            <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
              <span className="text-white text-xs font-bold">{user.name[0]}</span>
            </div>
            <div className="min-w-0">
              <p className="text-white text-xs font-medium truncate">{user.name}</p>
              <p className="text-white/40 text-[10px] truncate">{user.email}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-white/50 hover:text-white hover:bg-white/10 text-xs transition"
          >
            <LogOut size={14} />
            {t.general.logout}
          </button>
        </div>
      </aside>

      <main className="flex-1 ml-56 min-h-screen overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
