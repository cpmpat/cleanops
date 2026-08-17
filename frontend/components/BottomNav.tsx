'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ListChecks, CalendarDays, Bookmark, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Translations } from '@/i18n/translations';
import { useMessageStrings } from '@/i18n/messages';
import type { Locale } from '@/i18n/translations';

interface BottomNavProps {
  t: Translations;
  locale: Locale;
  /** Manager messages not yet confirmed — blue. */
  unconfirmedNotes?: number;
  /** Unclaimed turnovers with a guest arriving today — red. */
  todayArrivals?: number;
}

/**
 * Two badges, two meanings, two colours.
 *
 * Red on Úklidy is work with a deadline today that nobody has taken. Blue on
 * Notifikace is something to read. Same colour for both would flatten that
 * difference, and red already means "urgent" everywhere else in the app.
 */
export function BottomNav({ t, locale, unconfirmedNotes = 0, todayArrivals = 0 }: BottomNavProps) {
  const pathname = usePathname();
  const m = useMessageStrings(locale);

  const links = [
    { href: '/cleanings', icon: ListChecks, label: t.nav.cleanings, badge: todayArrivals, tone: 'red' as const },
    { href: '/calendar', icon: CalendarDays, label: t.nav.calendar, badge: 0, tone: 'red' as const },
    { href: '/mine', icon: Bookmark, label: t.nav.mine, badge: 0, tone: 'red' as const },
    { href: '/notifications', icon: Bell, label: m.section.navLabel, badge: unconfirmedNotes, tone: 'blue' as const },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-surface-border safe-area-pb">
      <div className="grid grid-cols-4 items-center px-2 pt-2 pb-safe">
        {links.map(({ href, icon: Icon, label, badge, tone }) => {
          const active = pathname === href || pathname?.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-col items-center justify-center gap-1 py-1.5 rounded-xl transition-colors',
                active ? 'text-accent' : 'text-ink-muted',
              )}
            >
              <div className="relative">
                <Icon size={22} strokeWidth={active ? 2.5 : 1.8} />
                {badge > 0 && (
                  <span
                    className={cn(
                      'absolute -top-1.5 -right-2.5 min-w-[18px] h-[18px] px-1.5 rounded-full',
                      'text-[10.5px] font-extrabold leading-none text-white',
                      'flex items-center justify-center border-2 border-white',
                      tone === 'blue' ? 'bg-[#243b6b]' : 'bg-red-600',
                    )}
                  >
                    {/* Two digits stretch the icon and nobody acts differently
                        on twelve than on nine. */}
                    {badge > 9 ? '9+' : badge}
                  </span>
                )}
              </div>
              <span
                className={cn(
                  'text-[10px] font-medium leading-none',
                  active ? 'text-accent' : 'text-ink-faint',
                )}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
