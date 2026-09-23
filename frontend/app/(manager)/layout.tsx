'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { translations, type Locale } from '@/i18n/translations';
import {
  LayoutDashboard, Users, Building2, CalendarCheck,
  CalendarRange, Settings, LogOut, ChevronRight, Globe,
  AlertTriangle, Activity, Database, Wrench, Mail, MessagesSquare, ChevronDown, Table2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { LocaleProvider, useLocale } from '@/lib/locale-context';
import { messageStrings } from '@/i18n/messages';
import { NewVersionPrompt } from '@/components/NewVersionPrompt';
import { datasets as datasetsApi, type DatasetSummary } from '@/lib/api';

/**
 * Office roles that are not managers. They may open Airchat and nothing else —
 * the first real permission split in the app, deliberately narrow.
 */
const DESK_ONLY_ROLES = ['OPERATION_MANAGER', 'FRONT_DESK_MANAGER', 'FRONT_DESK', 'ASSIST'];

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

      // The desk gets in, but only as far as Airchat — that is their whole
      // workplace for now. The rest of the manager app stays with MANAGER and
      // ADMIN until each role's scope is decided.
      if (DESK_ONLY_ROLES.includes(user.role)) {
        if (!pathname?.startsWith('/airchat')) { router.replace('/airchat'); }
        return;
      }
      if (user.role !== 'MANAGER' && user.role !== 'ADMIN') {
        router.replace('/cleanings');
        return;
      }
    }
  }, [user, loading]);

  const t = translations[locale];

  // The Data item unfolds into its source (CDM) and the lists under it, so a
  // manager can go straight to Owner without landing on Accommodation first.
  // The list is three rows and never changes during a session; one fetch.
  const [dataLists, setDataLists] = useState<DatasetSummary[]>([]);
  const onData = pathname?.startsWith('/datasets') ?? false;
  const [dataOpen, setDataOpen] = useState(onData);
  useEffect(() => { if (onData) setDataOpen(true); }, [onData]);
  useEffect(() => {
    if (!user || DESK_ONLY_ROLES.includes(user.role ?? '')) return;
    datasetsApi.list().then(setDataLists).catch(() => {});
  }, [user]);

  const navItems = [
    { href: '/dashboard',  icon: LayoutDashboard, label: t.nav.dashboard },
    { href: '/planning',   icon: CalendarCheck,   label: t.nav.planning },
    { href: '/schedule',   icon: CalendarRange,   label: (t.nav as any).schedule ?? 'Schedule' },
    { href: '/streams',    icon: Activity,        label: (t.nav as any).stream   ?? 'Stream' },
    { href: '/incidents',  icon: AlertTriangle,   label: t.nav.incidents },
    { href: '/repairs',    icon: Wrench,          label: (t.nav as any).repairs  ?? 'Repairs' },
    { href: '/airchat',    icon: MessagesSquare,  label: 'Airchat' },
    { href: '/messages',   icon: Mail,            label: messageStrings[locale].manager.navLabel },
    { href: '/staff',      icon: Users,           label: t.nav.staff },
    { href: '/properties', icon: Building2,       label: t.nav.properties },
    { href: '/datasets',   icon: Database,        label: (t.nav as any).data ?? 'Data' },
    { href: '/settings',   icon: Settings,        label: t.nav.settings },
  ];

  // Desk roles see one item. Showing them a menu they cannot open would just
  // be a list of locked doors.
  const visibleNav = DESK_ONLY_ROLES.includes(user?.role ?? '')
    ? navItems.filter((i) => i.href === '/airchat')
    : navItems;

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
          {visibleNav.map(({ href, icon: Icon, label }) => {
            const active = pathname === href || pathname?.startsWith(href + '/');
            const isData = href === '/datasets';
            return (
              <div key={href}>
                <div
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors',
                    active ? 'bg-white/15 text-white' : 'text-white/60 hover:text-white hover:bg-white/10',
                  )}
                >
                  <Link href={href} className="flex items-center gap-3 flex-1 min-w-0">
                    <Icon size={17} strokeWidth={active ? 2.5 : 1.8} className="flex-shrink-0" />
                    {label}
                  </Link>
                  {isData ? (
                    <button
                      type="button"
                      onClick={() => setDataOpen(o => !o)}
                      aria-expanded={dataOpen}
                      className="ml-auto -mr-1 p-1 rounded-md opacity-60 hover:opacity-100 hover:bg-white/10 transition"
                    >
                      <ChevronDown size={14} className={cn('transition-transform', dataOpen ? 'rotate-180' : '')} />
                    </button>
                  ) : (
                    active && <ChevronRight size={14} className="ml-auto opacity-40" />
                  )}
                </div>

                {/* Data → CDM → the lists in it */}
                {isData && dataOpen && dataLists.length > 0 && (
                  <Suspense fallback={null}>
                    <DataSubnav lists={dataLists} onData={onData} />
                  </Suspense>
                )}
              </div>
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

/**
 * The CDM lists under the Data item. Lives in its own component because
 * useSearchParams() must sit under a Suspense boundary — reading it in the
 * layout itself would force every manager page to bail out of prerendering,
 * which is what failed the Vercel build.
 */
function DataSubnav({ lists, onData }: { lists: DatasetSummary[]; onData: boolean }) {
  const searchParams = useSearchParams();
  const activeList = searchParams?.get('d') ?? lists[0]?.key ?? '';
  return (
    <div className="ml-4 mt-0.5 mb-1 pl-3 border-l border-white/10">
      <p className="px-2 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-white/40">CDM</p>
      {lists.map(d => {
        const on = onData && activeList === d.key;
        return (
          <Link
            key={d.key}
            href={`/datasets?d=${encodeURIComponent(d.key)}`}
            className={cn(
              'flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] transition-colors',
              on ? 'bg-white/10 text-white' : 'text-white/55 hover:text-white hover:bg-white/5',
            )}
          >
            <Table2 size={13} className="flex-shrink-0 opacity-70" />
            {d.label}
          </Link>
        );
      })}
    </div>
  );
}
