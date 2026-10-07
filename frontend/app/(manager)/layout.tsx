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
  LogIn, Clock, Bell, History, Newspaper,
} from 'lucide-react';
import { availabilityStrings } from '@/i18n/availability';
import { cn } from '@/lib/utils';
import { LocaleProvider, useLocale } from '@/lib/locale-context';
import { messageStrings } from '@/i18n/messages';
import { NewVersionPrompt } from '@/components/NewVersionPrompt';
import { datasets as datasetsApi, newsfeed as newsfeedApi, NEWSFEED_CHANGED, type DatasetSummary } from '@/lib/api';
import { homeFor } from '@/lib/home';

/**
 * Office roles that are not managers. They may open Airchat and nothing else —
 * the first real permission split in the app, deliberately narrow.
 */

/**
 * What each non-manager office role may open, first entry = where it starts.
 * Everything else is left out of the menu, not shown locked. Which Data lists
 * and columns they then see is the dataset access matrix's decision.
 */
const ROLE_PATHS: Record<string, string[]> = {
  /** Everything else is off for ADMIN in the UI (30 Sep 2026); the API still
   *  lets ADMIN through every role check. MANAGER keeps the full menu. */
  ADMIN:              ['/planning', '/newsfeed', '/dashboard', '/datasets', '/notify'],
  FRONT_DESK_MANAGER: ['/planning', '/newsfeed', '/datasets', '/notify'],
  FRONT_DESK:         ['/planning', '/newsfeed', '/datasets'],
  OPERATION_MANAGER:  ['/airchat', '/datasets'],
  ASSIST:             ['/airchat', '/datasets'],
  /** Data only; which lists and columns is the access matrix's call. */
  EVIDENCE:           ['/datasets', '/notify'],
  /** Data only (7 Oct 2026). Columns per the matrix; TERENAK also sees only
   *  some rows (dataset_row_filters: Avantio accommodations, Valid users). */
  TERENAK:            ['/datasets'],
  /** Newsfeed + Data (7 Oct 2026); they start on the Newsfeed. */
  DIRECTOR:           ['/newsfeed', '/datasets'],
  FINANCE:            ['/newsfeed', '/datasets'],
  REVENUE_MANAGER:    ['/newsfeed', '/datasets'],
  MARKETING_MANAGER:  ['/newsfeed', '/datasets'],
};

/** The office "Notifications" section (t.nav.notifications is the cleaners' "Alerts"). */
const NEWSFEED_LABEL: Record<string, string> = {
  en: 'Newsfeed', cs: 'Novinky', ru: 'Новости', uk: 'Новини',
};

/**
 * A menu icon in the style of the macOS Finder sidebar (8 Oct 2026): a plain,
 * thin-stroked outline symbol, no tile, in grey — Finder's look without its
 * blue. The glyphs are our own (lucide); only the look is macOS's.
 */
function NavTile({ icon: Icon, active }: { icon: React.ElementType; active: boolean }) {
  return (
    <Icon
      size={19}
      strokeWidth={1.5}
      className={cn('flex-shrink-0 transition-colors', active ? 'text-[#D1D1D6]' : 'text-[#98989D]')}
    />
  );
}

const NOTIFY_LABEL: Record<string, string> = {
  en: 'Notifications', cs: 'Notifikace', ru: 'Уведомления', uk: 'Сповіщення',
};

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

      // A role listed in ROLE_PATHS gets exactly those screens (Data then
      // filtered per column by the access matrix); MANAGER keeps everything.
      const allowed = ROLE_PATHS[user.role];
      if (allowed) {
        if (!allowed.some(p => pathname?.startsWith(p))) { router.replace(allowed[0]); }
        return;
      }
      if (user.role !== 'MANAGER' && user.role !== 'ADMIN') {
        router.replace(homeFor(user.role));
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
    if (!user) return;
    // The server lists only what this role has grants for.
    datasetsApi.list().then(setDataLists).catch(() => {});
  }, [user]);

  // Planning unfolds into the two sides of a stay. Each tab edits only its
  // own time (Check-In → arrival, Check-Out → departure); the other is shown
  // read-only, so two desk operators cannot fight over the same field.
  const onPlanning = pathname?.startsWith('/planning') ?? false;
  const [planningOpen, setPlanningOpen] = useState(onPlanning);
  useEffect(() => { if (onPlanning) setPlanningOpen(true); }, [onPlanning]);
  const planningTabs = [
    { href: '/planning/check-in',  icon: LogIn,  label: (t.planning as any).tabCheckIn  ?? 'Check-In' },
    { href: '/planning/check-out', icon: LogOut, label: (t.planning as any).tabCheckOut ?? 'Check-Out' },
    { href: '/planning/agents',    icon: Clock,  label: availabilityStrings[locale]?.tabLabel ?? 'Agents' },
  ];

  // Notifications unfolds like Planning; Data is its first (and for now only)
  // section — changes to the CDM lists. /notify, not /notifications: that path
  // belongs to the cleaner app's inbox.
  const onNotify = pathname?.startsWith('/notify') ?? false;
  const [notifyOpen, setNotifyOpen] = useState(onNotify);
  useEffect(() => { if (onNotify) setNotifyOpen(true); }, [onNotify]);
  const notifyTabs = [
    { href: '/notify/data', icon: History, label: (t.nav as any).data ?? 'Data' },
  ];

  // Newsfeed badge: how many news items this person has not closed. Polled
  // every minute, and refreshed at once when the Newsfeed page closes one.
  const hasNewsfeed = !!user && (user.role === 'MANAGER' || (ROLE_PATHS[user.role] ?? []).includes('/newsfeed'));
  const [newsUnread, setNewsUnread] = useState(0);
  useEffect(() => {
    if (!hasNewsfeed) return;
    let alive = true;
    const tick = () => newsfeedApi.unread().then((r) => { if (alive) setNewsUnread(r.count); }).catch(() => {});
    tick();
    const t = setInterval(tick, 60_000);
    window.addEventListener(NEWSFEED_CHANGED, tick);
    window.addEventListener('focus', tick);
    return () => { alive = false; clearInterval(t); window.removeEventListener(NEWSFEED_CHANGED, tick); window.removeEventListener('focus', tick); };
  }, [hasNewsfeed]);

  const navItems = [
    { href: '/newsfeed',   icon: Newspaper,       label: NEWSFEED_LABEL[locale] ?? 'Newsfeed' },
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
    { href: '/notify',     icon: Bell,            label: NOTIFY_LABEL[locale] ?? 'Notifications' },
    { href: '/settings',   icon: Settings,        label: t.nav.settings },
  ];

  // Desk roles see one item. Showing them a menu they cannot open would just
  // be a list of locked doors.
  const visibleNav = ROLE_PATHS[user?.role ?? '']
    ? navItems.filter((i) =>
        ROLE_PATHS[user!.role].includes(i.href) &&
        // Data appears once the matrix grants at least one list — or always,
        // for a role whose only screen it is.
        (i.href !== '/datasets' || dataLists.length > 0 || ROLE_PATHS[user!.role]?.[0] === '/datasets'))
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

        <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto scrollbar-hide">
          {visibleNav.map(({ href, icon: Icon, label }) => {
            const active = pathname === href || pathname?.startsWith(href + '/');
            const isData = href === '/datasets';
            const isPlanning = href === '/planning';
            const isNotify = href === '/notify';
            const sub = isPlanning ? planningTabs : isNotify ? notifyTabs : null;
            const open = isData ? dataOpen : isNotify ? notifyOpen : planningOpen;
            const toggle = isData ? () => setDataOpen(o => !o)
              : isNotify ? () => setNotifyOpen(o => !o)
              : () => setPlanningOpen(o => !o);
            return (
              <div key={href}>
                <div
                  className={cn(
                    // Finder's sidebar: a soft rounded selection, bold label when selected.
                    'flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[13.5px] transition-colors',
                    active ? 'bg-white/[0.13] text-white font-semibold' : 'text-white/85 font-normal hover:bg-white/[0.06]',
                  )}
                >
                  <Link href={href} className="flex items-center gap-2.5 flex-1 min-w-0">
                    <NavTile icon={Icon} active={!!active} />
                    {label}
                  </Link>
                  {href === '/newsfeed' && newsUnread > 0 && (
                    <span
                      aria-label={`${newsUnread} unread`}
                      className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-[#FF3B30] text-white text-[10px] font-bold leading-[18px] text-center tabular-nums"
                    >
                      {newsUnread > 99 ? '99+' : newsUnread}
                    </span>
                  )}
                  {isData || sub ? (
                    <button
                      type="button"
                      onClick={toggle}
                      aria-expanded={open}
                      className="ml-auto -mr-1 p-1 rounded-md opacity-60 hover:opacity-100 hover:bg-white/10 transition"
                    >
                      <ChevronDown size={14} className={cn('transition-transform', open ? 'rotate-180' : '')} />
                    </button>
                  ) : (
                    active && !(href === '/newsfeed' && newsUnread > 0) && <ChevronRight size={14} className="ml-auto opacity-40" />
                  )}
                </div>

                {/* Planning → Check-In / Check-Out / Agents; Notifications → Data */}
                {sub && open && (
                  <div className="ml-4 mt-0.5 mb-1 pl-3 border-l border-white/10">
                    {sub.map(tab => {
                      const on = pathname === tab.href || pathname?.startsWith(tab.href + '/');
                      return (
                        <Link
                          key={tab.href}
                          href={tab.href}
                          className={cn(
                            'flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] transition-colors',
                            on ? 'bg-white/10 text-white' : 'text-white/55 hover:text-white hover:bg-white/5',
                          )}
                        >
                          <tab.icon size={13} className="flex-shrink-0 opacity-70" />
                          {tab.label}
                        </Link>
                      );
                    })}
                  </div>
                )}

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
