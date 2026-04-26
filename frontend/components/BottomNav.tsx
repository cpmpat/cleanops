'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ListChecks, Bookmark } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Translations } from '@/i18n/translations';

interface BottomNavProps {
  t: Translations;
  unreadCount?: number;
}

export function BottomNav({ t }: BottomNavProps) {
  const pathname = usePathname();

  const links = [
    { href: '/cleanings', icon: ListChecks, label: t.nav.cleanings },
    { href: '/mine', icon: Bookmark, label: t.nav.mine },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-surface-border safe-area-pb">
      <div className="flex items-center justify-around px-2 pt-2 pb-safe">
        {links.map(({ href, icon: Icon, label }) => {
          const active = pathname === href || pathname?.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-col items-center gap-1 px-5 py-1.5 rounded-xl transition-colors min-w-[64px]',
                active ? 'text-accent' : 'text-ink-muted',
              )}
            >
              <div className="relative">
                <Icon size={22} strokeWidth={active ? 2.5 : 1.8} />
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
