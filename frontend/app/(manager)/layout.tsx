'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { translations, type Locale } from '@/i18n/translations';
import {
  LayoutDashboard, Users, Building2, CalendarCheck,
  CalendarRange, Settings, LogOut, Search,
  AlertTriangle, Activity, Database, Wrench, Mail, MessagesSquare, ChevronDown, Table2,
  LogIn, Clock, Bell, History, Newspaper, Layers, KanbanSquare,
  Gauge,
  Sparkles,
} from 'lucide-react';
import { availabilityStrings } from '@/i18n/availability';
import { cn } from '@/lib/utils';
import { LocaleProvider, useLocale } from '@/lib/locale-context';
import { messageStrings } from '@/i18n/messages';
import { NewVersionPrompt } from '@/components/NewVersionPrompt';
import { datasets as datasetsApi, newsfeed as newsfeedApi, tasks as tasksApi, controlling as controllingApi, NEWSFEED_CHANGED, TASKS_CHANGED, type DatasetSummary, type ControllingSource } from '@/lib/api';
import { taskStrings } from '@/i18n/tasks';
import { useSocket } from '@/lib/socket';
import { homeFor } from '@/lib/home';
import { CommandSearch, ShortcutCue, SEARCH_STRINGS, isTyping } from '@/components/office/CommandSearch';

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
  ADMIN:              ['/newsfeed', '/planning', '/tasks', '/dashboard', '/datasets', '/notify'],
  /** Notifications off for FRONT_DESK_MANAGER, OPERATIONS_ASSISTANT and EVIDENCE (15 Oct 2026). */
  FRONT_DESK_MANAGER: ['/newsfeed', '/planning', '/tasks', '/datasets'],
  /** FRONT_DESK_MANAGER's modules (15 Oct 2026). */
  OPERATIONS_ASSISTANT: ['/newsfeed', '/planning', '/tasks', '/datasets'],
  FRONT_DESK:         ['/newsfeed', '/planning', '/tasks', '/datasets'],
  OPERATION_MANAGER:  ['/airchat', '/datasets', '/tasks'],
  ASSIST:             ['/airchat', '/datasets', '/tasks'],
  /** Data only; which lists and columns is the access matrix's call. */
  EVIDENCE:           ['/newsfeed', '/datasets', '/tasks'],
  /** Agent (TERENAK until 19 Oct 2026): Data + Tasks on the desktop. Columns
   *  per the matrix, rows per dataset_row_filters (Avantio accommodations,
   *  Valid users). On a phone an agent starts on Availability (lib/home.ts). */
  AGENT:              ['/datasets', '/tasks'],
  /** Newsfeed + Data (7 Oct 2026); they start on the Newsfeed. */
  DIRECTOR:           ['/newsfeed', '/datasets', '/tasks'],
  FINANCE:            ['/newsfeed', '/datasets', '/tasks'],
  REVENUE_MANAGER:    ['/newsfeed', '/datasets', '/tasks'],
  MARKETING_MANAGER:  ['/newsfeed', '/datasets', '/tasks'],
  /** MARKETING_MANAGER's modules (15 Oct 2026). */
  MARKETING_SPECIALIST: ['/newsfeed', '/datasets', '/tasks'],
};

/** The office "Notifications" section (t.nav.notifications is the cleaners' "Alerts"). */
const NEWSFEED_LABEL: Record<string, string> = {
  en: 'Newsfeed', cs: 'Novinky', ru: 'Новости', uk: 'Новини',
};

const NOTIFY_LABEL: Record<string, string> = {
  en: 'Notifications', cs: 'Notifikace', ru: 'Уведомления', uk: 'Сповіщення',
};

/**
 * Menu sections (15 Oct 2026 redesign). A section with nothing this role may
 * open is not drawn at all.
 */
type SectionKey = 'overview' | 'operations' | 'communication' | 'records' | 'admin';
const SECTION_OF: Record<string, SectionKey> = {
  '/newsfeed': 'overview', '/dashboard': 'overview',
  '/planning': 'operations', '/tasks': 'operations', '/schedule': 'operations', '/streams': 'operations',
  '/incidents': 'operations', '/repairs': 'operations',
  '/airchat': 'communication', '/messages': 'communication', '/notify': 'communication',
  '/datasets': 'records', '/controlling': 'records',
  '/staff': 'admin', '/properties': 'admin', '/settings': 'admin',
};
const SECTION_ORDER: SectionKey[] = ['overview', 'operations', 'communication', 'records', 'admin'];
const SECTION_LABEL: Record<string, Record<SectionKey, string>> = {
  en: { overview: 'Overview', operations: 'Operations', communication: 'Communication', records: 'Records', admin: 'Administration' },
  cs: { overview: 'Přehled', operations: 'Provoz', communication: 'Komunikace', records: 'Záznamy', admin: 'Správa' },
  ru: { overview: 'Обзор', operations: 'Операции', communication: 'Коммуникации', records: 'Записи', admin: 'Администрирование' },
  uk: { overview: 'Огляд', operations: 'Операції', communication: 'Комунікації', records: 'Записи', admin: 'Адміністрування' },
};

const LOCALES: { code: Locale; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'cs', label: 'CS' },
  { code: 'ru', label: 'RU' },
  { code: 'uk', label: 'UK' },
];

/** Grey of the tree connector lines. */
const LINE = 'border-[#D6D0C4]';

/**
 * The unread count: a red rounded rectangle, not a circle (15 Oct 2026).
 */
function CountBadge({ n, label }: { n: number; label?: string }) {
  return (
    <span
      aria-label={label ?? `${n}`}
      className="min-w-[20px] h-[18px] px-1.5 rounded-[5px] bg-[#EF4444] text-white text-[11px] font-semibold leading-[18px] text-center tabular-nums"
    >
      {n > 99 ? '99+' : n}
    </span>
  );
}

/**
 * Sub-items hang off their parent on a connector: one vertical line from the
 * parent's icon, and a rounded elbow into each child. The line runs on past a
 * child only while there is a sibling below it.
 */
function TreeBranch({ children }: { children: React.ReactNode }) {
  return <ul className="relative ml-[19px] mt-0.5 mb-1">{children}</ul>;
}

function TreeLeaf({ last, children }: { last: boolean; children: React.ReactNode }) {
  return (
    <li className="relative pl-[14px]">
      {!last && <span aria-hidden className={cn('absolute left-0 top-0 bottom-0 border-l', LINE)} />}
      <span aria-hidden className={cn('absolute left-0 top-0 h-[15px] w-[11px] border-l border-b rounded-bl-[9px]', LINE)} />
      {children}
    </li>
  );
}

function SubLink({ href, icon: Icon, label, on }: { href: string; icon: React.ElementType; label: string; on: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-2 h-[30px] px-2 rounded-lg text-[13px] transition-colors',
        on
          ? 'bg-accent-soft text-accent font-semibold'
          : 'text-[#6A6F69] hover:text-[#1B2420] hover:bg-black/[0.04]',
      )}
    >
      <Icon size={14} strokeWidth={1.75} className={cn('flex-shrink-0', on ? 'text-accent' : 'text-[#6A6F69]')} />
      <span className="truncate">{label}</span>
    </Link>
  );
}

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

  // Controlling unfolds into its tables, one level (manager only, 20 Oct 2026).
  const onControlling = pathname?.startsWith('/controlling') ?? false;
  const [controllingOpen, setControllingOpen] = useState(onControlling);
  useEffect(() => { if (onControlling) setControllingOpen(true); }, [onControlling]);
  const [controllingSources, setControllingSources] = useState<ControllingSource[]>([]);
  useEffect(() => {
    if (user?.role !== 'MANAGER') return;
    controllingApi.sources().then(setControllingSources).catch(() => {});
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

  // Dashboard unfolds into its views; Cleaning is the first (20 Oct 2026).
  const onDashboard = pathname?.startsWith('/dashboard') ?? false;
  const [dashboardOpen, setDashboardOpen] = useState(onDashboard);
  useEffect(() => { if (onDashboard) setDashboardOpen(true); }, [onDashboard]);
  const dashboardTabs = [
    { href: '/dashboard/cleaning', icon: Sparkles, label: (t.dashboard as any).navCleaning ?? 'Cleaning' },
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
  // every 30 s, and refreshed at once when the Newsfeed page closes one.
  const hasNewsfeed = !!user && (user.role === 'MANAGER' || (ROLE_PATHS[user.role] ?? []).includes('/newsfeed'));
  const [newsUnread, setNewsUnread] = useState(0);
  useEffect(() => {
    if (!hasNewsfeed) return;
    let alive = true;
    const tick = () => newsfeedApi.unread().then((r) => { if (alive) setNewsUnread(r.count); }).catch(() => {});
    // The Newsfeed page sends its count along; anything else just says "ask".
    const onChanged = (e: Event) => {
      const n = (e as CustomEvent<{ unread?: number }>).detail?.unread;
      if (typeof n === 'number') setNewsUnread(n); else tick();
    };
    tick();
    const t = setInterval(tick, 30_000);
    window.addEventListener(NEWSFEED_CHANGED, onChanged);
    window.addEventListener('focus', tick);
    return () => { alive = false; clearInterval(t); window.removeEventListener(NEWSFEED_CHANGED, onChanged); window.removeEventListener('focus', tick); };
  }, [hasNewsfeed]);

  // Moving between screens is a cheap moment to recheck.
  useEffect(() => {
    if (hasNewsfeed) newsfeedApi.unread().then((r) => setNewsUnread(r.count)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Tasks badge: how many tasks are hanging on me (16 Oct 2026). Polled, and
  // refreshed when the Tasks page or a colleague changes something.
  const hasTasks = !!user && (user.role === 'MANAGER' || (ROLE_PATHS[user.role] ?? []).includes('/tasks'));
  const [tasksOnMe, setTasksOnMe] = useState(0);
  const tickTasks = useCallback(() => {
    if (hasTasks) tasksApi.badge().then((r) => setTasksOnMe(r.onMe)).catch(() => {});
  }, [hasTasks]);
  useEffect(() => {
    if (!hasTasks) return;
    tickTasks();
    const iv = setInterval(tickTasks, 60_000);
    window.addEventListener(TASKS_CHANGED, tickTasks);
    window.addEventListener('focus', tickTasks);
    return () => { clearInterval(iv); window.removeEventListener(TASKS_CHANGED, tickTasks); window.removeEventListener('focus', tickTasks); };
  }, [hasTasks, tickTasks]);
  useSocket({ 'tasks:changed': tickTasks, 'tasks:notification': tickTasks });

  // Top-bar search. Only for a role that has at least one Data list — the
  // search reads nothing else. Shift+S opens it unless the person is typing.
  const canSearch = dataLists.length > 0;
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    if (!canSearch) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code !== 'KeyS' && e.key !== 'S' && e.key !== 's') return;
      if (isTyping(e.target)) return;
      e.preventDefault();
      setSearchOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canSearch]);

  const navItems = [
    { href: '/newsfeed',   icon: Newspaper,       label: NEWSFEED_LABEL[locale] ?? 'Newsfeed' },
    { href: '/dashboard',  icon: LayoutDashboard, label: t.nav.dashboard },
    { href: '/planning',   icon: CalendarCheck,   label: t.nav.planning },
    { href: '/tasks',      icon: KanbanSquare,    label: taskStrings[locale]?.navLabel ?? 'Tasks' },
    { href: '/schedule',   icon: CalendarRange,   label: (t.nav as any).schedule ?? 'Schedule' },
    { href: '/streams',    icon: Activity,        label: (t.nav as any).stream   ?? 'Stream' },
    { href: '/incidents',  icon: AlertTriangle,   label: t.nav.incidents },
    { href: '/repairs',    icon: Wrench,          label: (t.nav as any).repairs  ?? 'Repairs' },
    { href: '/airchat',    icon: MessagesSquare,  label: 'Airchat' },
    { href: '/messages',   icon: Mail,            label: messageStrings[locale].manager.navLabel },
    { href: '/notify',     icon: Bell,            label: NOTIFY_LABEL[locale] ?? 'Notifications' },
    { href: '/datasets',   icon: Database,        label: (t.nav as any).data ?? 'Data' },
    // Manager only: no role in ROLE_PATHS lists it, and the API refuses everyone else.
    ...(user?.role === 'MANAGER' ? [{ href: '/controlling', icon: Gauge, label: 'Controlling' }] : []),
    { href: '/staff',      icon: Users,           label: t.nav.staff },
    { href: '/properties', icon: Building2,       label: t.nav.properties },
    { href: '/settings',   icon: Settings,        label: t.nav.settings },
  ];

  // Desk roles see their items only. Showing them a menu they cannot open
  // would just be a list of locked doors.
  const visibleNav = ROLE_PATHS[user?.role ?? '']
    ? navItems.filter((i) =>
        ROLE_PATHS[user!.role].includes(i.href) &&
        // Data appears once the matrix grants at least one list — or always,
        // for a role whose only screen it is.
        (i.href !== '/datasets' || dataLists.length > 0 || ROLE_PATHS[user!.role]?.[0] === '/datasets'))
    : navItems;

  const sections = SECTION_ORDER
    .map((key) => ({ key, items: visibleNav.filter((i) => SECTION_OF[i.href] === key) }))
    .filter((s) => s.items.length > 0);

  // Where am I: section › item › tab, for the top bar.
  const current = navItems.find((i) => pathname === i.href || pathname?.startsWith(i.href + '/'));
  const currentTab = [...planningTabs, ...notifyTabs, ...dashboardTabs].find((x) => pathname === x.href || pathname?.startsWith(x.href + '/'));
  const sectionLabels = SECTION_LABEL[locale] ?? SECTION_LABEL.en;
  const searchStrings = SEARCH_STRINGS[locale] ?? SEARCH_STRINGS.en;

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-[#F6F4EF] flex items-center justify-center">
        <div className="w-10 h-10 rounded-2xl bg-ink animate-pulse" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F6F4EF] flex">
      <NewVersionPrompt locale={locale} />
      <CommandSearch open={searchOpen} onClose={() => setSearchOpen(false)} locale={locale} />

      <aside className="w-60 flex-shrink-0 flex flex-col fixed h-full z-30 bg-[#F6F4EF]">

        <div className="px-5 pt-5 pb-3">
          <div className="flex items-center gap-3">
            <img src="/airstay-logo.svg" alt="Airstay" className="w-8 h-8 flex-shrink-0" />
            <div className="min-w-0">
              <p className="font-bold text-[#1B2420] text-[15px] leading-tight tracking-tight">Airstay</p>
              <p className="text-[#6A6F69] text-[11px] leading-tight">Portal App</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 pb-4 overflow-y-auto scrollbar-hide">
          {sections.map((section) => (
            <div key={section.key} className="mt-2.5 first:mt-0">
              <p className="px-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-[#6A6F69]">
                {sectionLabels[section.key]}
              </p>
              <div className="space-y-0.5">
                {section.items.map(({ href, icon: Icon, label }) => {
                  const active = pathname === href || pathname?.startsWith(href + '/');
                  const isData = href === '/datasets';
                  const isPlanning = href === '/planning';
                  const isNotify = href === '/notify';
                  const isControlling = href === '/controlling';
                  const isDashboard = href === '/dashboard';
                  const sub = isPlanning ? planningTabs : isNotify ? notifyTabs : isDashboard ? dashboardTabs : null;
                  const expandable = !!sub || (isData && dataLists.length > 0) || (isControlling && controllingSources.length > 0);
                  const open = isData ? dataOpen : isNotify ? notifyOpen : isControlling ? controllingOpen : isDashboard ? dashboardOpen : planningOpen;
                  const toggle = isData ? () => setDataOpen(o => !o)
                    : isNotify ? () => setNotifyOpen(o => !o)
                    : isDashboard ? () => setDashboardOpen(o => !o)
                    : isControlling ? () => setControllingOpen(o => !o)
                    : () => setPlanningOpen(o => !o);
                  const badge = href === '/newsfeed' ? newsUnread : href === '/tasks' ? tasksOnMe : 0;
                  return (
                    <div key={href}>
                      <div
                        className={cn(
                          'group flex items-center gap-2.5 h-[34px] px-2.5 rounded-xl text-[13.5px] transition-colors',
                          active
                            ? 'bg-accent-soft text-accent font-semibold'
                            : 'text-[#3D433E] hover:bg-black/[0.04] hover:text-[#1B2420]',
                        )}
                      >
                        <Link href={href} className="flex items-center gap-2.5 flex-1 min-w-0 h-full">
                          <Icon
                            size={18}
                            strokeWidth={1.75}
                            className={cn('flex-shrink-0', active ? 'text-accent' : 'text-[#6A6F69] group-hover:text-[#3D433E]')}
                          />
                          <span className="truncate">{label}</span>
                        </Link>
                        {badge > 0 && <CountBadge n={badge} label={`${badge} unread`} />}
                        {expandable && (
                          <button
                            type="button"
                            onClick={toggle}
                            aria-expanded={open}
                            className="-mr-1 p-1 rounded-md text-[#6A6F69] hover:text-[#1B2420] hover:bg-black/[0.05] transition"
                          >
                            <ChevronDown size={14} className={cn('transition-transform', open ? 'rotate-180' : '')} />
                          </button>
                        )}
                      </div>

                      {/* Planning → Check-In / Check-Out / Agents; Notifications → Data */}
                      {sub && open && (
                        <TreeBranch>
                          {sub.map((tab, i) => (
                            <TreeLeaf key={tab.href} last={i === sub.length - 1}>
                              <SubLink
                                href={tab.href}
                                icon={tab.icon}
                                label={tab.label}
                                on={pathname === tab.href || !!pathname?.startsWith(tab.href + '/')}
                              />
                            </TreeLeaf>
                          ))}
                        </TreeBranch>
                      )}

                      {/* Controlling → its tables (one level) */}
                      {isControlling && controllingOpen && controllingSources.length > 0 && (
                        <Suspense fallback={null}>
                          <ControllingSubnav sources={controllingSources} on={onControlling} />
                        </Suspense>
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
              </div>
            </div>
          ))}
        </nav>

        <div className="px-3 pb-3">
          <div className="flex p-0.5 rounded-xl bg-black/[0.05]" role="group" aria-label="Language">
            {LOCALES.map(({ code, label }) => (
              <button
                key={code}
                onClick={() => setLocale(code)}
                className={cn(
                  'flex-1 h-7 rounded-[10px] text-[11.5px] font-semibold transition',
                  locale === code
                    ? 'bg-white text-[#1B2420] shadow-[0_1px_2px_rgba(16,24,40,0.08)]'
                    : 'text-[#6A6F69] hover:text-[#1B2420]',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="px-3 pb-4">
          <div className="flex items-center gap-2.5 p-2 rounded-xl bg-white ring-1 ring-black/[0.05] shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            {/* The person's CDM id where the generic initial used to be; the initial only until the account is linked. */}
            {user.cdmUserId ? (
              <div
                title={`CDM user id: ${user.cdmUserId}`}
                className="min-w-[2rem] h-8 px-2 rounded-[10px] bg-accent flex items-center justify-center flex-shrink-0"
              >
                <span className="text-white text-[11px] font-mono font-semibold tracking-tight">{user.cdmUserId}</span>
              </div>
            ) : (
              <div className="w-8 h-8 rounded-full bg-[#1B2420] flex items-center justify-center flex-shrink-0">
                <span className="text-white text-xs font-semibold">{user.name?.[0] ?? '?'}</span>
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[#1B2420] text-[12.5px] font-semibold truncate leading-tight">{user.name}</p>
              <p className="text-[#6A6F69] text-[11px] truncate leading-tight">{user.email}</p>
            </div>
            <button
              onClick={logout}
              title={t.general.logout}
              aria-label={t.general.logout}
              className="p-1.5 rounded-lg text-[#6A6F69] hover:text-[#1B2420] hover:bg-black/[0.05] transition"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 ml-60 min-h-screen p-2 pl-0 min-w-0">
        {/* Oct 2026 redesign: content sits on the warm ground; pages bring their own white cards. */}
        <div className="min-h-[calc(100vh-16px)] bg-surface rounded-2xl flex flex-col min-w-0">
          {/* Search on its own row at the top; the breadcrumb sits under it in
              small type, as in the reference (16 Oct 2026). */}
          {/* Planning keeps its own bookings bar on screen instead, so the search scrolls away there. */}
          <header className={cn('h-14 flex items-center px-6 border-b border-surface-border bg-surface/90 backdrop-blur rounded-t-2xl', !pathname?.startsWith('/planning') && 'sticky top-0 z-20')}>
            {canSearch && (
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="w-full max-w-md h-9 flex items-center gap-2.5 pl-3 pr-1.5 rounded-full bg-white ring-1 ring-black/[0.08] shadow-[0_1px_2px_rgba(16,24,40,0.05)] text-left hover:ring-black/[0.14] transition"
                title={`${searchStrings.hint} (Shift+S)`}
              >
                <Search size={15} className="text-[#6A6F69] flex-shrink-0" />
                <span className="flex-1 min-w-0 truncate text-[13px] text-[#6A6F69]">{searchStrings.placeholder}</span>
                <ShortcutCue />
              </button>
            )}
          </header>
          <div className="h-9 flex items-end px-6">
            <Suspense fallback={null}>
              <Breadcrumb
                section={current ? sectionLabels[SECTION_OF[current.href]] : ''}
                item={current?.label ?? ''}
                itemHref={current?.href ?? ''}
                tab={currentTab?.label ?? ''}
                lists={dataLists}
                onData={onData}
              />
            </Suspense>
          </div>
          <div className="flex-1 min-w-0">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}

/** Section › Item › Tab (or list), above the page. Under Suspense for useSearchParams. */
function Breadcrumb({ section, item, itemHref, tab, lists, onData }: {
  section: string; item: string; itemHref: string; tab: string; lists: DatasetSummary[]; onData: boolean;
}) {
  const searchParams = useSearchParams();
  const list = onData ? lists.find((l) => l.key === (searchParams?.get('d') ?? lists[0]?.key))?.label ?? '' : '';
  const last = tab || list;
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 min-w-0 text-[12px] leading-none">
      {section && <span className="text-[#6A6F69] truncate">{section}</span>}
      {section && item && <span className="text-[#DCD6CB]">/</span>}
      {item && (
        last
          ? <Link href={itemHref} className="text-[#6A6F69] hover:text-[#3D433E] truncate">{item}</Link>
          : <span className="text-[#3D433E] font-medium truncate">{item}</span>
      )}
      {last && <span className="text-[#DCD6CB]">/</span>}
      {last && <span className="text-[#3D433E] font-medium truncate">{last}</span>}
    </nav>
  );
}

/**
 * The CDM lists under the Data item: Data → CDM → lists, two levels of the
 * same connector tree. Lives in its own component because useSearchParams()
 * must sit under a Suspense boundary — reading it in the layout itself would
 * force every manager page to bail out of prerendering, which is what failed
 * the Vercel build.
 */
/** Controlling → its tables: one level, no source group (unlike Data → CDM → lists). */
function ControllingSubnav({ sources, on }: { sources: ControllingSource[]; on: boolean }) {
  const searchParams = useSearchParams();
  const active = searchParams?.get('s') ?? sources[0]?.key ?? '';
  return (
    <TreeBranch>
      {sources.map((s, i) => (
        <TreeLeaf key={s.key} last={i === sources.length - 1}>
          <SubLink href={`/controlling?s=${encodeURIComponent(s.key)}`} icon={Table2} label={s.label} on={on && active === s.key} />
        </TreeLeaf>
      ))}
    </TreeBranch>
  );
}

function DataSubnav({ lists, onData }: { lists: DatasetSummary[]; onData: boolean }) {
  const searchParams = useSearchParams();
  const activeList = searchParams?.get('d') ?? lists[0]?.key ?? '';
  return (
    <TreeBranch>
      <TreeLeaf last>
        <div className="flex items-center gap-2 h-[30px] px-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-[#6A6F69]">
          <Layers size={14} strokeWidth={1.75} className="flex-shrink-0" />
          CDM
        </div>
        <ul className="relative ml-[15px] mb-0.5">
          {lists.map((d, i) => (
            <TreeLeaf key={d.key} last={i === lists.length - 1}>
              <SubLink
                href={`/datasets?d=${encodeURIComponent(d.key)}`}
                icon={Table2}
                label={d.label}
                on={onData && activeList === d.key}
              />
            </TreeLeaf>
          ))}
        </ul>
      </TreeLeaf>
    </TreeBranch>
  );
}
